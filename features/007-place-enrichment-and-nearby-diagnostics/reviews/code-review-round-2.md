# 地点自动补全与 Nearby 诊断代码评审（第 2 轮）

- 日期: 2026-09-25
- 评审方式: subagent
- 固定点: `749be52f00938e2ef4090afa7244cce14a566cfe`
- 评审范围: 固定点至当前未提交 worktree（排除三个用户 `.orig` 文件）
- 结论: 需修改

## Standards

- [建议] `features/007-place-enrichment-and-nearby-diagnostics/evidence/t04-local-integration-2026-09-24.md:53-76`：该较早的本地集成记录仍称浏览器不可用、截图／自动可访问性证据不存在，并引用当前目录中不存在的 `feature-007-t02-browser-blocker.json`；同目录后续已经加入 11 张真实渲染 PNG、浏览器 JSON 与视觉评审。实现与后续证据本身可以核验，但两份证据相互矛盾会让发布审计误判当前门状态。→ 在 ship 前把旧段落明确标为已被后续 browser evidence 取代，或更新其事实状态；不要删除真实限制发生过的历史。

## Spec

- [一般] `apps/web/product/application/conversation/feature-007-wechat-no-match.contract.test.mjs:554-642`：Browser／signed Agent 的 confirm outcome matrix 只用一个 `dependency_failure` fixture 代表规格表中“provider unavailable、rate limited、malformed response、obsolete/not-found identity”整行。`malformed` 会走 `validateDiscoveryCandidate` 的另一分支，`not_found`／rate-limit 又携带不同 provider error kind；当前测试没有从两个真实外部入口逐个证明这些子变体都保持相同 `failed_no_write` result class、HTTP/重试语义和 session/Catalog no-write，也不能以 Product Core 单入口覆盖替代规格明确要求的外部双入口合同。→ 把 confirm identity-refresh failure 扩成数据驱动子矩阵，至少分别覆盖 unavailable、rate-limited、malformed、not-found/obsolete；逐例断言 Browser 与 signed Agent 等价、Agent HTTP 结果、retryability、publish 次数为零且 session/Catalog 快照未改变。若 obsolete 与 not-found 在 port 上是同一闭合 outcome，可共享一个明确命名的 fixture，但不能只保留泛化的 dependency fixture。

## Round-1 闭合复核

- ambiguous durable-location select 已把实际 clarification 持久化到 transition；Browser 的 session replay 与 signed Agent response-loss replay 均返回与首次相同的 `ambiguous_location` code、prompt、fields，生产代码不再包含旧的 `Add a restaurant name, area, or address to continue.` prompt。
- stable `no_match` 保持 unknown evidence 与 digest，一次 confirm 产生一个 `committed_needs_review` receipt；confirm replay 不重复 publish，resolved↔no-match 变化仍 conflict/no-write。
- Sidecar transport 已记录 geocoding／walking-matrix 的 reserved/success、普通 4xx、redirect/transport、malformed 与 zero-result 闭合类别；Owner production composition 注入 allowlisted operational recorder。负测证明 key、query、coordinates、provider body、Owner/Catalog facts 不进入诊断事件、产品 operation 或 presenter。
- `expired` 已贯通 ProjectCommandRouter 与 Agent gateway 为 HTTP 410；新增 error union 可通过现有 gateway/API contracts、typecheck 与 D1 audit 文本列，不破坏既有错误类别。
- Google transient presentation 未进入 persisted session/preview/receipt/Leaflet；Owner Worker 与 Route Sidecar 仍保持两个 secret 接缝、固定 endpoint、manual redirect、显式 quota reservation 与无自动 provider retry。

## UI 与视觉复核

- 已逐张以原始分辨率检查 11 张 production React/CSS 截图：loading、empty/refine、clarification、candidate、preview、conflict、success、dependency error，以及 390px candidate、preview、滚动后的 confirm action。
- 暖色编辑式 Japan Atlas 方向、serif/sans 层级、现有颜色／圆角／focus token 保持一致；未出现渐变、发光、emoji 图标、玻璃拟态或通用 SaaS 卡片漂移。
- 浏览器 JSON 与截图共同证明：390px 无横向溢出，移动端可滚动至 44px 高的 confirm action；候选 Google Maps attribution 与 radio 保持同容器；disclosure 的 `aria-expanded/aria-controls`、label／`aria-describedby`、live region、响应后焦点与最小 44px target 均通过。未发现视觉硬伤或严重级无障碍问题。

## 评审者运行证据

- Feature 007 focused + 更新过的 Catalog/router/D1 dual-adapter/Owner composition contracts：16/16 suites PASS。
- Provider-policy、Agent gateway/API client、Route Sidecar service/metering/D1/adapter/worker 回归：10/10 suites PASS。
- `npm run typecheck`：PASS。
- `npm run lint`：PASS。
- `npm run format:check`：PASS。
- `git diff --check`：PASS。
- 未长跑全量 suite；本轮不把作者记录的全量结果替代为评审者自跑结果，也不据此新增失败项。
