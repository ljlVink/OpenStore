import jwt from 'jsonwebtoken';
import { jwtSecretOf } from './lib/secret.cjs';

function tokenFromRequest(request) {
  const authorization = request.headers.get('Authorization') || '';
  if (authorization.startsWith('Bearer ')) return authorization.slice(7);
  const protocols = (request.headers.get('Sec-WebSocket-Protocol') || '')
    .split(',').map(value => value.trim());
  const bearer = protocols.findIndex(value => value.toLowerCase() === 'bearer');
  if (bearer >= 0 && protocols[bearer + 1]) return protocols[bearer + 1];
  return new URL(request.url).searchParams.get('token') || '';
}

/** One shared admin channel; socket attachments and alarms survive hibernation. */
export class Realtime {
  constructor(ctx, env) {
    this.ctx = ctx;
    this.env = env;
  }

  async fetch(request) {
    const pathname = new URL(request.url).pathname;
    const secret = jwtSecretOf(this.env);
    if (pathname === '/broadcast' && request.method === 'POST') {
      if (request.headers.get('X-Realtime-Secret') !== secret) {
        return new Response('Unauthorized', { status: 401 });
      }
      const event = await request.json();
      const message = JSON.stringify({ type: event.type, payload: event.payload, ts: event.ts });
      for (const socket of this.liveSockets()) {
        try { socket.send(message); } catch { socket.close(1011, 'send failed'); }
      }
      await this.scheduleExpiry();
      return new Response(null, { status: 204 });
    }
    if (pathname !== '/ws') return new Response('Not Found', { status: 404 });
    if (request.method !== 'GET' || request.headers.get('Upgrade')?.toLowerCase() !== 'websocket') {
      return new Response('WebSocket upgrade required', { status: 426 });
    }

    let auth;
    try {
      auth = jwt.verify(tokenFromRequest(request), secret, { algorithms: ['HS256'] });
    } catch {
      return new Response('Unauthorized', { status: 401 });
    }
    if (!auth || typeof auth !== 'object' || auth.role !== 'admin' ||
        !Number.isFinite(auth.exp) || auth.exp * 1000 <= Date.now()) {
      return new Response('Unauthorized', { status: 401 });
    }

    const pair = new WebSocketPair();
    const [client, server] = Object.values(pair);
    server.serializeAttachment({ exp: auth.exp });
    this.ctx.acceptWebSocket(server);
    await this.scheduleExpiry();
    const headers = new Headers();
    const protocols = (request.headers.get('Sec-WebSocket-Protocol') || '')
      .split(',').map(value => value.trim());
    if (protocols.includes('bearer')) headers.set('Sec-WebSocket-Protocol', 'bearer');
    return new Response(null, { status: 101, webSocket: client, headers });
  }

  liveSockets() {
    const now = Date.now();
    const sockets = [];
    for (const socket of this.ctx.getWebSockets()) {
      if (socket.readyState !== WebSocket.OPEN) continue;
      const exp = socket.deserializeAttachment()?.exp;
      if (!Number.isFinite(exp) || exp * 1000 <= now) {
        socket.close(4401, 'token expired');
      } else {
        sockets.push(socket);
      }
    }
    return sockets;
  }

  async scheduleExpiry() {
    let next = Infinity;
    for (const socket of this.liveSockets()) {
      next = Math.min(next, socket.deserializeAttachment().exp * 1000);
    }
    if (Number.isFinite(next)) await this.ctx.storage.setAlarm(next);
    else await this.ctx.storage.deleteAlarm();
  }

  async alarm() {
    await this.scheduleExpiry();
  }

  async webSocketMessage(socket) {
    const exp = socket.deserializeAttachment()?.exp;
    if (!Number.isFinite(exp) || exp * 1000 <= Date.now()) {
      socket.close(4401, 'token expired');
      await this.scheduleExpiry();
    }
  }

  async webSocketClose(socket) {
    socket.close(1000, 'connection closed');
    await this.scheduleExpiry();
  }

  async webSocketError(socket) {
    socket.close(1011, 'connection error');
    await this.scheduleExpiry();
  }
}
