# T-18 production code/security review（第 1 轮）

- 日期: 2026-09-24
- 评审方式: subagent
- 固定点: `b1662ff2402106c607556596bf9e8f51048e7bbb`
- 被评快照: 固定点到当前未提交工作区；包含全部 tracked 变更与新增实现／helper／tests，明确排除三个用户 `.orig` 文件
- 结论: 需修改

## Standards

- [一般] `features/004-openclaw-atlas-poc/deployment/openclaw-poc/scripts/agent-target-switch.mjs:320-342`、`features/004-openclaw-atlas-poc/deployment/openclaw-poc/README.md:153-157`、`features/004-openclaw-atlas-poc/deployment/openclaw-poc/test/agent-target-switch.contract.test.mjs:23-139`: `replaceProtectedFile` 在 `rename` 已经成功后继续执行目录 `fsync`，但目录同步失败会落入同一个 catch 并向 operator 报告失败；此时 live environment 实际已经切换，与 README 的“failure ... leaves the live environment unchanged”相反。当前 tests 只覆盖校验失败、普通切换和回退，没有 post-rename failure injection，operator 可能把“已经切换但未确认持久化”误当成“完全未切换”，随后重启或重试时得到不可预测的入口状态。→ 明确区分 commit 前失败与 rename 后 durability-uncertain 状态：后者不得报告普通 `failed/unchanged`，应返回不含 secret 的闭合状态并强制 operator 核验／回退；补 rename、directory-fsync 和 rollback 同类 fault-injection contracts，保证每种结果都能唯一判定 live file 的真实状态。

除上述发现外，本轮 Standards 冷读未发现新的凭证明文、动态 provider endpoint、redirect 跟随、无界响应、并行 Catalog 写路径或 Web／Agent 业务分叉。Google Places 与 Nominatim transport 固定 HTTPS endpoint、`redirect: manual`、8 秒／64 KiB 上限；Places Secret 只从 Worker Secret 进入服务端 header，D1 ledger 在 egress 前按两个 SKU 原子预留；Nominatim 使用共享 D1 1 req/s gate、30 日 cache TTL/cleanup 和闭合 OSM provenance。生产 composition 的 Browser 与 Agent 都读取同一 runtime projection，Relay 强制保持 `relay_disabled_manual_unknown`。OpenClaw package/manifest 同步为 `0.3.0`，helper 通过 protected file、同目录 temporary file、`0600`、uid/gid 保持和不可覆盖 snapshot 收窄了正常切换路径。

## Spec

