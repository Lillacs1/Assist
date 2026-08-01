const { createClient } = require('@supabase/supabase-js');

if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
  throw new Error(
    'Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in your .env file. ' +
    'Get these from your Supabase project: Settings → API.'
  );
}

// This client uses the service_role key, which bypasses Row Level Security.
// It must ONLY ever be used on the server (here). Never send this key to
// the browser, never commit it, never put it in frontend code.
const supabaseAdmin = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY,
  { auth: { persistSession: false } }
);

// Verifies a client's Supabase access token (sent from the frontend after
// they sign in with Google) and returns their user info, or null if the
// token is missing/invalid/expired. This is how the server knows who is
// making a request without trusting anything the client claims about itself.
async function getUserFromToken(authHeader) {
  if (!authHeader || !authHeader.startsWith('Bearer ')) return null;
  const token = authHeader.slice('Bearer '.length);
  const { data, error } = await supabaseAdmin.auth.getUser(token);
  if (error || !data?.user) return null;
  return data.user;
}

async function getProfile(userId) {
  const { data, error } = await supabaseAdmin
    .from('profiles')
    .select('id, full_name, email, phone, created_at')
    .eq('id', userId)
    .maybeSingle();
  if (error) throw error;
  return data;
}

async function updateProfile(userId, fields) {
  const { data, error } = await supabaseAdmin
    .from('profiles')
    .update(fields)
    .eq('id', userId)
    .select()
    .maybeSingle();
  if (error) throw error;
  return data;
}

// Permanently deletes a client's account. The profiles row is removed
// automatically via 'on delete cascade' (schema.sql). Their past orders are
// NOT deleted — client_id is set to null via 'on delete set null', so your
// order history/records stay intact, just unlinked from a now-deleted user.
async function deleteAccount(userId) {
  const { error } = await supabaseAdmin.auth.admin.deleteUser(userId);
  if (error) throw error;
}

async function createOrder(order) {
  const { error } = await supabaseAdmin.from('orders').insert(order);
  if (error) throw error;
  return order;
}

async function getOrderById(id) {
  const { data, error } = await supabaseAdmin
    .from('orders')
    .select('*')
    .eq('id', id)
    .maybeSingle();
  if (error) throw error;
  return data;
}

async function getOrdersForClient(clientId) {
  const { data, error } = await supabaseAdmin
    .from('orders')
    .select('id, created_at, status, service, level, deadline, quoted_price, estimated_completion, details')
    .eq('client_id', clientId)
    .order('created_at', { ascending: false });
  if (error) throw error;
  return data;
}

async function listOrders({ status, search, limit = 50, offset = 0 }) {
  let query = supabaseAdmin.from('orders').select('*', { count: 'exact' });

  if (status && status !== 'all') {
    query = query.eq('status', status);
  }
  if (search) {
    const s = `%${search}%`;
    query = query.or(
      `first_name.ilike.${s},last_name.ilike.${s},email.ilike.${s},id.ilike.${s},service.ilike.${s}`
    );
  }

  query = query
    .order('created_at', { ascending: false })
    .range(Number(offset), Number(offset) + Number(limit) - 1);

  const { data, error, count } = await query;
  if (error) throw error;
  return { orders: data, total: count || 0 };
}

async function getStatusHistory(orderId) {
  const { data, error } = await supabaseAdmin
    .from('order_status_history')
    .select('status, changed_at')
    .eq('order_id', orderId)
    .order('changed_at', { ascending: true });
  if (error) throw error;
  return data;
}

