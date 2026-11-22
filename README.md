<div align="center">

# OpenStore
**OpenStore** 是一个专注于鸿蒙（HarmonyOS）应用发现与分享的第三方应用商店平台
</div>

<p align="center">
  <img 
    src="/public/favicon.svg" 
    alt="Project Favicon" 
    width="96" 
    height="96" >
  <br><br>
</p>



## 首页

首页可配置的卡片为精选专题、榜单排行和应用搜索。可在后台「首页配置」调整卡片顺序和显隐。

## 专题

专题列表仍来自市场数据上游（`/api/v0/substance/list`）。专题详情由服务端 `/api/public/topics/:id` 实时读取华为 AppGallery 网页的专题接口，结果缓存 5 分钟；专题详情页、精选专题、专题列表的图标和分享卡共用这份数据。华为已下架的专题返回 404。

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


## 关于与推荐

「关于」页固定显示站点信息、Telegram 联系入口和版权，不提供后台配置。首页「推荐」页签只保留公告和应用卡片。

## 📄 许可证

本项目基于 MIT 许可证开源。您可以在遵守许可证条款的前提下自由使用、修改和分发本项目的代码。

[MIT License](LICENSE)
