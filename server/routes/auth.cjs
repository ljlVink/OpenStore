/* Authentication preserves imported bcrypt hashes; password changes only touch PG. */
const express = require('express');
const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');
const { query } = require('../database.cjs');
const { getJwtSecret, requireAuth, logAction, loginKeyOf, loginLockRemainingMs, recordLoginFailure, clearLoginFailures, LOGIN_DUMMY_HASH } = require('../middleware/auth.cjs');

const router = express.Router();
const signToken = (user) => jwt.sign(
  { uid: user.id, username: user.username, role: user.role },
  getJwtSecret(), { algorithm: 'HS256', expiresIn: '2h' });

async function login(req, res) {
  getJwtSecret();
  const { username, password } = req.body || {};
  const loginKey = loginKeyOf(req, username);
  const lockedMs = await loginLockRemainingMs(loginKey);
  if (lockedMs > 0) {
    res.setHeader('Retry-After', String(Math.ceil(lockedMs / 1000)));
    return res.status(429).json({ error: `尝试过于频繁，请 ${Math.ceil(lockedMs / 1000)} 秒后再试` });
  }
  const { rows } = await query('SELECT * FROM users WHERE username = $1', [String(username || '')]);
  const user = rows[0];
  const matches = await bcrypt.compare(typeof password === 'string' ? password : '', user?.password_hash || LOGIN_DUMMY_HASH);
  if (!matches || !user) {
    await recordLoginFailure(loginKey);
    return res.status(401).json({ error: 'Invalid credentials' });
  }
  await clearLoginFailures(loginKey);
  res.json({ token: signToken(user) });
}

router.post('/api/auth/login', login);
router.post('/api/admin/auth/login', login);

router.post('/api/admin/auth/refresh', requireAuth, async (req, res) => {
  const uid = req.user?.uid;
  if (!uid) return res.status(401).json({ error: 'Unauthorized' });
  const { rows } = await query('SELECT * FROM users WHERE id = $1', [uid]);
  if (!rows[0]) return res.status(401).json({ error: 'Unauthorized' });
  res.json({ token: signToken(rows[0]) });
});

async function changePassword(req, res) {
  const { old_password, new_password } = req.body || {};
  if (!old_password || !new_password) return res.status(400).json({ error: 'Missing parameters' });
  const uid = req.user?.uid;
  const failed = (reason) => logAction(req.user?.username, 'password_change_failed', 'users', uid, { reason });
  if (typeof new_password !== 'string' || new_password.length < 8 ||
      !/[A-Z]/.test(new_password) || !/[a-z]/.test(new_password) ||
      !/\d/.test(new_password) || !/[^A-Za-z0-9]/.test(new_password)) {
    await failed('complexity');
    return res.status(400).json({ error: '新密码不符合复杂度要求' });
  }
  const { rows } = await query('SELECT * FROM users WHERE id = $1', [uid]);
  const user = rows[0];
  if (!user) {
    await failed('user_not_found');
    return res.status(404).json({ error: '用户不存在' });
  }
  if (!await bcrypt.compare(typeof old_password === 'string' ? old_password : '', user.password_hash)) {
    await failed('wrong_old_password');
    return res.status(401).json({ error: '旧密码不正确' });
  }
  const hash = await bcrypt.hash(new_password, 10);
  // Compare-and-set prevents simultaneous changes from silently overwriting one another.
  const result = await query('UPDATE users SET password_hash = $1 WHERE id = $2 AND password_hash = $3 RETURNING id',
    [hash, uid, user.password_hash]);
  if (!result.rowCount) {
    await failed('password_changed');
    return res.status(409).json({ error: '密码已更改，请重新登录后再试' });
  }
  await logAction(req.user?.username, 'password_change', 'users', uid);
  res.json({ ok: true });
}

router.post('/api/admin/auth/change-password', requireAuth, changePassword);
router.post('/api/auth/change-password', requireAuth, changePassword);

module.exports = router;