async function getStats() {
  const countByStatus = async (status) => {
    let query = supabaseAdmin.from('orders').select('*', { count: 'exact', head: true });
    if (status) query = query.eq('status', status);
    const { count, error } = await query;
    if (error) throw error;
    return count || 0;
  };

  const todayStart = new Date();
  todayStart.setHours(0, 0, 0, 0);
  const weekAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
  const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
  const sixtyDaysAgo = new Date(Date.now() - 60 * 24 * 60 * 60 * 1000);

  const { count: today } = await supabaseAdmin
    .from('orders')
    .select('*', { count: 'exact', head: true })
    .gte('created_at', todayStart.toISOString());

  const { count: this_week } = await supabaseAdmin
    .from('orders')
    .select('*', { count: 'exact', head: true })
    .gte('created_at', weekAgo.toISOString());

  const { data: byServiceRaw, error: byServiceErr } = await supabaseAdmin
    .from('orders')
    .select('service');
  if (byServiceErr) throw byServiceErr;

  const serviceCounts = {};
  for (const row of byServiceRaw || []) {
    serviceCounts[row.service] = (serviceCounts[row.service] || 0) + 1;
  }
  const by_service = Object.entries(serviceCounts)
    .map(([service, count]) => ({ service, count }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 5);

  // "Revenue" here means quotes you've actually entered against completed
  // orders — since payment itself happens outside the platform (Remitly),
  // this is a running total of quoted_price for completed work, not a
  // record of money actually received.
  const parseAmount = (s) => {
    if (!s) return 0;
    const n = parseFloat(String(s).replace(/[^0-9.]/g, ''));
    return isNaN(n) ? 0 : n;
  };
  const { data: completedRows, error: revErr } = await supabaseAdmin
    .from('orders')
    .select('quoted_price, created_at')
    .eq('status', 'completed');
  if (revErr) throw revErr;
  const revenue = (completedRows || []).reduce((sum, o) => sum + parseAmount(o.quoted_price), 0);

  // Trend deltas: this-30-days vs the-30-days-before-that, for the
  // "↑12% vs last 30 days" style labels in the stats cards.
  const countInRange = async (from, to, statusFilter) => {
    let q = supabaseAdmin.from('orders').select('*', { count: 'exact', head: true })
      .gte('created_at', from.toISOString());
    if (to) q = q.lt('created_at', to.toISOString());
    if (statusFilter) q = q.eq('status', statusFilter);
    const { count, error } = await q;
    if (error) throw error;
    return count || 0;
  };
  const totalLast30 = await countInRange(thirtyDaysAgo, null);
  const totalPrev30 = await countInRange(sixtyDaysAgo, thirtyDaysAgo);
  const completedLast30 = await countInRange(thirtyDaysAgo, null, 'completed');
  const completedPrev30 = await countInRange(sixtyDaysAgo, thirtyDaysAgo, 'completed');
  const pct = (curr, prev) => prev === 0 ? (curr > 0 ? 100 : 0) : Math.round(((curr - prev) / prev) * 100);

  const total = await countByStatus();
  const completed = await countByStatus('completed');
  const cancelled = await countByStatus('cancelled');
  const completion_rate = total > 0 ? Math.round((completed / (total - cancelled || 1)) * 100) : 0;

  return {
    total,
    new: await countByStatus('new'),
    in_progress: await countByStatus('in_progress'),
    completed,
    cancelled,
    today: today || 0,
    this_week: this_week || 0,
    by_service,
    revenue,
    completion_rate,
    trend: {
      total_pct: pct(totalLast30, totalPrev30),
      completed_pct: pct(completedLast30, completedPrev30),
    },
  };
}

async function updateOrder(id, fields) {
  const { data, error } = await supabaseAdmin
    .from('orders')
    .update(fields)
    .eq('id', id)
    .select()
    .maybeSingle();
  if (error) throw error;
  return data;
}

async function deleteOrder(id) {
  const { error } = await supabaseAdmin.from('orders').delete().eq('id', id);
  if (error) throw error;
}

module.exports = {
  supabaseAdmin,
  getUserFromToken,
  getProfile,
  updateProfile,
  deleteAccount,
  createOrder,
  getOrderById,
  getOrdersForClient,
  listOrders,
  getStats,
  getStatusHistory,
  updateOrder,
  deleteOrder,
};
