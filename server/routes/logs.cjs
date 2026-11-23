/*
 * 操作日志
 */
const express = require('express');
const { query } = require('../database.cjs');
const { requireAuth, logAction } = require('../middleware/auth.cjs');

const router = express.Router();

router.get(['/api/logs', '/api/admin/logs'], requireAuth, async (req, res) => {
  const page = Math.max(1, Math.trunc(Number(req.query.page)) || 1);
  const pageSize = Math.min(200, Math.max(1, Math.trunc(Number(req.query.pageSize)) || 20));
  const values = [];
  const conditions = [];
  for (const key of ['action', 'actor']) {
    if (req.query[key]) {
      values.push(String(req.query[key]));
      conditions.push(`${key} = $${values.length}`);
    }
  }
  if (req.query.search) {
    values.push(`%${String(req.query.search).trim()}%`);
    conditions.push(`(actor ILIKE $${values.length} OR action ILIKE $${values.length}
      OR entity ILIKE $${values.length} OR payload ILIKE $${values.length})`);
  }
  const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
  try {
    const [items, total, actions, actors, today] = await Promise.all([
      query(`SELECT * FROM operation_logs ${where} ORDER BY created_at DESC, id DESC
        LIMIT $${values.length + 1} OFFSET $${values.length + 2}`, [...values, pageSize, (page - 1) * pageSize]),
      query(`SELECT COUNT(*) AS count FROM operation_logs ${where}`, values),
      query('SELECT action, COUNT(*)::int AS count FROM operation_logs GROUP BY action ORDER BY count DESC LIMIT 30'),
      query('SELECT actor, COUNT(*)::int AS count FROM operation_logs GROUP BY actor ORDER BY count DESC LIMIT 30'),
      query(`SELECT COUNT(*) AS count FROM operation_logs
        WHERE (created_at AT TIME ZONE 'Asia/Shanghai')::date = (CURRENT_TIMESTAMP AT TIME ZONE 'Asia/Shanghai')::date`)
    ]);
    res.json({
      items: items.rows, total: Number(total.rows[0].count), page, pageSize,
      actions: actions.rows, actors: actors.rows, today_count: Number(today.rows[0].count)
    });
  } catch {
    res.status(500).json({ error: '读取操作日志失败' });
  }
});

router.post(['/api/logs/batch-delete', '/api/admin/logs/batch-delete'], requireAuth, async (req, res) => {
  const { ids, clearAll } = req.body;
  if (!clearAll && (!Array.isArray(ids) || !ids.length || !ids.every((id) => Number.isSafeInteger(id) && id > 0))) {
    return res.status(400).json({ error: '请选择有效的日志 ID' });
  }
  try {
    const { rowCount } = clearAll
      ? await query('DELETE FROM operation_logs')
      : await query('DELETE FROM operation_logs WHERE id = ANY($1::integer[])', [ids]);
    await logAction(req.user?.username, clearAll ? 'clear_logs' : 'delete_logs', 'operation_logs', null, { count: rowCount });
    res.json({ deleted: rowCount });
  } catch {
    res.status(500).json({ error: '删除操作日志失败' });
  }
});

module.exports = router;
