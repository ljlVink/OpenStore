// @vitest-environment node
import { once } from 'node:events';
import { spawn, type ChildProcess } from 'node:child_process';
import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { request, type IncomingMessage } from 'node:http';
import { tmpdir } from 'node:os';
import { basename, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { expect, it, vi } from 'vitest';

it('管理员改密不写 .env，旧初始化密码也不会在重启后覆盖 SQLite', async () => {
  const root = mkdtempSync(join(tmpdir(), 'closestore-auth-'));
  const server = join(root, 'server');
  const envPath = join(root, '.env');
  const initialPassword = 'Bootstrap9!';
  const adminPassword = 'ChangedAdmin9!';
  const finalPassword = 'ChangedAgain9!';
  const envFile = `ADMIN_PASSWORD=${initialPassword}\n`;
  const env: NodeJS.ProcessEnv = {
    ...process.env,
    NODE_PATH: fileURLToPath(new URL('../../node_modules', import.meta.url)),
    SCRIPT_GUARD_ENABLED: '0',
    LOGIN_MAX_FAILURES: '100',
  };
  delete env.ADMIN_PASSWORD;
  let child: ChildProcess | undefined;

  const stop = async () => {
    if (child?.kill()) await once(child, 'exit');
  };
  const start = async (run: number) => {
    const socketPath = process.platform === 'win32'
      ? `\\\\.\\pipe\\${basename(root)}-${run}`
      : join(root, `${run}.sock`);
    const processHandle = spawn(process.execPath, [join(server, 'index.cjs')], {
      cwd: root, env: { ...env, PORT: socketPath }, stdio: ['ignore', 'pipe', 'pipe'],
    });
    child = processHandle;
    let output = '';
    processHandle.stdout.on('data', chunk => { output += chunk; });
    processHandle.stderr.on('data', chunk => { output += chunk; });
    await vi.waitFor(() => expect(output).toContain('Backend server running'), { timeout: 5000 });

    return async (path: string, data: Record<string, string>, token?: string) => {
      const headers: Record<string, string> = { 'Content-Type': 'application/json' };
      if (token) headers.Authorization = `Bearer ${token}`;
      const req = request({
        socketPath, path, method: 'POST', headers, signal: AbortSignal.timeout(2000),
      });
      const pending = once(req, 'response');
      req.end(JSON.stringify(data));
      const [res] = await pending as [IncomingMessage];
      let body = '';
      for await (const chunk of res.setEncoding('utf8')) body += chunk;
      const payload: unknown = JSON.parse(body);
      const authToken = payload && typeof payload === 'object' && 'token' in payload &&
        typeof payload.token === 'string' ? payload.token : undefined;
      return { status: res.statusCode, token: authToken };
    };
  };

  try {
    mkdirSync(server);
    for (const entry of ['index.cjs', 'database.cjs', 'lib', 'middleware', 'routes']) {
      cpSync(new URL(`../../server/${entry}`, import.meta.url), join(server, entry), { recursive: true });
    }
    writeFileSync(envPath, envFile);
    const first = await start(1);
    const login = (api: typeof first, password: string) => api('/api/admin/auth/login', { username: 'admin', password });
    const loginBefore = await vi.waitFor(async () => {
      const result = await login(first, initialPassword);
      expect(result.status).toBe(200);
      return result;
    });
    const change = (path: string, old_password: string, new_password: string) =>
      first(path, { old_password, new_password }, loginBefore.token);
    expect((await change('/api/admin/auth/change-password', initialPassword, adminPassword)).status).toBe(200);
    expect((await change('/api/auth/change-password', adminPassword, finalPassword)).status).toBe(200);
    expect(readFileSync(envPath, 'utf8')).toBe(envFile);
    await stop();

    const restarted = await start(2);
    expect((await login(restarted, finalPassword)).status).toBe(200);
    expect((await login(restarted, initialPassword)).status).toBe(401);
  } finally {
    await stop();
    rmSync(root, { recursive: true, force: true });
  }
}, 15000);
