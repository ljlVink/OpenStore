/*
 * 后端日志：统一入口 pushLiveLog()，按规则打到终端（或 pm2 / systemd 日志）。
 * 请求级日志由 index.cjs 里的中间件写入。
 *
 * 规则：
 *   - 所有 warn / error 无条件打印（4xx、5xx、上游失败等，量小且必须看得到）；
 *   - 慢调用也打印（默认 ≥1s），最容易忽略的就是"没报错但很慢"；
 *   - 高频请求日志只在失败或耗时过长时打印；
 *   - 其余低频事件（缓存构建、系统提示）正常打印。
 *
 * 需要完整访问日志时设 ACCESS_LOG=1（两类高频事件全打）。
 */
const ACCESS_LOG = String(process.env.ACCESS_LOG || '') === '1';
const SLOW_REQUEST_MS = Number(process.env.SLOW_REQUEST_MS || 1000);
const hhmmss = () => new Date().toTimeString().slice(0, 8);

/** 这两类事件是「每个请求一条」，只在慢或出错时才值得打到终端 */
const HIGH_FREQUENCY_KINDS = new Set(['request', 'upstream']);

const shouldPrint = (level, meta) => {
  if (ACCESS_LOG) return true;
  if (level === 'warn' || level === 'error') return true;
  if (meta && HIGH_FREQUENCY_KINDS.has(meta.kind)) return Number(meta.ms || 0) >= SLOW_REQUEST_MS;
  return true;
};

/**
 * meta 里可带结构化信息，决定是否打印：
 * - kind: 'request' | 'cache' | 'upstream' | 'system'
 * - ms: 耗时，高频事件只在慢时打印
 */
const pushLiveLog = (level, message, meta) => {
  if (!shouldPrint(level, meta)) return;
  const line = `[${hhmmss()}] ${String(level).toUpperCase().padEnd(5)} ${String(message).slice(0, 400)}`;
  if (level === 'error') console.error(line);
  else if (level === 'warn') console.warn(line);
  else console.log(line);
};

module.exports = { pushLiveLog };
