require('dotenv').config();
const express = require('express');
const cors = require('cors');
const { v4: uuidv4 } = require('uuid');
const rateLimit = require('express-rate-limit');
const { getDb, run, all, get } = require('./db');
const { sendOrderConfirmation, sendAdminNotification, sendQuoteEmail } = require('./email');

const path = require('path');
const app = express();
const PORT = process.env.PORT || 3000;

// ── STATIC FILES ──────────────────────────────────────────────────────────────
app.get('/admin', (req, res) => res.sendFile(path.join(__dirname, 'admin.html')));
app.use(express.static(path.join(__dirname, 'public')));

// ── MIDDLEWARE ────────────────────────────────────────────────────────────────
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(cors({
  origin: process.env.SITE_URL || '*',
  methods: ['GET', 'POST', 'PATCH', 'DELETE'],
}));

const orderLimiter = rateLimit({ windowMs: 15 * 60 * 1000, max: 10, message: { error: 'Too many requests. Please try again later.' } });
const adminLimiter = rateLimit({ windowMs: 15 * 60 * 1000, max: 50 });

// ── AUTH MIDDLEWARE ───────────────────────────────────────────────────────────
function requireAdmin(req, res, next) {
  const token = req.headers['x-admin-token'] || req.query.token;
  if (token !== process.env.ADMIN_PASSWORD) {
    return res.status(401).json({ error: 'Unauthorized' });
  }
  next();
}

// ── PUBLIC ROUTES ─────────────────────────────────────────────────────────────

// Health check
app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// Submit order
app.post('/api/orders', orderLimiter, async (req, res) => {
  const { first_name, last_name, email, whatsapp, service, level, deadline, budget, details } = req.body;

  if (!first_name || !last_name || !email || !service) {
    return res.status(400).json({ error: 'Missing required fields: first_name, last_name, email, service' });
  }

  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  if (!emailRegex.test(email)) {
    return res.status(400).json({ error: 'Invalid email address' });
  }

  const order = {
    id: 'EA-' + uuidv4().slice(0, 8).toUpperCase(),
    created_at: new Date().toISOString(),
    status: 'new',
    first_name: first_name.trim(),
    last_name: last_name.trim(),
    email: email.trim().toLowerCase(),
    whatsapp: whatsapp?.trim() || null,
    service: service.trim(),
    level: level?.trim() || null,
    deadline: deadline || null,
    budget: budget?.trim() || null,
    details: details?.trim() || null,
    admin_notes: null,
    quoted_price: null,
    updated_at: new Date().toISOString(),
  };

  run(`INSERT INTO orders VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`, [
    order.id, order.created_at, order.status,
    order.first_name, order.last_name, order.email, order.whatsapp,
    order.service, order.level, order.deadline, order.budget, order.details,
    order.admin_notes, order.quoted_price, order.updated_at
  ]);

  // Send emails (non-blocking)
  sendOrderConfirmation(order).catch(e => console.error('[EMAIL] Confirmation failed:', e.message));
  sendAdminNotification(order).catch(e => console.error('[EMAIL] Admin notify failed:', e.message));

  res.status(201).json({
    success: true,
    order_id: order.id,
    message: `Thank you ${order.first_name}! We'll respond within a few hours.`
  });
});

// Track order by ID (for clients)
app.get('/api/orders/:id', (req, res) => {
  const order = get(`SELECT id, created_at, status, first_name, service, level, deadline, quoted_price FROM orders WHERE id = ?`, [req.params.id.toUpperCase()]);
  if (!order) return res.status(404).json({ error: 'Order not found' });
  res.json(order);
});

// ── ADMIN ROUTES ──────────────────────────────────────────────────────────────

// Login check
app.post('/api/admin/login', adminLimiter, (req, res) => {
  const { password } = req.body;
  if (password !== process.env.ADMIN_PASSWORD) {
    return res.status(401).json({ error: 'Wrong password' });
  }
  res.json({ success: true, token: process.env.ADMIN_PASSWORD });
});

