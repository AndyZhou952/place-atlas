# 特性 — Owner PoC 统一应用操作

- 日期：2026-09-21
- 模式：interactive
- 用户确认：2026-09-21
- 状态：implement

## 问题

当前 Cloudflare 页面展示了收藏、去过、评分、评论和图片等控件，但线上只读 fixture D1 没有完整 Personal Memory 表，因此写入会失败。Web 与微信也只部分共用 `AtlasApplication`：浏览器能调用个人状态与 Visit 操作，Agent gateway 只开放独立的 Nearby 只读切片，Nearby 返回形态和目录读取仍有分叉。

这使用户不能把网页和微信当成同一个 Japan Atlas：网页按钮保存不了，微信看到的地点与个人状态不一定来自网页使用的同一事实源，后续 Add/Record 还可能重复实现业务规则。

## 目标

1. 建立一个隔离的 `owner-poc` Cloudflare 环境，以完整 D1 schema 作为 Web 与 Agent 的单一业务事实源。
2. Web 与 Agent 只使用同一组 `AtlasApplication` operations；渠道只负责鉴权、输入映射与呈现。
3. 网页保持现有暖色编辑风地图和控件，不做编辑模式重构；未登录可浏览，登录 Owner 才能写入。
4. 网页使用签名 Cookie，Agent 使用现有 owner/channel/conversation + HMAC；两种凭证不能互换。
5. 先恢复收藏、去过、评分、评论及真实 Nearby 的可用 PoC，再按独立门禁开放 Add 和 Record。
6. 精确 `/jpmap` 命令先以确定性 parser 执行；DeepSeek 只在项目、权限和允许操作已确定后，把模糊语义翻译为 typed proposal。

## 范围

- 新建完整 `owner-poc` D1/config，保留旧 fixture Worker/D1 作为只读回退，不在原地迁移。
- 规范目录使用 `atlas_items`；个人事实使用 `place_assessments`、`visits`、`visit_media`，不再以 `agent_catalog_items` 或 fixture rows 形成第二套事实。
- 增加简单 Owner Login；匿名只读仅返回闭合版本 DTO，包括 Catalog、个人总体状态/评论、Visit 展示与照片；严禁 storage key/原文件名/hash/内部 ID/审计字段，未知读取默认私有；业务 `POST/PUT/PATCH/DELETE` 仅 Owner 可调用。
- 修复网页收藏、去过、总体评分、总体评语与既有 Visit/媒体写入。
- 将真实 Nearby 收敛为渠道无关的结构化 operation，由 Web 和微信分别呈现。
- 通过独立只读 Route Sidecar 启用 Google Geocoding/walking Route Matrix；Sidecar 无 owner secrets/storage，应用 hard caps 为每月 8,000 geocoding requests 与 8,000 walking matrix elements；Transit/Foursquare 保持未配置、未调用。
- 为 Agent operation manifest、幂等回执与后续写 gate 建立可扩展接口，但不提前绕过微信稳定事件 ID、Add confirm 或 Record 语义门。

## 非目标

- 多用户、朋友账号、细粒度角色和 OAuth。
- 隐藏或重排现有编辑控件；PoC 只阻止未登录写请求。
- 让 DeepSeek 决定身份、项目、操作权限、坐标、路线或最终写入。
- 本特性第一发布门内自动抓取 Tabelog、启用 Foursquare、开放 `/jpmap add` 最终写入或多图 Record。
- 修改或删除旧 fixture 数据与部署，以其承载真实私人数据。

## 成功定义

- Owner 在网页登录后可保存收藏、去过、评分和评论，刷新后状态不丢失；未登录的同一写请求被拒绝且数据库零变化。
- Web 与微信的 Nearby 从同一 `atlas_items` 和个人事实读取，同一输入得到同一结构化候选，仅呈现不同。
- Google 任一 SKU 超过应用硬额度时失败关闭且不产生计划外费用；Transit/Foursquare 调用次数为零。
- 新环境通过冒烟后再切换，旧 fixture 可独立回退；任何源码、Git 历史、客户端 bundle、日志和文档均不含密码或 API key 明文。
