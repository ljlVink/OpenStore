const sqlite3 = require('sqlite3').verbose();
const path = require('path');
// IndexNow key 需要在建表阶段就随机生成一次，这里要用到 crypto
const crypto = require('crypto');

const dbPath = path.resolve(__dirname, 'visitors.db');
const db = new sqlite3.Database(dbPath, (err) => {
  if (err) {
    console.error('Could not connect to database', err);
  } else {
    console.log('Connected to SQLite database');
  }
});

/*
 * SQLite 默认一撞上写锁就立刻抛 SQLITE_BUSY。
 * 后台维护（VACUUM、切日志模式）和前台写入撞在一起时就会报 "database is locked"，
 * 这里给 5 秒等待窗口：让它排队等锁，而不是直接失败。
 */
db.configure('busyTimeout', 5000);

db.serialize(() => {
  /*
   * 已下线功能的表：访客记录（不再记录 IP / UA / 归属地）、异常应用屏蔽名单。
   * 老库里有的话一次性删掉（索引随表删除），再 VACUUM 把数据页真正抹掉、收回磁盘。
   * 都不存在时什么都不做，正常启动不会多跑 VACUUM。
   *
   * 不能在查询回调里直接 DROP：那时查询语句还没 finalize，会报 SQLITE_LOCKED，
   * 所以推到 setImmediate 之后再执行。
   */
  const RETIRED_TABLES = ['visitors', 'blocked_apps'];
  db.all(
    `SELECT name FROM sqlite_master WHERE type = 'table' AND name IN (${RETIRED_TABLES.map(() => '?').join(', ')})`,
    RETIRED_TABLES,
    (err, rows) => {
      if (err || !rows || !rows.length) return;
      const names = rows.map((row) => row.name);
      setImmediate(() => {
        db.exec(`${names.map((name) => `DROP TABLE IF EXISTS ${name};`).join(' ')} VACUUM;`, (execErr) => {
          if (execErr) console.error('[database] 删除已下线的表失败：', execErr.message);
          else console.log(`[database] 已删除已下线的表 ${names.join(', ')} 并完成 VACUUM`);
        });
      });
    }
  );

  db.run(`CREATE TABLE IF NOT EXISTS system_settings (
    key TEXT PRIMARY KEY,
    value TEXT,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
  )`);

  db.run(`CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    username TEXT UNIQUE NOT NULL,
    password_hash TEXT NOT NULL,
    role TEXT DEFAULT 'admin',
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  )`);

  db.run(`CREATE TABLE IF NOT EXISTS operation_logs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    actor TEXT,
    action TEXT,
    entity TEXT,
    entity_id INTEGER,
    payload TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  )`);

  db.run(`CREATE TABLE IF NOT EXISTS incidents (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    title TEXT NOT NULL,
    content TEXT,
    status TEXT NOT NULL, -- investigating, identified, monitoring, resolved, scheduled
    type TEXT NOT NULL DEFAULT 'incident', -- incident, maintenance
    start_time INTEGER,
    end_time INTEGER,
    created_at INTEGER DEFAULT (strftime('%s', 'now')),
    updated_at INTEGER DEFAULT (strftime('%s', 'now'))
  )`);

  // 脚本护栏拦截记录：每次触发封禁写一条（宽限期内放行的不记）
  db.run(`CREATE TABLE IF NOT EXISTS script_guard_blocks (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    ip TEXT,
    location TEXT,
    ua TEXT,
    path TEXT,
    hits INTEGER DEFAULT 0,
    strikes INTEGER DEFAULT 1,
    block_ms INTEGER DEFAULT 0,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  )`);

  // 硬封禁名单：不区分 UA，命中后该 IP 的一切请求都返回 429；expires_at 为 NULL = 永久
  db.run(`CREATE TABLE IF NOT EXISTS script_guard_bans (
    ip TEXT PRIMARY KEY,
    reason TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    expires_at DATETIME
  )`);

  db.run(`CREATE TABLE IF NOT EXISTS apps (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    provider TEXT,
    bg_url TEXT,
    icon_url TEXT,
    download_url TEXT,
    enabled INTEGER DEFAULT 1,
    kind_name TEXT,
    average_rating TEXT,
    original_id TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
  )`);

  /*
   * ---- SEO 收录提交 ----
   *
   * seo_url_queue：待提交 URL 队列。
   * 前台路由切换时由 /api/public/track 写入原始路径，由 lib/seo-submit.cjs 聚合并提交。
   * 队列只负责「攒」，过滤、归一、限额都在提交阶段处理。
   *
   * path 为原始路径（可能带 query），不去归一化：详情页被拍平成列表页会导致提交无效。
   * 去重键是 dedupe_key（归一化后的 URL），唯一索引在下面的迁移段创建；
   * 同一 URL 的不同原始写法共用一行并累加 hits，避免重复占用提交额度。
   */
  db.run(`CREATE TABLE IF NOT EXISTS seo_url_queue (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    path TEXT NOT NULL,
    normalized_url TEXT,
    hits INTEGER DEFAULT 1,
    first_seen DATETIME DEFAULT CURRENT_TIMESTAMP,
    last_seen DATETIME DEFAULT CURRENT_TIMESTAMP,
    submit_status TEXT DEFAULT 'pending',
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
  )`);

  // 队列列表按 last_seen 倒序取最近入队的路径
  db.run('CREATE INDEX IF NOT EXISTS idx_seo_queue_last_seen ON seo_url_queue(last_seen)');
  // 早期版本的 (submit_status, last_seen) 索引无查询使用，清理掉
  db.run('DROP INDEX IF EXISTS idx_seo_queue_status_time');

  /*
   * 去重键处理：早期版本队列表带 UNIQUE(path) 且无此列，这里补齐并回填。
   * 回填取 normalized_url，缺失时退回 path；唯一索引允许 NULL，个别行未回填不影响启动。
   */
  db.all(`PRAGMA table_info(seo_url_queue)`, [], (err, queueCols) => {
    if (err || !Array.isArray(queueCols)) return;
    const hasDedupeKey = queueCols.some((col) => col.name === 'dedupe_key');
    const ensureIndex = () => {
      db.run(
        'CREATE UNIQUE INDEX IF NOT EXISTS idx_seo_queue_dedupe ON seo_url_queue(dedupe_key)',
        (indexErr) => {
          if (indexErr) console.warn('[seo] 队列去重索引创建失败（不影响启动）:', indexErr.message);
        }
      );
      db.run('ANALYZE seo_url_queue', () => {});
    };

    if (!hasDedupeKey) {
      db.run('ALTER TABLE seo_url_queue ADD COLUMN dedupe_key TEXT', (addErr) => {
        if (addErr) {
          console.warn('[seo] 队列去重列添加失败（不影响启动）:', addErr.message);
          return;
        }
        db.run(
          `UPDATE seo_url_queue SET dedupe_key = COALESCE(NULLIF(normalized_url, ''), path) WHERE dedupe_key IS NULL`,
          [],
          (backfillErr) => {
            if (backfillErr) console.warn('[seo] 队列去重回填失败:', backfillErr.message);
            ensureIndex();
          }
        );
      });
      return;
    }
    ensureIndex();
  });

  /*
   * seo_submissions：提交记录，含失败原因与脱敏后的 key（用于区分批次用的哪把 key）。
   * 明文 key 不入库，脱敏在写入前完成。
   */
  db.run(`CREATE TABLE IF NOT EXISTS seo_submissions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    url TEXT NOT NULL,
    queue_id INTEGER,
    channel TEXT,
    status TEXT,
    http_status INTEGER,
    message TEXT,
    batch_size INTEGER,
    key_masked TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  )`);

  // 取数时按 url + created_at 判断「近 4 天是否已提交/失败次数」，联合索引直接覆盖
  db.run('CREATE INDEX IF NOT EXISTS idx_seo_submissions_url_time ON seo_submissions(url, created_at)');
  // 提交记录列表按时间倒序取
  db.run('CREATE INDEX IF NOT EXISTS idx_seo_submissions_created ON seo_submissions(created_at)');
  // 早期版本的单独 url 索引被上面的联合索引覆盖，清理掉
  db.run('DROP INDEX IF EXISTS idx_seo_submissions_url');

  /** IndexNow key：8~128 位 [a-zA-Z0-9-]，首次启动生成一次，之后仅能从后台更换 */
  db.get(`SELECT value FROM system_settings WHERE key = 'seo_indexnow_key'`, [], (err, row) => {
    if (err || row) return;
    const generated = crypto.randomBytes(16).toString('hex');
    db.run(
      `INSERT INTO system_settings (key, value, updated_at) VALUES ('seo_indexnow_key', ?, CURRENT_TIMESTAMP)
       ON CONFLICT(key) DO NOTHING`,
      [generated],
      (insertErr) => {
        if (!insertErr) console.log('[seo] 已生成 IndexNow key，可在后台「SEO 收录」面板查看');
      }
    );
  });

  // Migrations: ensure new columns exist when DB was created before
  function ensureColumn(table, column, type) {
    db.all(`PRAGMA table_info(${table})`, [], (err, rows) => {
      if (err || !rows) return;
      const has = rows.some(r => r.name === column);
      if (!has) {
        db.run(`ALTER TABLE ${table} ADD COLUMN ${column} ${type}`);
      }
    });
  }
  ensureColumn('apps', 'icon_url', 'TEXT');
  ensureColumn('apps', 'kind_name', 'TEXT');
  ensureColumn('apps', 'average_rating', 'TEXT');
  ensureColumn('apps', 'original_id', 'TEXT');
  // 事故 / 维护 / 提示 卡片的图标（存图标名，前台按名字取 SVG；留空则按类型取默认图标）
  ensureColumn('incidents', 'icon', 'TEXT');
});

module.exports = db;
