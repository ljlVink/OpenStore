import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'
import Components from 'unplugin-vue-components/vite'
import { ElementPlusResolver } from 'unplugin-vue-components/resolvers'
import fs from 'node:fs'
import path from 'node:path'

/*
 * 构建前把临时目录切到项目内的 build-tmp：Windows Defender / 360 的实时扫描会占住
 * esbuild 放在系统 %TEMP% 的临时文件，报 `[vite:esbuild-transpile] remove ... Access is denied`。
 * esbuild 取的是 Node 的 os.tmpdir()（Windows 上是 TEMP / TMP），子进程会继承这套变量；
 * 去掉这段，构建收尾会复现上面的错误。
 */
(function redirectTempDirToProjectLocal() {
  const tmpRoot = path.resolve(process.cwd(), 'build-tmp')
  try {
    fs.mkdirSync(tmpRoot, { recursive: true })
  } catch (_) {
    return
  }
  for (const key of ['TEMP', 'TMP', 'TMPDIR', 'ESBUILD_TMPDIR']) {
    process.env[key] = tmpRoot
  }
})()

// https://vite.dev/config/
export default defineConfig({
    plugins: [
      vue(),
      // Element Plus 按需引入：只把模板里真正用到的组件及其样式打进包。
      // 之前是全量 import，入口包里塞了 ~1MB JS + 400KB CSS。
      Components({
        resolvers: [ElementPlusResolver({ importStyle: 'css' })],
        // v-loading 这类指令也要按需引入，否则会报 "Failed to resolve directive: loading"
        directives: true,
        dts: false,
        // 自己 import 的组件（图标等）不重复生成
        dirs: ['src/components']
      }),
    ],
    test: {
      environment: 'jsdom',
      // 测试统一放 tests/，与 src 分开
      include: ['tests/**/*.test.ts'],
      // 内联 element-plus：否则 vitest 把它交给 Node 加载，撞上它按需导入的 .css 会报错
      server: {
        deps: {
          inline: ['element-plus'],
        },
      },
    },
    build: {
      rollupOptions: {
        output: {
          /*
           * 拆出来的碎片 chunk 太多（100 多个，其中一堆只有几百字节~1KB，
           * 每个都要单独发一个请求、还要多一个 .gz 旁文件）。
           * 让 Rollup 把这类小 chunk 合并回引用它们的 chunk，文件数直接降下来。
           */
          experimentalMinChunkSize: 30 * 1024,
        },
      },
    },
    // Frontend HMR; production API and WebSocket routing belong to the Worker.
    server: {
      proxy: {
        '/api': {
          target: 'http://localhost:8787',
          changeOrigin: true,
        },
        '/ws': {
          target: 'http://localhost:8787',
          ws: true,
          changeOrigin: true,
        }
      }
    }
})
