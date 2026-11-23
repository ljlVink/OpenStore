/*
 * All Worker isolates publish to one hibernating Durable Object so authenticated
 * administrators receive the same events regardless of their serving isolate.
 */
const { bindings } = require('./runtime.cjs');
const { jwtSecretOf } = require('./secret.cjs');

function realtimeStub() {
  const namespace = bindings().REALTIME;
  if (!namespace) throw new Error('REALTIME binding is required');
  return namespace.get(namespace.idFromName('admin-events'));
}

async function handleWebSocket(request) {
  if (new URL(request.url).pathname !== '/ws') {
    return new Response('Not Found', { status: 404 });
  }
  if (request.method !== 'GET' || request.headers.get('Upgrade')?.toLowerCase() !== 'websocket') {
    return new Response('WebSocket upgrade required', { status: 426 });
  }
  return realtimeStub().fetch(request);
}

async function broadcast(type, payload) {
  const secret = jwtSecretOf(bindings());
  const response = await realtimeStub().fetch('https://realtime.internal/broadcast', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Realtime-Secret': secret },
    body: JSON.stringify({ type, payload, ts: Date.now() }),
  });
  if (!response.ok) throw new Error(`Realtime broadcast failed: ${response.status}`);
}

module.exports = { handleWebSocket, broadcast };
