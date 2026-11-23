const { neon } = require('@neondatabase/serverless');
const { bindings } = require('./lib/runtime.cjs');

// 运行时查询走 Neon 连接池；直连 DATABASE_URL 只用来手动执行 migrations/。
function client() {
  const url = bindings().DATABASE_URL_POOLED;
  if (!url) throw new Error('DATABASE_URL_POOLED is not configured');
  return neon(url, { fullResults: true });
}

/** Native PostgreSQL parameters and result shape; no startup schema mutations. */
async function query(text, values = []) {
  const result = await client().query(text, values);
  return { rows: result.rows, rowCount: result.rowCount };
}

/** SQL console queries always run inside a database-enforced read-only transaction. */
async function readOnlyQuery(text) {
  const sql = client();
  const results = await sql.transaction([
    sql.query("SELECT set_config('statement_timeout', '5000', true), set_config('lock_timeout', '2000', true)"),
    sql.query(text)
  ], { readOnly: true, fullResults: true });
  return results[1];
}

module.exports = { query, readOnlyQuery };
