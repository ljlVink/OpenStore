/* PostgreSQL catalog browsing and database-enforced read-only SQL console. */
const express = require('express');
const { query, readOnlyQuery } = require('../database.cjs');
const { requireAuth, logAction } = require('../middleware/auth.cjs');
const { quoteIdent, tableIdent, listUserTables, tableColumns, countRows } = require('../lib/db-helpers.cjs');

const router = express.Router();
const failure = (res) => res.status(500).json({ error: '数据库操作失败，请检查服务端配置或稍后重试' });

router.get('/api/admin/database/overview', requireAuth, async (req, res) => {
  try {
    const [info, objects, names] = await Promise.all([
      query(`SELECT current_database() AS name, current_setting('server_version') AS version,
                    pg_database_size(current_database())::text AS size_bytes`),
      query(`SELECT
        (SELECT COUNT(*) FROM pg_catalog.pg_indexes WHERE schemaname = 'public')::int AS indexes,
        (SELECT COUNT(*) FROM pg_catalog.pg_views WHERE schemaname = 'public')::int AS views`),
      listUserTables()
    ]);
    const tables = await Promise.all(names.map(async (name) => {
      const [rows, columns, indexes] = await Promise.all([
        countRows(name), tableColumns(name),
        query(`SELECT COUNT(*)::int AS count FROM pg_catalog.pg_indexes
               WHERE schemaname = 'public' AND tablename = $1`, [name])
      ]);
      return { name, rows, columns: columns.length, indexes: indexes.rows[0].count };
    }));
    tables.sort((a, b) => b.rows - a.rows || a.name.localeCompare(b.name));
    res.json({
      postgres: { name: info.rows[0].name, version: info.rows[0].version, sizeBytes: Number(info.rows[0].size_bytes) },
      counts: { tables: names.length, ...objects.rows[0], totalRows: tables.reduce((sum, table) => sum + table.rows, 0) },
      tables
    });
  } catch {
    failure(res);
  }
});

router.get('/api/admin/database/tables/:name', requireAuth, async (req, res) => {
  try {
    const name = String(req.params.name || '');
    if (!(await listUserTables()).includes(name)) return res.status(404).json({ error: '表不存在' });
    const pageSize = Math.min(Math.max(Math.trunc(Number(req.query.pageSize)) || 50, 1), 200);
    const page = Math.max(Math.trunc(Number(req.query.page)) || 1, 1);
    const columns = await tableColumns(name);
    const columnNames = columns.map((column) => column.name);
    const orderBy = columnNames.includes(String(req.query.orderBy || ''))
      ? String(req.query.orderBy)
      : (columns.find((column) => column.pk)?.name || columnNames[0]);
    const order = String(req.query.order || 'desc').toLowerCase() === 'asc' ? 'ASC' : 'DESC';
    const keyword = String(req.query.q || '').trim();
    const searchable = columns.filter((column) => /text|character/i.test(column.type)).slice(0, 8);
    const values = keyword && searchable.length ? [`%${keyword}%`] : [];
    const where = values.length ? ` WHERE ${searchable.map((column) => `${quoteIdent(column.name)} ILIKE $1`).join(' OR ')}` : '';
    const total = await query(`SELECT COUNT(*) AS count FROM ${tableIdent(name)}${where}`, values);
    const result = await query(
      `SELECT * FROM ${tableIdent(name)}${where} ORDER BY ${quoteIdent(orderBy)} ${order}
       LIMIT $${values.length + 1} OFFSET $${values.length + 2}`,
      [...values, pageSize, (page - 1) * pageSize]
    );
    res.json({ table: name, page, pageSize, total: Number(total.rows[0].count), columns, rows: result.rows });
  } catch {
    failure(res);
  }
});

router.post('/api/admin/database/query', requireAuth, async (req, res) => {
  const raw = String(req.body?.sql || '').trim().replace(/;\s*$/, '');
  if (!raw || raw.length > 20000 || raw.includes(';') || !/^(select|with)\b/i.test(raw)) {
    return res.status(400).json({ error: '仅支持单条 SELECT / WITH 查询（最多 20000 字符）' });
  }
  const started = Date.now();
  try {
    const result = await readOnlyQuery(`SELECT * FROM (${raw}\n) AS console_result LIMIT 501`);
    await logAction(req.user?.username, 'query', 'database', null, { durationMs: Date.now() - started });
    res.json({
      durationMs: Date.now() - started,
      rowCount: Math.min(result.rows.length, 500),
      truncated: result.rows.length > 500,
      columns: result.fields.map((field) => field.name),
      rows: result.rows.slice(0, 500)
    });
  } catch (error) {
    const messages = {
      '25006': '只读事务拒绝了写操作',
      '57014': '查询超时，请缩小查询范围',
      '42601': 'SQL 语法错误',
      '42P01': '表不存在',
      '42703': '列不存在',
      '42501': '当前数据库角色没有权限'
    };
    res.status(400).json({ error: messages[error.code] || '查询失败，请检查 SQL 和数据库权限' });
  }
});

module.exports = router;