- [一般] `apps/web/app/terms/page.tsx:43-74`、`apps/web/features/atlas/catalog-intake-panel.tsx:240-247`、`apps/web/app/globals.css:573-591`、`apps/web/features/atlas/catalog-intake-panel.contract.test.mjs:11-19`: T-18 要求 Google Places policy/attribution regression 在生产启用前闭合。当前 Privacy 已链接 Google Privacy Policy，Terms 只提到 Google Maps Platform，却没有把 [Google Maps Platform Terms](https://cloud.google.com/maps-platform/terms) 纳入或链接公开条款；这未满足 Google Places 官方政策关于公开 Terms／Privacy 的要求。候选 attribution 已正确使用不翻译的 `Google Maps` 文本并与候选同容器，但仍继承站点字体、缩到 `0.66rem` 且没有 `white-space: nowrap`，无法保证官方 text attribution 的字体／可读性／禁止换行要求；contract 只做源码 regex，不能证明移动端实际不换行。→ 在公开 Terms 加入明确的 Google Maps Platform Terms 链接／纳入说明；为 attribution 使用官方 logo，或建立专用 text-attribution 样式（至少不翻译、不换行、官方字体/字重/间距和可读尺寸），增加 computed-style／窄屏真实渲染证据。依据：[Places API policies and attribution](https://developers.google.com/maps/documentation/places/web-service/policies)。

其余本轮 Spec 冷读通过：Places 长期状态只保留 Place ID，瞬时名称／地址没有进入 composition test 的 terminal state；Search Text 最多请求 4 项并由既有 adapter 稳定截取 Top 3，无 pagination；details identity mismatch、缺 Secret、quota、redirect、oversize、malformed 均失败关闭。owner-poc migration contract 从空库顺序执行 `0001`–`0009`，Nominatim known evidence 固定 `sourceUrl/license/checkedAt`，scheduled cleanup 同时覆盖 intake 与 cache。公开／Owner／Agent 的实际生产 migration、provider enablement、smoke、canary 与回退尚未执行，因此不计为本轮代码缺陷，也不能据此勾选 T-18。

## UI / 视觉

- 本轮唯一可见交互增量是候选 attribution 的 `translate="no"` 以及 Terms/Privacy 文案。它们沿用既有 warm editorial atlas，没有引入新颜色、间距、圆角、动效或模板化组件。
- 因上述 attribution 样式发现尚未关闭，本轮 UI 门不通过。修复后须至少保存窄屏候选卡、Terms 与 Privacy 的真实渲染截图，并核对 attribution 不换行、清晰可见、与 Google content 同容器且没有与 OSM/Owner content 混合归因。

## 独立验证证据

- `git diff --check HEAD`: 通过；secret-pattern／private-key 扫描（排除三个 `.orig` 与 build/node_modules）未发现真实凭证明文。
- 新增／受影响 provider、composition、preflight、policy、migration、maintenance 与 route focused suite: 13/13 test files 通过。
- D1 usage、Catalog intake state/publisher 与 T-17 dual-adapter E2E: 已完成的 6/6 test files 通过；Catalog intake operations contract 1/1 通过。
- OpenClaw package suite: 在允许 child-process 的环境独立复跑 17/17 通过；lint 与 build 通过，`src/index.mjs`／`src/jpmap-client.mjs` 和对应 dist 无差异。
- Web `typecheck`、`lint`、`format:check`、`migration:check`、owner-poc production build 均通过。
- Wrangler `versions upload --dry-run --strict` 通过；bundle 只显示预期 D1、R2、Route Sidecar、Assets 与三项 intake mode vars，没有把 Google Places Secret 值编入 artifact。
- Architecture-fitness runner 在当前评审环境只打印 TAP header 后不退出；已终止，未把该次运行记为绿色证据。它不豁免上方可复现 findings。

## 现场发布／演示证据缺口（不与代码发现合并）

- 尚未对远端 green D1 应用 `0006`–`0009`、核对 migration journal／fresh seed evidence，或上传不可变 Worker version 后执行 0% canary／version override／promote／rollback。
- 尚未证明 production Places API/SKU enabled、key restriction 或补偿控制、provider quota/billing guard、Secret name-only inventory与 live sanitized probe；也未保存 transient-content/log/D1/R2 零泄漏证据。
- 尚未执行公开／Owner Web、匿名/direct-POST negative、Agent owner/第二账号/群聊/wrong-scope/nonce replay 的 production smoke；没有 Web-only 与 Agent-only rollback rehearsal。
- 尚未在 Lightsail 安装 `0.3.0` archive、执行 endpoint/key atomic switch、Gateway restart/status、real WeChat zero-model Add/Nearby probes 或恢复旧 endpoint。T-08、T-11、T-18 均应保持未完成。
- D-P06 仍为 Proposed；当前 reviewed configuration 必须继续 `relay_disabled_manual_unknown`，不得因为基础 Add provider wiring 完成而启用 Research Relay。

## Gate

T-18 第 1 轮独立 Standards + Spec + UI 代码门为 **FAIL／需修改**：严重 0、一般 2、建议 0。关闭两项一般发现并补齐对应 tests／真实渲染后需重新独立复审；当前结论不授权生产迁移、Worker promotion、OpenClaw 切换或勾选 T-18。

---

# T-18 production code/security review（第 2 轮）

- 日期: 2026-09-24
- 评审方式: subagent
- 固定点: `b1662ff2402106c607556596bf9e8f51048e7bbb`
- 被评快照: 固定点到第 1 轮两项发现修复后的当前未提交工作区；包含全部 tracked 变更与新增实现／helper／tests／视觉证据，明确排除三个用户 `.orig` 文件
- 结论: 通过
- auto-approved 2026-09-24

## Standards

无发现项。

第 1 轮原子切换发现已关闭。`replaceProtectedFile` 现在区分 rename 前失败与 rename 已提交但目录 durability 尚未确认：前者仍失败关闭且 live file 不变，后者分别返回 `switched_durability_unconfirmed` 或 `rolled_back_durability_unconfirmed`，不再向 operator 谎报“未切换”。switch 与 rollback 两条 post-rename directory-fsync 故障路径均有 fault-injection contract；测试同时核对 live/backup 的真实内容与报告零 secret 泄漏。README 对这两个闭合状态给出核验及“不要盲目重试”的处理方式；service identity 的所有权说明也已对齐当前 user-level systemd 部署和 system-level 可选形态。

其余 Standards 结论维持第 1 轮：provider secret 只在服务端 header 使用；endpoint、redirect、timeout、响应大小和字段掩码固定；D1 provider reservation 在 egress 前执行并受独立 SKU cap 约束；Nominatim 使用共享 D1 1 req/s gate、30 日 cache/cleanup 与固定 OSM provenance；Web 与 Agent 共用同一 production composition；OpenClaw package/manifest 版本与 src/dist 一致，切换 helper 的路径、权限、所有权、备份和输出边界闭合。

## Spec

无发现项。

第 1 轮 Google policy/attribution 发现已关闭。公开 Terms 明确链接并纳入 Google Maps Platform Terms；Privacy 准确区分“确认前最多缓存 30 日的 Nominatim proposal”与“只有 Owner 确认后才进入 Atlas catalog”。候选 attribution 使用精确、不翻译的 `Google Maps` 文本，专用样式保证不换行、正常字重与可读尺寸，并与 provider candidate 保持同一容器。`Roboto` 和 Google 灰色是外部品牌归因要求的局部例外，没有扩散为站点设计系统。

迁移链、provider mode、preflight fail-closed、Google 只长期保留 Place ID、Nominatim durable evidence、Web/Agent 等价路径、Relay 保持 `relay_disabled_manual_unknown` 的 Spec 结论维持通过。

## UI / 视觉

真实 Chromium 窄屏渲染复验通过：

- `evidence/t18-google-attribution-mobile-2026-09-24.png`: 324 px 截图中的候选名称、地址、选择控件与 `Google Maps` attribution 均清晰可见，没有换行、溢出、重叠或遮挡；归因和 Google candidate 在同一候选容器。
- `evidence/t18-google-terms-mobile-2026-09-24.png`: 390 px Terms 页面层级、正文节奏、链接与导航完整，无横向溢出或遮挡；Google Maps Platform Terms 链接在 Adding a place 语境内可见。
- `evidence/t18-google-privacy-mobile-2026-09-24.png`: 390 px Privacy 页面层级与链接完整，无横向溢出或遮挡；Google Privacy、transient candidate 与 Nominatim cache/catalog 边界可读。
- 浏览器 computed-style 记录为 `Google Maps`、`translate=no`、`white-space: nowrap`、16 px、weight 400、Roboto；归因左右边界均在 390 px viewport 内。

本轮 UI 增量延续既有 warm editorial atlas，没有方向漂移、模板脸、无理由装饰或新的交互障碍；真实渲染未见视觉硬伤。

## 独立验证证据

- OpenClaw 整包测试独立复跑 19/19 通过，包含 switch 与 rollback 的两条 post-rename durability fault injection；第 1 轮 lint/build/src-dist 等价证据继续有效。
- policy page 与 catalog intake panel focused contracts 独立复跑 2/2 test files 通过。
- Web `typecheck`、`lint`、`format:check` 与 `git diff --check HEAD` 在修复后独立复跑通过。
- owner-poc production build 在最终 UI／policy 文案修复后独立复跑通过。
- 第 1 轮已独立通过的 provider、composition、preflight、D1 policy/migration、maintenance、Agent route、Wrangler dry-run 与 secret scan 覆盖未被本轮修复削弱。
- Architecture-fitness runner 在本评审环境的 PTY 仍没有正常返回汇总，未计为绿色证据；focused contracts、类型/静态门和 production build 已覆盖本轮实际变更。该 runner/harness 现象不构成本轮可复现的代码缺陷。

## 现场发布／演示证据缺口（不与代码发现合并）

- 仍需在远端 green D1 应用并核对 `0006`–`0009`、migration journal 与 fresh seed evidence。
- 仍需证明 production Google Places API/SKU enabled、key restriction 或补偿控制、quota/billing guard、Secret name-only inventory 与 live sanitized probe，并保存 transient content/log/D1/R2 零泄漏证据。
- 仍需上传不可变 Worker version，执行 0% canary／version override／promote／rollback，并完成公开、Owner Web、匿名/direct-POST negative 与 Agent 多身份/群聊/wrong-scope/nonce-replay production smoke。
- 仍需在 Lightsail 安装 `0.3.0` archive，执行受保护的 endpoint/key switch、Gateway restart/status、真实微信 zero-model Add/Nearby probes 及恢复旧 endpoint 的 rollback rehearsal。
- T-08、T-11、T-18 在上述现场证据闭合前应保持未完成；D-P06 仍为 Proposed，Research Relay 继续禁用。

## Gate

T-18 第 2 轮独立 Standards + Spec + UI **代码门 PASS／通过**：严重 0、一般 0、建议 0。该结论允许进入受控部署与现场演示取证，但不等于远端生产部署已经完成，也不授权在现场证据缺失时提前勾选 T-08、T-11 或 T-18。

---

# 第 3 轮部署手册与 CI 增量复核

- 日期: 2026-09-24
- 评审方式: subagent
- 范围: Cloudflare owner-poc 部署手册，以及 architecture-fitness 触发后的 provider runtime projection 增量
- 结论: 通过
- auto-approved 2026-09-24

## Standards

无剩余发现项。

部署手册首轮发现两处边界不一致：preflight 文案错误地声称拒绝任何 direct Google secret，与必需的第七个 `GOOGLE_PLACES_API_KEY` 冲突；cutover 只验证 Nearby／Route Sidecar，没有独立的 Places Add live probe、provider 前置门与零留存验收。修订后手册明确 exact seven-name allowlist、Owner Worker 唯一允许的 Google Places credential、Route Sidecar 专属 `GOOGLE_MAPS_API_KEY`，并分别列出 Routes 与 Places 的 review／restriction／quota 前置门、discover-select-cancel／授权 confirm、SKU reservation、attribution 和 D1/R2/log/DTO 零 raw/transient 留存检查。

第二轮发现 smoke 文案把 active session 收窄成单个 selected Place ID，与合法 Top-3 candidate tuples 不符。最终已改为规格允许的 `{providerNamespace, placeId, ordinal, createdAt}` tuples，加上闭合 Owner input/application fields，并继续明确禁止 Google candidate name/address、raw response 与 derived hash。

## Spec / CI architecture

CI 首次运行发现 Agent route 直接 import `@/db`，触发 `route_storage_bypass`。最终修复没有添加白名单：新增无 I/O 的纯函数 `projectOwnerPocCatalogIntakeRuntime(bindings)`，只投影 `GOOGLE_PLACES_API_KEY` 与三项 reviewed provider mode；Web 由 `db/index` 调用该函数，Agent route 直接以其 bindings 调用同一函数，因此两端保持同一 runtime mapping，同时 route 不再依赖 storage module，Nearby 的 `GOOGLE_MAPS_API_KEY` 仍只存在于隔离 Route Sidecar／旧只读分支。

共享 projection contract、Agent route contract、Web `typecheck`、`lint`、`format:check` 与 `git diff --check` 通过；主任务本地 architecture-fitness 已 **PASS**。远端 CI 必须等待该修复形成新提交后重新运行，当前不得写成 remote CI green。

## Gate

第 3 轮部署手册与 CI 增量复核 **PASS／通过**：严重 0、一般 0、建议 0。该结论关闭上述 runbook 与 architecture-fitness 代码发现；远端 CI 重跑和第 2 轮列出的现场发布／演示证据仍是后续独立门槛。
