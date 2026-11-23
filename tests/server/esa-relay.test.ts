import { createRequire } from 'node:module';
import { AxiosHeaders } from 'axios';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { handleRelay } from '../../relay/esa/index.js';

const require = createRequire(import.meta.url);
const { routeThroughRelay } = require('../../server/lib/appgallery-client.cjs');

const SECRET = 'relay-test-secret';
const NOW = 1_795_400_000_000;
const env = { APPGALLERY_RELAY_URL: 'https://relay.example.com/', APPGALLERY_RELAY_SECRET: SECRET };

function signedRequest(overrides: Record<string, unknown> = {}) {
  const config = routeThroughRelay({
    baseURL: 'https://web-drcn.hispace.dbankcloud.com/edge',
    url: '/webedge/appinfo',
    method: 'post',
    data: { appId: 'C6917560816735994213', locale: 'zh_CN' },
    headers: new AxiosHeaders({ 'Identity-Id': 'abc123', 'CF-Worker': 'ag.ljlvink.top' }),
    ...overrides
  }, env, NOW);
  return {
    config,
    request: (body = config.data) => new Request(config.url, {
      method: String(config.method).toUpperCase(),
      headers: config.headers.toJSON(),
      body
    })
  };
}

function stubUpstream() {
  const upstream = vi.fn(async (_url: string, _init: RequestInit) => new Response('{"appId":"C1"}', {
    status: 200,
    headers: { 'content-type': 'application/json', 'set-cookie': 'HWWAFSESID=1' }
  }));
  vi.stubGlobal('fetch', upstream);
  return upstream;
}

afterEach(() => vi.unstubAllGlobals());

describe('ESA relay', () => {
  it('forwards a Worker-signed request to the upstream with only allowlisted headers', async () => {
    const upstream = stubUpstream();
    const { config, request } = signedRequest();
    expect(config.url).toBe('https://relay.example.com/web-drcn.hispace.dbankcloud.com/edge/webedge/appinfo');

    const response = await handleRelay(request(), SECRET, NOW);

    expect(response.status).toBe(200);
    expect(await response.text()).toBe('{"appId":"C1"}');
    expect(response.headers.get('set-cookie')).toBeNull();
    const [url, init] = upstream.mock.calls[0];
    expect(url).toBe('https://web-drcn.hispace.dbankcloud.com/edge/webedge/appinfo');
    expect(init.method).toBe('POST');
    expect(new TextDecoder().decode(init.body as Uint8Array)).toBe('{"appId":"C6917560816735994213","locale":"zh_CN"}');
    const headers = init.headers as Headers;
    expect(headers.get('identity-id')).toBe('abc123');
    expect(headers.get('cf-worker')).toBeNull();
    expect(headers.get('x-relay-signature')).toBeNull();
  });

  it('signs GET query strings', async () => {
    const upstream = stubUpstream();
    const { request } = signedRequest({ url: '/webedge/getInterfaceCode', method: 'get', data: undefined, params: { a: '1 2' } });

    expect((await handleRelay(request(undefined), SECRET, NOW)).status).toBe(200);
    expect(upstream.mock.calls[0][0]).toBe('https://web-drcn.hispace.dbankcloud.com/edge/webedge/getInterfaceCode?a=1+2');
  });

  it('rejects a tampered body', async () => {
    const upstream = stubUpstream();
    const { request } = signedRequest();

    const response = await handleRelay(request('{"appId":"C1"}'), SECRET, NOW);

    expect(response.status).toBe(401);
    expect(upstream).not.toHaveBeenCalled();
  });

  it('rejects a wrong secret and a stale timestamp', async () => {
    const upstream = stubUpstream();
    const { request } = signedRequest();

    expect((await handleRelay(request(), 'other-secret', NOW)).status).toBe(401);
    expect((await handleRelay(request(), SECRET, NOW + 61_000)).status).toBe(401);
    expect(upstream).not.toHaveBeenCalled();
  });

  it('refuses upstreams outside the allowlist', async () => {
    const upstream = stubUpstream();
    const { request } = signedRequest({ baseURL: 'https://example.com/edge' });

    expect((await handleRelay(request(), SECRET, NOW)).status).toBe(403);
    expect(upstream).not.toHaveBeenCalled();
  });

  it('leaves requests untouched when no relay is configured', () => {
    const config = { baseURL: 'https://web-drcn.hispace.dbankcloud.com/edge', url: '/webedge/appinfo', headers: new AxiosHeaders() };
    expect(routeThroughRelay(config, {}, NOW)).toEqual(config);
  });
});
