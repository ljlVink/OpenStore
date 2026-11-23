/*
 * 数据库时间戳的展示格式化。
 *
 * PostgreSQL 的 TIMESTAMPTZ 经接口输出为带 Z 的 ISO 字符串；不带时区标记的
 * "YYYY-MM-DD HH:MM:SS" 一律按 UTC 解释。直接交给 new Date() 会被当成「本地时间」，
 * 在 UTC+8 的机器上日期和时刻都会错位，所以这里先补 Z 再转北京时间展示。
 */

/** 数据库时间戳 → Date（无时区标记时按 UTC 解释） */
export const parseDbTime = (value: string | number | Date | null | undefined): Date | null => {
  if (value === null || value === undefined || value === '') return null;
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value;

  const raw = String(value).trim();
  if (!raw) return null;

  // 纯数字：按毫秒时间戳处理
  if (/^\d+$/.test(raw)) {
    const ms = Number(raw);
    const date = new Date(ms);
    return Number.isNaN(date.getTime()) ? null : date;
  }

  // 已带时区标记（Z 或 ±HH:MM）的原样解析
  const hasZone = /(?:Z|[+-]\d{2}:?\d{2})$/.test(raw);
  const normalized = hasZone ? raw : `${raw.replace(' ', 'T')}Z`;
  const date = new Date(normalized);
  return Number.isNaN(date.getTime()) ? null : date;
};

/** 格式化为北京时间字符串，例如 2026/10/14 01:26:46 */
export const formatDbTime = (value: string | number | Date | null | undefined, fallback = '—'): string => {
  const date = parseDbTime(value);
  if (!date) return fallback;
  return date.toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai', hour12: false });
};

/** 只要北京时间的日期部分，例如 2026/10/14 */
export const formatDbDate = (value: string | number | Date | null | undefined, fallback = '—'): string => {
  const date = parseDbTime(value);
  if (!date) return fallback;
  return date.toLocaleDateString('zh-CN', { timeZone: 'Asia/Shanghai' });
};
