/* Required Workers secret, distributed login throttling, and durable audit logs. */
const jwt = require('jsonwebtoken');
const { query } = require('../database.cjs');
const { bindings, defer } = require('../lib/runtime.cjs');
const { getClientIp } = require('../lib/client-ip.cjs');
const { broadcast } = require('../lib/realtime.cjs');
const { jwtSecretOf } = require('../lib/secret.cjs');

const getJwtSecret = () => jwtSecretOf(bindings());

// 用户名截断后再拼 key，避免超长用户名把登录失败表撑大
const loginKeyOf = (req, username) => `${getClientIp(req)}|${String(username || '').slice(0, 64).toLowerCase()}`;
const loginLockRemainingMs = async (key) => {
  const { rows } = await query(
    `SELECT GREATEST(locked_until - floor(extract(epoch FROM clock_timestamp()) * 1000)::bigint, 0) AS remaining
     FROM login_failures WHERE key = $1`, [key]);
  return Number(rows[0]?.remaining || 0);
};

const recordLoginFailure = async (key) => {
  const env = bindings();
  const maxFailures = Math.max(Number(env.LOGIN_MAX_FAILURES) || 5, 1);
  const lockMs = Math.max(Number(env.LOGIN_LOCK_MS) || 15 * 60 * 1000, 1000);
  await query('SELECT record_login_failure($1, $2, $3)', [key, maxFailures, lockMs]);
  // 窗口已过且未锁定的记录与不存在等价（record_login_failure 会重置它们），顺手清掉，表大小随攻击速率封顶
  defer(query(
    `DELETE FROM login_failures
     WHERE locked_until <= floor(extract(epoch FROM clock_timestamp()) * 1000)::bigint
       AND first_at <= floor(extract(epoch FROM clock_timestamp()) * 1000)::bigint - $1`, [lockMs]));
};

const clearLoginFailures = async (key) => {
  await query('DELETE FROM login_failures WHERE key = $1', [key]);
};

// Precomputed cost-10 bcrypt hash: missing users still pay the same comparison.
const LOGIN_DUMMY_HASH = '$2b$10$N9qo8uLOickgx2ZMRZoMyeIjZAgcfl7p92ldGxad68LJZdL17lhWy';

function requireAuth(req, res, next) {
  let secret;
  try { secret = getJwtSecret(); } catch (err) { return next(err); }
  const auth = req.headers.authorization || '';
  const token = auth.startsWith('Bearer ') ? auth.slice(7) : null;
  if (!token) return res.status(401).json({ error: 'Unauthorized' });
  try {
    const data = jwt.verify(token, secret, { algorithms: ['HS256'] });
    if (data.role !== 'admin' || !Number.isFinite(data.exp)) throw new Error('Unauthorized');
    req.user = data;
    next();
  } catch {
    return res.status(401).json({ error: 'Unauthorized' });
  }
}

async function logAction(actor, action, entity, entity_id, payload) {
  const pStr = JSON.stringify(payload || {});
  const { rows } = await query(
    `INSERT INTO operation_logs (actor, action, entity, entity_id, payload) VALUES ($1,$2,$3,$4,$5) RETURNING *`,
    [actor || 'unknown', action, entity, entity_id || null, pStr]);
  const target = entity_id ? `${entity} #${entity_id}` : entity;
  console.log(`OPS ${actor || 'unknown'} ${action} ${target} ${pStr.slice(0, 120)}`);
  defer(broadcast('logs:new', rows[0]));
}

module.exports = { getJwtSecret, requireAuth, logAction, loginKeyOf, loginLockRemainingMs, recordLoginFailure, clearLoginFailures, LOGIN_DUMMY_HASH };
