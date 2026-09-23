# T-16 演示验收

- 日期: 2026-09-23
- 模式: interactive
- 结论: 接受
- 用户确认: `continue`

## 已验收范围

- Owner confirm 以服务端 `add-confirm:v1` mutation key 和权威 preview/digest 执行原子发布，并返回 `committed_verified | committed_needs_review | reused_existing | conflict | failed_no_write`。
- Verified Item 可进入公开 Catalog、地图与 Nearby；Review Candidate 只在 Owner Inbox／详情可见，可维护 Visit，但匿名评价、Visit、笔记与媒体读取均失败关闭。
- confirm-time provider refresh 在一成一败时可稳定终止，失败不伪造 observation time；intake evidence 保留 provenance、time、license 与 unknown 语义。
- Owner 会话失效时回到登录状态，不把 401 误报为“没有待审核项”。

## 证据

- 第 7 轮独立 code/UI review PASS：严重 0、一般 0、建议 1。
- production architecture／Visit／ViewModel boundary 64/64，changed/new focused 144/144，完整测试 564/564。
- TypeScript、lint、format、migration、diff 与 owner-poc production build 全部通过。

## 保留边界

- 评审环境没有可复用 Chrome／Chromium，且未为截图下载大型浏览器；因此 Owner Inbox 的 desktop/mobile 真实截图仍是明确的非阻断 UI evidence gap，不宣称已完成视觉截图验证。
- 本次接受不表示线上 Add 已可用。T-15 仍需接入受控 Research Relay；T-17 才开放 Web confirm 与确定性 `/jpmap add` 双入口；migration、production composition、deploy 与线上 smoke 属 T-18。
- 当前不修改 OpenClaw endpoint，不部署 Cloudflare，也不开放 Agent intake manifest。