// Get all orders
app.get('/api/admin/orders', adminLimiter, requireAdmin, (req, res) => {
  const { status, search, limit = 50, offset = 0 } = req.query;
  let sql = `SELECT * FROM orders`;
  const params = [];
  const conditions = [];

  if (status && status !== 'all') {
    conditions.push(`status = ?`);
    params.push(status);
  }
  if (search) {
    conditions.push(`(first_name LIKE ? OR last_name LIKE ? OR email LIKE ? OR id LIKE ? OR service LIKE ?)`);
    const s = `%${search}%`;
    params.push(s, s, s, s, s);
  }
  if (conditions.length) sql += ` WHERE ` + conditions.join(' AND ');
  sql += ` ORDER BY created_at DESC LIMIT ? OFFSET ?`;
  params.push(parseInt(limit), parseInt(offset));

  const orders = all(sql, params);
  const total = get(`SELECT COUNT(*) as count FROM orders` + (conditions.length ? ` WHERE ` + conditions.join(' AND ') : ''), params.slice(0, -2));
  res.json({ orders, total: total?.count || 0 });
});

// Get stats
app.get('/api/admin/stats', adminLimiter, requireAdmin, (req, res) => {
  const stats = {
    total: get(`SELECT COUNT(*) as c FROM orders`)?.c || 0,
    new: get(`SELECT COUNT(*) as c FROM orders WHERE status='new'`)?.c || 0,
    in_progress: get(`SELECT COUNT(*) as c FROM orders WHERE status='in_progress'`)?.c || 0,
    completed: get(`SELECT COUNT(*) as c FROM orders WHERE status='completed'`)?.c || 0,
    cancelled: get(`SELECT COUNT(*) as c FROM orders WHERE status='cancelled'`)?.c || 0,
    today: get(`SELECT COUNT(*) as c FROM orders WHERE date(created_at) = date('now')`)?.c || 0,
    this_week: get(`SELECT COUNT(*) as c FROM orders WHERE created_at >= datetime('now', '-7 days')`)?.c || 0,
    by_service: all(`SELECT service, COUNT(*) as count FROM orders GROUP BY service ORDER BY count DESC LIMIT 5`),
  };
  res.json(stats);
});

// Update order status / notes / quote
app.patch('/api/admin/orders/:id', adminLimiter, requireAdmin, async (req, res) => {
  const { status, admin_notes, quoted_price } = req.body;
  const order = get(`SELECT * FROM orders WHERE id = ?`, [req.params.id]);
  if (!order) return res.status(404).json({ error: 'Order not found' });

  const updates = [];
  const params = [];
  if (status !== undefined) { updates.push('status = ?'); params.push(status); }
  if (admin_notes !== undefined) { updates.push('admin_notes = ?'); params.push(admin_notes); }
  if (quoted_price !== undefined) { updates.push('quoted_price = ?'); params.push(quoted_price); }
  updates.push('updated_at = ?');
  params.push(new Date().toISOString());
  params.push(req.params.id);

  run(`UPDATE orders SET ${updates.join(', ')} WHERE id = ?`, params);

  // If quote was just set, email the client
  if (quoted_price && quoted_price !== order.quoted_price) {
    const updatedOrder = get(`SELECT * FROM orders WHERE id = ?`, [req.params.id]);
    sendQuoteEmail(updatedOrder, quoted_price, admin_notes).catch(e => console.error('[EMAIL] Quote email failed:', e.message));
  }

  res.json({ success: true });
});

// Delete order
app.delete('/api/admin/orders/:id', adminLimiter, requireAdmin, (req, res) => {
  const order = get(`SELECT id FROM orders WHERE id = ?`, [req.params.id]);
  if (!order) return res.status(404).json({ error: 'Order not found' });
  run(`DELETE FROM orders WHERE id = ?`, [req.params.id]);
  res.json({ success: true });
});

// ── START ─────────────────────────────────────────────────────────────────────
async function start() {
  await getDb();
  app.listen(PORT, () => {
    console.log(`\n🎓 Assist backend running on http://localhost:${PORT}`);
    console.log(`   Admin dashboard: http://localhost:${PORT}/admin`);
    console.log(`   Health check:    http://localhost:${PORT}/api/health\n`);
  });
}

start().catch(console.error);
