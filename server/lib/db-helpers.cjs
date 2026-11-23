const { query } = require('../database.cjs');

/** Only interpolate identifiers verified against PostgreSQL's catalogs. */
const quoteIdent = (name) => `"${String(name).replace(/"/g, '""')}"`;
const tableIdent = (name) => `"public".${quoteIdent(name)}`;

async function listUserTables() {
  const { rows } = await query(
    `SELECT tablename AS name FROM pg_catalog.pg_tables WHERE schemaname = 'public' ORDER BY tablename`
  );
  return rows.map((row) => row.name);
}

async function tableColumns(name) {
  const { rows } = await query(
    `SELECT a.attname AS name, pg_catalog.format_type(a.atttypid, a.atttypmod) AS type,
            EXISTS (SELECT 1 FROM pg_catalog.pg_index i
                    WHERE i.indrelid = c.oid AND i.indisprimary AND a.attnum = ANY(i.indkey)) AS pk
     FROM pg_catalog.pg_attribute a
     JOIN pg_catalog.pg_class c ON c.oid = a.attrelid
     JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
     WHERE n.nspname = 'public' AND c.relname = $1 AND a.attnum > 0 AND NOT a.attisdropped
     ORDER BY a.attnum`, [name]
  );
  return rows;
}

async function countRows(name) {
  const { rows } = await query(`SELECT COUNT(*) AS count FROM ${tableIdent(name)}`);
  return Number(rows[0].count);
}

module.exports = { quoteIdent, tableIdent, listUserTables, tableColumns, countRows };
