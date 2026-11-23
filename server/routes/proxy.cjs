/*
 * 上游代理：/api/v0 透传
 */
const express = require('express');
const { createProxy } = require('../lib/proxy.cjs');

const router = express.Router();

// 脚本护栏已改为 app 级全站挂载（见 server/index.cjs），这里不再单独挂，避免同一请求重复计数。

// /api/v0 -> https://shenjack.top:10003/api/v0
router.use('/api/v0', createProxy(process.env.VITE_API_TARGET || 'https://shenjack.top:10003'));

module.exports = router;
