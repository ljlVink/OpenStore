import { createServer } from 'node:http';
import { httpServerHandler } from 'cloudflare:node';
import app from './index.cjs';
import runtime from './lib/runtime.cjs';
import realtime from './lib/realtime.cjs';
import seo from './lib/seo-submit.cjs';
export { Realtime } from './realtime-do.mjs';

const http = httpServerHandler(createServer(app));

export default {
  fetch(request, env, ctx) {
    return runtime.runWithRuntime(env, ctx, request, async () => {
      const url = new URL(request.url);
      if (url.pathname === '/ws') return realtime.handleWebSocket(request);
      const response = await http.fetch(request, env, ctx);
      if (!runtime.useAssetFallback()) return response;

      const asset = await env.ASSETS.fetch(request);
      // 只有页面导航回退到 index.html；/apps/com.example.app 这类带点的包名路由也属于页面
      if (asset.status !== 404 || !request.headers.get('Accept')?.includes('text/html')) return asset;
      return env.ASSETS.fetch(new Request(new URL('/index.html', url), request));
    });
  },

  scheduled(controller, env, ctx) {
    return runtime.runWithRuntime(env, ctx, undefined, () =>
      seo.runDailyTick({ scheduledTime: controller.scheduledTime })
    );
  }
};
