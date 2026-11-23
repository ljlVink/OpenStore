// AES-256-GCM. Carry the same hex key forward when importing existing settings.
const crypto = require('node:crypto');
const { bindings } = require('./runtime.cjs');

/** JWT 密钥：去掉首尾空白后不能为空，也不能是示例默认值；HTTP 鉴权和 Durable Object 共用这条规则 */
function jwtSecretOf(env) {
  const secret = String(env?.JWT_SECRET || '').trim();
  if (!secret || secret === 'dev-secret-change-me') throw new Error('JWT_SECRET binding is required');
  return secret;
}

function getSecretKey() {
  const key = bindings().ENV_SECRET_KEY;
  if (!/^[a-f0-9]{64}$/i.test(key || '')) {
    throw new Error('ENV_SECRET_KEY must be a 32-byte hex Workers secret');
  }
  return Buffer.from(key, 'hex');
}

function encrypt(text) {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', getSecretKey(), iv);
  const enc = Buffer.concat([cipher.update(text, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return Buffer.concat([iv, tag, enc]).toString('base64');
}

function decrypt(data) {
  // 没存过密文就是未配置，不要求 ENV_SECRET_KEY。
  if (!data) return '';
  const key = getSecretKey();
  try {
    const buf = Buffer.from(data, 'base64');
    const iv = buf.slice(0, 12);
    const tag = buf.slice(12, 28);
    const enc = buf.slice(28);
    const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv);
    decipher.setAuthTag(tag);
    const dec = Buffer.concat([decipher.update(enc), decipher.final()]);
    return dec.toString('utf8');
  } catch {
    return '';
  }
}

module.exports = { encrypt, decrypt, jwtSecretOf };
