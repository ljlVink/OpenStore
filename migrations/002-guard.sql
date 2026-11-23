-- Runtime abuse protection is shared by every Worker isolate. All times below
-- are integer Unix milliseconds; public incident tables retain Unix seconds.
CREATE TABLE IF NOT EXISTS login_failures (
  key TEXT PRIMARY KEY,
  count INTEGER NOT NULL DEFAULT 0,
  first_at BIGINT NOT NULL,
  locked_until BIGINT NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS script_guard_state (
  ip TEXT PRIMARY KEY,
  hits BIGINT[] NOT NULL DEFAULT '{}',
  strikes INTEGER NOT NULL DEFAULT 0,
  blocked_until BIGINT NOT NULL DEFAULT 0,
  ua TEXT NOT NULL DEFAULT '',
  script_requests BIGINT NOT NULL DEFAULT 0,
  warned BIGINT NOT NULL DEFAULT 0,
  blocked BIGINT NOT NULL DEFAULT 0
);
ALTER TABLE script_guard_bans ADD COLUMN IF NOT EXISTS hits BIGINT NOT NULL DEFAULT 0;

CREATE OR REPLACE FUNCTION record_login_failure(p_key TEXT, p_max INTEGER, p_lock_ms BIGINT)
RETURNS VOID LANGUAGE plpgsql AS $$
DECLARE
  v_now BIGINT := floor(extract(epoch FROM clock_timestamp()) * 1000)::bigint;
  v_entry login_failures%ROWTYPE;
BEGIN
  INSERT INTO login_failures(key, first_at) VALUES (p_key, v_now) ON CONFLICT DO NOTHING;
  SELECT * INTO v_entry FROM login_failures WHERE key = p_key FOR UPDATE;
  v_now := floor(extract(epoch FROM clock_timestamp()) * 1000)::bigint;
  IF v_now - v_entry.first_at >= p_lock_ms AND v_entry.locked_until <= v_now THEN
    v_entry.count := 0;
    v_entry.first_at := v_now;
    v_entry.locked_until := 0;
  END IF;
  v_entry.count := LEAST(v_entry.count::bigint + 1, 2147483647)::integer;
  IF v_entry.count >= p_max THEN
    v_entry.locked_until := v_now + p_lock_ms;
  END IF;
  UPDATE login_failures SET count = v_entry.count, first_at = v_entry.first_at,
    locked_until = v_entry.locked_until WHERE key = p_key;
END;
$$;

CREATE OR REPLACE FUNCTION script_guard_hit(
  p_ip TEXT, p_ua TEXT, p_path TEXT, p_location TEXT,
  p_free INTEGER, p_window_ms BIGINT, p_base_ms BIGINT, p_max_ms BIGINT, p_force BOOLEAN
) RETURNS TABLE(strikes INTEGER, block_ms BIGINT, remain_ms BIGINT, new_block BOOLEAN)
LANGUAGE plpgsql AS $$
DECLARE
  v_now BIGINT;
  v_entry script_guard_state%ROWTYPE;
  v_hits BIGINT[];
  v_used INTEGER;
  v_block BIGINT := 0;
  v_new BOOLEAN := FALSE;
BEGIN
  INSERT INTO script_guard_state(ip) VALUES (p_ip) ON CONFLICT DO NOTHING;
  SELECT * INTO v_entry FROM script_guard_state WHERE ip = p_ip FOR UPDATE;
  v_now := floor(extract(epoch FROM clock_timestamp()) * 1000)::bigint;
  v_entry.ua := left(p_ua, 200);
  v_entry.script_requests := v_entry.script_requests + 1;
  IF NOT p_force AND v_entry.blocked_until > v_now THEN
    v_entry.blocked := v_entry.blocked + 1;
  ELSE
    SELECT COALESCE(array_agg(t), '{}'::bigint[]) INTO v_hits
      FROM unnest(v_entry.hits) AS t WHERE t > v_now - p_window_ms;
    v_used := cardinality(v_hits);
    IF p_force OR v_used >= p_free THEN
      v_entry.strikes := LEAST(v_entry.strikes::bigint + 1, 2147483647)::integer;
      -- Clamp the exponent before computing it, even after years of strikes.
      v_block := LEAST(p_base_ms::numeric * power(4::numeric, LEAST(v_entry.strikes - 1, 32)), p_max_ms)::bigint;
      v_entry.blocked_until := v_now + v_block;
      v_entry.hits := '{}';
      v_entry.warned := v_entry.warned + 1;
      v_new := TRUE;
      INSERT INTO script_guard_blocks(ip, location, ua, path, hits, strikes, block_ms)
        VALUES (p_ip, left(p_location, 200), v_entry.ua, left(p_path, 300),
          CASE WHEN p_force THEN p_free ELSE v_used END, v_entry.strikes, v_block);
      DELETE FROM script_guard_blocks
        WHERE id <= (SELECT max(id) - 1000 FROM script_guard_blocks);
    ELSE
      v_entry.hits := array_append(v_hits, v_now);
    END IF;
  END IF;
  UPDATE script_guard_state SET hits = v_entry.hits, strikes = v_entry.strikes,
    blocked_until = v_entry.blocked_until, ua = v_entry.ua,
    script_requests = v_entry.script_requests, warned = v_entry.warned, blocked = v_entry.blocked
    WHERE ip = p_ip;
  RETURN QUERY SELECT v_entry.strikes, v_block, GREATEST(v_entry.blocked_until - v_now, 0), v_new;
END;
$$;
