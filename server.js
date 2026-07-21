require('dotenv').config();

// Catch the exact mistake that just happened — pasting the dashboard page
// URL instead of the real API URL — before it causes confusing "fetch
// failed" errors scattered across every route.
if (process.env.SUPABASE_URL && !/^https:\/\/[a-z0-9-]+\.supabase\.co\/?$/i.test(process.env.SUPABASE_URL.trim())) {
  console.error(
    '\n❌ SUPABASE_URL in your .env looks wrong.\n' +
    `   You have: ${process.env.SUPABASE_URL}\n` +
    '   It should look like: https://your-project-ref.supabase.co\n' +
    '   Find the correct one in Supabase → Settings → API → "Project URL"\n' +
    '   (NOT the supabase.com/dashboard/project/... link from your browser tab).\n'
  );
  process.exit(1);
}
const express = require('express');
const cors = require('cors');
const fs = require('fs');
const { v4: uuidv4 } = require('uuid');
const rateLimit = require('express-rate-limit');
const {
  getUserFromToken,
  getProfile,
  updateProfile,
  createOrder,
  getOrderById,
  getOrdersForClient,
  listOrders,
  getStats,
  updateOrder,
  deleteOrder,
} = require('./supabase');
const { sendOrderConfirmation, sendAdminNotification, sendQuoteEmail } = require('./email');

const path = require('path');
const app = express();
const PORT = process.env.PORT || 3000;

// ── MIDDLEWARE ────────────────────────────────────────────────────────────────
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(cors({
  origin: process.env.SITE_URL || '*',
  methods: ['GET', 'POST', 'PATCH', 'DELETE'],
}));

const orderLimiter = rateLimit({ windowMs: 15 * 60 * 1000, max: 10, message: { error: 'Too many requests. Please try again later.' } });
const adminLimiter = rateLimit({ windowMs: 15 * 60 * 1000, max: 50 });
const dashboardLimiter = rateLimit({ windowMs: 15 * 60 * 1000, max: 100 });

// ── STATIC PAGES (with Supabase config injected) ─────────────────────────────
// index.html and dashboard.html both need the public Supabase URL + anon key
// to run supabase-js in the browser. Rather than hardcoding those into the
// committed HTML, we inject them from environment variables at request time.
// (These two values are safe to expose in the browser — that's how Supabase's
// anon key is designed to work — unlike SUPABASE_SERVICE_ROLE_KEY, which never
// leaves the server.)
function serveWithConfig(filePath) {
  return (req, res) => {
    let html = fs.readFileSync(filePath, 'utf8');
    html = html
      .replace(/__SUPABASE_URL__/g, process.env.SUPABASE_URL || '')
      .replace(/__SUPABASE_ANON_KEY__/g, process.env.SUPABASE_ANON_KEY || '');
    res.set('Content-Type', 'text/html');
    res.send(html);
  };
}

app.get('/', serveWithConfig(path.join(__dirname, 'public', 'index.html')));
app.get('/profile', serveWithConfig(path.join(__dirname, 'public', 'profile.html')));
app.get('/dashboard', (req, res) => res.redirect(301, '/profile')); // old link, kept working
app.get('/admin', (req, res) => res.sendFile(path.join(__dirname, 'admin.html')));
app.use(express.static(path.join(__dirname, 'public')));

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

// Submit order — works for anonymous visitors AND signed-in clients.
// If the request carries a valid Supabase access token (the client is
// logged in with Google), the order is linked to their account so it shows
// up on their dashboard. Otherwise it's created exactly as before.
app.post('/api/orders', orderLimiter, async (req, res) => {
  const { first_name, last_name, email, whatsapp, service, level, deadline, budget, details } = req.body;

  if (!first_name || !last_name || !email || !service) {
    return res.status(400).json({ error: 'Missing required fields: first_name, last_name, email, service' });
  }

  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  if (!emailRegex.test(email)) {
    return res.status(400).json({ error: 'Invalid email address' });
  }

  const user = await getUserFromToken(req.headers.authorization);

  const order = {
    id: 'AS-' + uuidv4().slice(0, 8).toUpperCase(),
    created_at: new Date().toISOString(),
    status: 'new',
    client_id: user?.id || null,
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
    estimated_completion: null,
  };

  try {
    await createOrder(order);
  } catch (e) {
    console.error('[DB] Failed to create order:', e.message);
    return res.status(500).json({ error: 'Could not save your order. Please try again.' });
  }

  // Send emails (non-blocking)
  sendOrderConfirmation(order).catch(e => console.error('[EMAIL] Confirmation failed:', e.message));
  sendAdminNotification(order).catch(e => console.error('[EMAIL] Admin notify failed:', e.message));

  res.status(201).json({
    success: true,
    order_id: order.id,
    message: `Thank you ${order.first_name}! We'll respond within a few hours.`
  });
});

// Track a single order by ID (public — no login needed, matches old behaviour)
app.get('/api/orders/:id', async (req, res) => {
  try {
    const order = await getOrderById(req.params.id.toUpperCase());
    if (!order) return res.status(404).json({ error: 'Order not found' });
    const { id, created_at, status, first_name, service, level, deadline, quoted_price, estimated_completion } = order;
    res.json({ id, created_at, status, first_name, service, level, deadline, quoted_price, estimated_completion });
  } catch (e) {
    res.status(500).json({ error: 'Lookup failed' });
  }
});

