/*
 * 修改管理员密码时写回项目根目录的 .env。
 */
const fs = require('fs');
const path = require('path');

const envFilePath = path.join(__dirname, '..', '..', '.env');

const ENV_LINE_RE = /^\s*([A-Za-z0-9_]+)\s*=\s*(.*)$/;

/** 定位注释起点在 rest 中的下标；无注释返回 -1。引号内的 # 忽略 */
const findCommentStart = (rest) => {
  const text = String(rest == null ? '' : rest);
  const quoted = /^(\s*)(["'])([\s\S]*?)\2/.exec(text);
  const searchFrom = quoted ? quoted[0].length : 0;
  const tail = text.slice(searchFrom);
  const hashIndex = tail.search(/(^|\s)#/);
  if (hashIndex === -1) return -1;
  return searchFrom + (tail[hashIndex] === '#' ? hashIndex : hashIndex + 1);
};

/** 读取文件内容，不存在时返回空串 */
function readEnvContent() {
  try {
    return fs.existsSync(envFilePath) ? fs.readFileSync(envFilePath, 'utf8') : '';
  } catch {
    return '';
  }
}

/**
 * 原地更新一个键。
 * 命中已有行时只替换值，注释与原格式保留；不存在时追加到文件末尾。
 */
function writeEnvKey(key, value) {
  const content = readEnvContent();
  const lines = content.length ? content.split(/\r?\n/) : [];
  const safeValue = String(value == null ? '' : value);
  let found = false;

  const nextLines = lines.map((line) => {
    const match = ENV_LINE_RE.exec(line);
    if (!match || match[1] !== key) return line;
    found = true;

    // 保留 `KEY=` 与值之间的空格，以及注释及其前面的空格
    const rest = match[2];
    const commentStart = findCommentStart(rest);
    const trailing = commentStart === -1 ? '' : rest.slice(commentStart).replace(/\s+$/, '');
    const gapBeforeValue = /^\s*/.exec(rest)[0];
    const separator = trailing ? (commentStart > 0 ? ' ' : '') : '';
    return `${key}=${gapBeforeValue}${safeValue}${separator}${trailing}`;
  });

  if (!found) {
    // 末尾若已有空行，插入到空行之前
    if (nextLines.length && nextLines[nextLines.length - 1] !== '') nextLines.push(`${key}=${safeValue}`);
    else nextLines.splice(Math.max(0, nextLines.length - 1), 0, `${key}=${safeValue}`);
  }

  fs.writeFileSync(envFilePath, nextLines.join('\n'));
}

module.exports = { writeEnvKey };
