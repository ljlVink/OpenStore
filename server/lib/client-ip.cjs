/* Trust only metadata on the native Workers request, never adapter headers. */
const net = require('node:net');
const { incomingRequest } = require('./runtime.cjs');

const normalizeIp = (raw) => {
  let ip = String(raw || '').trim();
  if (ip.startsWith('::ffff:')) ip = ip.slice(7);
  else if (ip === '::1') ip = '127.0.0.1';
  return ip;
};

const getClientIp = () => {
  const ip = normalizeIp(incomingRequest()?.headers.get('CF-Connecting-IP'));
  return net.isIP(ip) ? ip : '';
};

const getClientLocation = () => {
  const cf = incomingRequest()?.cf;
  return [cf?.city, cf?.country].filter(Boolean).join(' ');
};

module.exports = { normalizeIp, getClientIp, getClientLocation };