// ── CLIENT DASHBOARD ROUTES ───────────────────────────────────────────────────

// Returns the signed-in client's own profile row — the one created
// automatically by the database trigger the moment they first signed in
// (see supabase/schema.sql: handle_new_user). Not just session data.
app.get('/api/my/profile', dashboardLimiter, async (req, res) => {
  const user = await getUserFromToken(req.headers.authorization);
  if (!user) return res.status(401).json({ error: 'Not signed in' });

  try {
    const profile = await getProfile(user.id);
    res.json({ profile });
  } catch (e) {
    console.error('[DB] Failed to fetch profile:', e.message);
    res.status(500).json({ error: 'Could not load your profile' });
  }
});

// Lets a signed-in client update their own name/phone.
app.patch('/api/my/profile', dashboardLimiter, async (req, res) => {
  const user = await getUserFromToken(req.headers.authorization);
  if (!user) return res.status(401).json({ error: 'Not signed in' });

  const { full_name, phone } = req.body;
  const fields = {};
  if (typeof full_name === 'string') fields.full_name = full_name.trim();
  if (typeof phone === 'string') fields.phone = phone.trim();

  try {
    const profile = await updateProfile(user.id, fields);
    res.json({ profile });
  } catch (e) {
    console.error('[DB] Failed to update profile:', e.message);
    res.status(500).json({ error: 'Could not save your profile' });
  }
});

// Returns the signed-in client's own orders. Requires a valid Supabase
// access token in the Authorization header — the frontend gets this
// automatically from supabase-js after Google sign-in.
app.get('/api/my/orders', dashboardLimiter, async (req, res) => {
  const user = await getUserFromToken(req.headers.authorization);
  if (!user) return res.status(401).json({ error: 'Not signed in' });

  try {
    const orders = await getOrdersForClient(user.id);
    res.json({ orders });
  } catch (e) {
    console.error('[DB] Failed to fetch client orders:', e.message);
    res.status(500).json({ error: 'Could not load your orders' });
  }
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
app.get('/api/admin/orders', adminLimiter, requireAdmin, async (req, res) => {
  const { status, search, limit = 50, offset = 0 } = req.query;
  try {
    const { orders, total } = await listOrders({ status, search, limit, offset });
    res.json({ orders, total });
  } catch (e) {
    console.error('[DB] Failed to list orders:', e.message);
    res.status(500).json({ error: 'Could not load orders' });
  }
});

// Get stats
app.get('/api/admin/stats', adminLimiter, requireAdmin, async (req, res) => {
  try {
    res.json(await getStats());
  } catch (e) {
    console.error('[DB] Failed to load stats:', e.message);
    res.status(500).json({ error: 'Could not load stats' });
  }
});

// Update order status / notes / quote / estimated completion time
app.patch('/api/admin/orders/:id', adminLimiter, requireAdmin, async (req, res) => {
  const { status, admin_notes, quoted_price, estimated_completion } = req.body;

  let order;
  try {
    order = await getOrderById(req.params.id);
  } catch (e) {
    return res.status(500).json({ error: 'Lookup failed' });
  }
  if (!order) return res.status(404).json({ error: 'Order not found' });

  const fields = {};
  if (status !== undefined) fields.status = status;
  if (admin_notes !== undefined) fields.admin_notes = admin_notes;
  if (quoted_price !== undefined) fields.quoted_price = quoted_price;
  if (estimated_completion !== undefined) fields.estimated_completion = estimated_completion || null;

  let updatedOrder;
  try {
    updatedOrder = await updateOrder(req.params.id, fields);
  } catch (e) {
    console.error('[DB] Failed to update order:', e.message);
    return res.status(500).json({ error: 'Update failed' });
  }

  // If quote was just set, email the client
  if (quoted_price && quoted_price !== order.quoted_price) {
    sendQuoteEmail(updatedOrder, quoted_price, admin_notes).catch(e => console.error('[EMAIL] Quote email failed:', e.message));
  }

  res.json({ success: true });
});

// Delete order
app.delete('/api/admin/orders/:id', adminLimiter, requireAdmin, async (req, res) => {
  try {
    const order = await getOrderById(req.params.id);
    if (!order) return res.status(404).json({ error: 'Order not found' });
    await deleteOrder(req.params.id);
    res.json({ success: true });
  } catch (e) {
    console.error('[DB] Failed to delete order:', e.message);
    res.status(500).json({ error: 'Delete failed' });
  }
});

// ── START (local dev only — Vercel imports `app` directly, see api/index.js) ──
if (require.main === module) {
  app.listen(PORT, () => {
    console.log(`\n🎓 Assist backend running on http://localhost:${PORT}`);
    console.log(`   Admin dashboard: http://localhost:${PORT}/admin`);
    console.log(`   Client profile:   http://localhost:${PORT}/profile`);
    console.log(`   Health check:    http://localhost:${PORT}/api/health\n`);
  });
}

module.exports = app;
