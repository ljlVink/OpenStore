/*
 * 服务事故 / 维护公告 CRUD（含公开进行中列表）
 */
const express = require('express');
const { query } = require('../database.cjs');
const { requireAuth, logAction } = require('../middleware/auth.cjs');
const { broadcast } = require('../lib/realtime.cjs');
const { defer } = require('../lib/runtime.cjs');

const router = express.Router();

const activeSql = `SELECT * FROM incidents
  WHERE status != 'resolved' OR ((type = 'maintenance' OR type = 'notice') AND end_time > $1)
  ORDER BY type DESC, start_time DESC, created_at DESC`;

async function publishActive() {
  const { rows } = await query(activeSql, [Math.floor(Date.now() / 1000)]);
  await broadcast('incidents:update', rows);
}

router.get(['/api/incidents', '/api/admin/incidents'], requireAuth, async (req, res) => {
  try {
    const { rows } = await query('SELECT * FROM incidents ORDER BY created_at DESC');
    res.json({ items: rows });
  } catch {
    res.status(500).json({ error: '读取公告失败' });
  }
});

router.post(['/api/incidents', '/api/admin/incidents'], requireAuth, async (req, res) => {
  const { title, content, status, type, start_time, end_time, icon } = req.body;
  try {
    const { rows } = await query(
      `INSERT INTO incidents (title, content, status, type, start_time, end_time, icon)
       VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING id`,
      [title, content, status, type, start_time, end_time, icon || null]
    );
    const id = rows[0].id;
    await logAction(req.user?.username, 'create', 'incidents', id, { title });
    defer(publishActive());
    res.json({ id });
  } catch {
    res.status(500).json({ error: '创建公告失败' });
  }
});

router.put(['/api/incidents/:id', '/api/admin/incidents/:id'], requireAuth, async (req, res) => {
  const id = Number(req.params.id);
  const { title, content, status, type, start_time, end_time, icon } = req.body;
  try {
    const { rowCount } = await query(
      `UPDATE incidents SET title=$1, content=$2, status=$3, type=$4, start_time=$5,
       end_time=$6, icon=$7, updated_at=EXTRACT(EPOCH FROM CURRENT_TIMESTAMP)::integer WHERE id=$8`,
      [title, content, status, type, start_time, end_time, icon || null, id]
    );
    await logAction(req.user?.username, 'update', 'incidents', id, { title, status });
    defer(publishActive());
    res.json({ changed: rowCount });
  } catch {
    res.status(500).json({ error: '更新公告失败' });
  }
});

router.delete(['/api/incidents/:id', '/api/admin/incidents/:id'], requireAuth, async (req, res) => {
  const id = Number(req.params.id);
  try {
    const { rowCount } = await query('DELETE FROM incidents WHERE id=$1', [id]);
    await logAction(req.user?.username, 'delete', 'incidents', id);
    defer(publishActive());
    res.json({ deleted: rowCount });
  } catch {
    res.status(500).json({ error: '删除公告失败' });
  }
});

router.get('/api/public/incidents/active', async (req, res) => {
  try {
    const { rows } = await query(activeSql, [Math.floor(Date.now() / 1000)]);
    res.json({ items: rows });
  } catch {
    res.status(500).json({ error: '读取公告失败' });
  }
});

module.exports = router;
