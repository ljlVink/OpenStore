<div align="center">

# CloseStore
**CloseStore** 是一个专注于鸿蒙（HarmonyOS）应用发现与分享的第三方应用商店平台

应用和游戏各有独立的精选、分类、排行榜和重磅更新，数据直接来自华为应用市场平板客户端，不依赖 Shenjack，也不展示下载量或应用总数。

探索、应用、游戏页共用搜索框；从探索页搜索会进入应用搜索结果。

本项目基于 [XiaoChuangll/OpenStore](https://github.com/XiaoChuangll/OpenStore)（MIT License）修改。
</div>

<p align="center">
  <img 
    src="/public/favicon.svg" 
    alt="Project Favicon" 
    width="96" 
    height="96" >
  <br><br>
</p>

## WARNINGS

THIS PROJECT IS UNDER DEVELOPMENT.

## 数据库（Neon）

后端只用 Neon PostgreSQL，不再使用 SQLite，也没有文件上传。

- `DATABASE_URL_POOLED`：Neon 池化连接，Worker 运行时的所有查询都走它。本地写在 `.env`（`wrangler dev` 会读取），线上用 `wrangler secret put DATABASE_URL_POOLED` 写入。
- `DATABASE_URL`：Neon 直连，只用来手动执行 `migrations/` 建表，不需要配到 Worker。

Neon 库里还没有表时，所有请求都会返回 500。部署前按顺序执行建表脚本（Worker 启动时不会改 schema）：

```sh
psql "$DATABASE_URL" -f migrations/001-initial.sql -f migrations/002-guard.sql
```

新库里没有管理员账号，手动插入一个（密码用 bcrypt 哈希）：

```sh
HASH=$(node -e "console.log(require('bcryptjs').hashSync(process.argv[1], 10))" '<密码>')
psql "$DATABASE_URL" -c "INSERT INTO users (username, password_hash, role) VALUES ('admin', '$HASH', 'admin')"
```

`ENV_SECRET_KEY` 是 SEO 配置里 Bing key 的加密密钥（32 字节 hex），没配置时保存 Bing key 会失败。新部署用 `openssl rand -hex 32` 生成；从旧库迁移时要沿用原来的 `server/secret.key` 才能解密已存的 key，转成 hex：`node -e "console.log(require('fs').readFileSync('server/secret.key').toString('hex'))"`。线上用 `wrangler secret put ENV_SECRET_KEY` 写入。

## ❤️ 鸣谢

感谢以下贡献者对本项目的支持：

<div style="display: flex; gap: 10px;">
  <a href="https://github.com/XiaoChuangll" title="XiaoChuangll">
    <img src="https://wsrv.nl/?url=github.com/XiaoChuangll.png&w=400&h=400&mask=circle" width="60" alt="XiaoChuangll"/>
  </a>
  <a href="https://github.com/shenjackyuanjie" title="shenjackyuanjie">
    <img src="https://wsrv.nl/?url=github.com/shenjackyuanjie.png&w=400&h=400&mask=circle" width="60" alt="shenjackyuanjie"/>
  </a>
</div>

## 📄 许可证

本项目基于 MIT 许可证开源。您可以在遵守许可证条款的前提下自由使用、修改和分发本项目的代码。

[MIT License](LICENSE)
