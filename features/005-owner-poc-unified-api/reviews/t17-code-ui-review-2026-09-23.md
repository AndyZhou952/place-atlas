# T-17 code/UI 评审（第 1 轮）

- 日期: 2026-09-23
- 评审方式: subagent
- 固定点: `d9d4886cb99b06ee7dcf23a16e98af61b7de6731`
- 范围: 当前工作树相对固定点的全部 T-17 tracked/new diff；三个既有未跟踪 `.orig` 文件排除且未触碰
- 结论: 需修改

## 发现项总览

- 严重: 1
- 一般: 3
- 建议: 1

## Standards

- [严重] `apps/web/product/application/conversation/project-command-router.ts:432-452`、`apps/web/features/atlas/catalog-intake-panel.tsx:289-350`、`apps/web/features/atlas/catalog-intake-ui-state.ts:167-173`：T-17 激活 Confirm 后，Web 与 Agent 的可见 preview 仍只呈现名称、地址、坐标、unknown/warning 的子集；已知 Tabelog score/reviewCount/source/time、预约规则/source/time、suspected duplicates 及逐字段 provenance 没有进入 Owner 可见确认面。confirm refresh 返回 `conflict.newPreview` 时，Web 只显示通用 conflict 卡片，Agent 只回复“请检查新预览”，但都没有把该新 preview 的事实呈现出来；下一条 Agent `confirm` 会直接按 resolver 中的新 previewVersion 再提交。由此 Owner 可以在未看到新证据的情况下确认持久化事实，破坏“preview first”的深模块边界。→ 建立 Web/Agent 共用的闭合 preview presenter，完整呈现所有可持久化字段、provenance/freshness/source/time、duplicates/warnings；conflict 必须先实际显示 `newPreview`，再允许对该版本 confirm，并以 known Tabelog/reservation 与 confirm-refresh change 的交互测试锁定。
- [一般] `features/005-owner-poc-unified-api` 的 T-17 变更缺少真实渲染截图证据。当前评审环境没有 Chrome/Chromium/Chrome Headless Shell，也没有 Playwright/Puppeteer 浏览器缓存；本轮没有下载大型浏览器，也没有用源码或旧 T-14 截图冒充 T-17 的 Confirm loading/error/success。→ 修复后在可用浏览器中真实渲染 desktop/mobile preview、confirm loading、可重试 error、verified success、needs-review success 和 confirm-refresh conflict，至少保存关键状态截图并检查 warm editorial tokens、焦点、44px 触控、响应式和辅助技术状态。

其余 Standards 冷读未发现新的依赖倒置、平行 Catalog coordinator、底层 Catalog write 旁路或视觉系统漂移。四个 intake operations 仍经同一 `AtlasApplication`；遗留 `POST /api/items` 保持 Owner auth 后 503；Agent manifest 没有 Record/destructive/bottom-level save/update/delete。D-P06 仍为 Proposed，production `CatalogIntakeModule`/Relay 仍默认 unavailable/manual-unknown，未发现 T-18 Secret、Tunnel、provider 或部署越界。

## Spec

- [一般] `apps/web/lib/server/application/d1-catalog-intake-state.ts:118-137,409-413`、`apps/web/lib/server/application/d1-catalog-intake-state.sqlite.contract.test.mjs:126-231`：conversation 没有 active session 时，resolver 查询“最近任意 terminal”，而不是规格要求的最近 committed confirm receipt。只要一次成功建档之后又产生较新的 cancelled 或 expired session，裸 `/jpmap add confirm` 就解析到 cancelled/expired 并返回阶段冲突，无法恢复之前 response-lost 的 committed receipt；新增测试还把“cancelled 覆盖 committed”固化为期望。→ active session 仍优先；没有 active 时只查询保留期内最近 `state='committed'` 的 terminal/receipt，补 `committed -> later cancelled/expired -> bare confirm` 仍恢复 committed、以及新 active session 必须遮蔽旧 receipt 的正反向测试。
- [一般] `apps/web/lib/server/application/d1-atlas-catalog-intake.sqlite.contract.test.mjs:1049-1225`、`apps/web/product/application/conversation/agent-service-gateway.contract.test.mjs:172-438`、`apps/web/features/atlas/catalog-intake-panel.contract.test.mjs:67-90`：任务票与 Testing Decision 要求 Web Cookie adapter 和 Agent HMAC adapter 在同一 D1 fixture 上完成 discover/select/confirm/cancel、negative identity/scope/nonce、receipt recovery 和 read-after-write 等价 E2E。当前 D1 publish 测试直接调用 `ProjectCommandRouter`，绕过 HMAC gateway；HMAC 测试用 mock router 且只证明 discover；Web confirm 测试只是读取源码正则。没有测试把两个真实 adapter 都送入同一 application/D1 并比较最终 item/receipt，也没有真实 Web confirm route 的 committed read-after-write。→ 增加共享 fixture E2E：Owner-cookie Web 与 signed Agent 分别跑四操作，覆盖 response-loss/replay、第二账号/群聊/wrong scope/nonce、verified map/Nearby 可见、needs_review Owner-only，并从真实读 API验证写后读取。

其余 Spec 冷读确认：精确 `/jpmap add <query> | select <1-3> | confirm | cancel` 在 native OpenClaw command 中确定性解析，不进入模型 tool catalog；Owner/第二账号/群聊/wrong scope/transport nonce 的现有负测在 mutation claim 前失败；manifest 只增加四个 reviewed intake operations；verified D1 fixture 可被 Catalog/Nearby 读取；needs_review 的既有 T-16 verified-only/Owner-only 边界未被本 diff 放宽。

## 建议

- [建议] `apps/web/product/application/conversation/project-command-router.ts:236-242`、`features/004-openclaw-atlas-poc/deployment/openclaw-poc/src/jpmap-client.mjs:3,181`：所有无效 Add 命令仍返回只有 Nearby 的 usage 文案，`add select 4`、缺参数或多余参数会误导用户。→ 将闭合 Nearby/Add 语法一起列入稳定 help reply，并保持 src/dist 同步。

## 独立验证

- 固定点可解析，`git diff --check d9d4886 --` 通过；三个 `.orig` 始终保持未跟踪且未触碰。
- T-17 focused Web test files 8/8 通过：router、Agent gateway、D1 intake state/publisher、Nearby equivalence、owner route surface、intake UI state/panel。
- `npm run typecheck`、`npm run lint`、`npm run format:check`、`npm run migration:check` 全部通过。
- OpenClaw `jpmap-plugin.contract.test.mjs`（含四条 Add 命令零模型映射）通过；`src/jpmap-client.mjs` 与 `dist/jpmap-client.mjs` 字节一致。
- OpenClaw 完整 package test 中，未改动的 `jpmap-hardening.contract.test.mjs` 有 1 个环境失败：沙箱内 nested host-preflight process 没有 stdout，测试在 `JSON.parse` 报 `Unexpected end of JSON input`。其余 4/5 hardening subtests 通过。该测试及 host-preflight 实现相对固定点未变，且已知本机 Node 22.13 低于真实 host 要求 22.22.3；本轮没有用这个既有 T-08/环境缺口掩盖上述 T-17 实现问题。
- production architecture focused run在发现阻断后停止，未以不完整结果作为通过证据；完整 suite/build 不在本轮已有阻断下重复消耗资源。

## UI 截图评审

- 本轮无法完成真实截图：标准系统路径、`/home/ubuntu/.cache` 及 workspace 均未发现可复用 Chrome/Chromium/Headless Shell 或 Playwright/Puppeteer 浏览器。
- 源码辅助检查显示新增 Confirm 按钮复用既有 Button 与 `.catalog-intake` token，44px 最小高度、可见焦点和 `aria-busy` 仍存在；没有新增硬编码颜色/间距、渐变、emoji、玻璃拟态或动效。
- 上述仅是源码证据，不构成 `hf-ui-design` 的真实渲染通过；同时已实际识别出“可确认但证据不可见”的 UI/交互硬伤，所以本轮视觉门不能通过。

## 结论

T-17 第 1 轮为 **需修改**：1 项严重、3 项一般、1 项建议。先关闭完整 preview/conflict review、最近 committed receipt recovery 与真实双 adapter E2E；随后重新执行独立 Standards + Spec + UI 评审和真实渲染截图。当前结论不允许勾选 T-17，也不授权进入 T-18 deploy。

---

# T-17 code/UI 评审（第 2 轮）

- 日期: 2026-09-23
- 评审方式: subagent 冷读与独立复跑
- 基线固定点: `d9d4886cb99b06ee7dcf23a16e98af61b7de6731`
- 复审点: 作者补齐 conflict CSS/contract 后冻结的当前工作树；三个既有未跟踪 `.orig` 文件继续排除且未触碰
- 结论: 需修改

## 发现项总览

- 严重: 0
- 一般: 3
- 建议: 0

## 已关闭的首轮发现项

- `catalog-intake-preview-presenter.ts:32-191` 现在是 Web 与 Agent 共用的闭合 presenter，呈现 identity、title、area、address、coordinates、Tabelog、reservation、逐字段 evidence/source/time/license、duplicates、unknowns 与 warnings；Web `PreviewStep` 和 Agent preview/conflict reply 都复用它。
- `catalog-intake-panel.tsx:147-174,321-399` 与 `project-command-router.ts:429-449` 均实际回显 confirm refresh 的 `newPreview`，并要求 Owner 明确检查后再次 confirm；Web 二次确认按钮和 conflict 专用样式已经存在。
- `d1-catalog-intake-state.ts:118-137,409-413` 先解析 active session；没有 active 时只解析保留期内最新 committed terminal。新增 contract 证明较新的 cancelled/expired 不会遮蔽 committed receipt，且新 active 会遮蔽旧 receipt。
- 新的共享 SQLite/D1 E2E 确实穿过 Owner Cookie guard/Web response adapter 与 signed HMAC Agent gateway；两端均执行 discover/select/confirm/cancel，覆盖匿名、第二账号、群聊、wrong scope、nonce replay、confirm receipt recovery、verified Catalog/Nearby read-after-write。遗留 `POST /api/items` 继续在 Owner auth 后 503。
- Web 与 OpenClaw 的无效命令 help 现在同时列出 Nearby 和四条 Add 语法；OpenClaw `src`/`dist` 仍字节一致。

## Standards

- [一般] `apps/web/product/application/conversation/agent-service-gateway.ts:855-885` 新增了第二份 tool→application-operation 映射 `agentOperationName`，而同一权威映射已经存在于刚刚查出的 manifest `tool.operation`（`240-245`）。这不仅制造漂移接缝，生产架构 fitness 也实际返回 `mapping_declaration_outside_owner`，使完整 Web suite 的 `architecture-fitness.test.mjs` 失败。→ 删除 adapter-local operation map；在 manifest 查到 tool 后，把它的权威 `operation` 传给 audit/写命令路径。认证前未知请求仍可记固定 `unknown`，不能再从 body.tool 重建业务 operation。
- [一般] `features/005-owner-poc-unified-api/evidence/ui/t17-catalog-intake-render-2026-09-23.md:46-56` 明确说明七张 PNG 不是浏览器截图；`apps/web/scripts/render-t17-catalog-intake-evidence.mjs:4-19,35-58,126-260` 只导入生产 presenter，页面、状态和 palette 是另写的 Satori 树，并没有渲染生产 `CatalogIntakePanel`、生产 CSS 或浏览器 DOM。七图目视上层次清楚、移动版无明显横向溢出、warm editorial 方向一致，也足以辅助检查文案闭合，但不能证明真实 React 布局、实际 conflict CSS、按钮可用、focus ring/阶段焦点、ARIA/live region 或键盘路径，因此不满足 `hf-ui-design` 与本特性 Testing Decision 的真实浏览器门。→ 最小关闭证据是在真实浏览器加载生产页面/组件，以可控 fixture 或 request interception 实际构造 desktop/mobile complete preview、confirm loading、retryable error、verified success、needs-review success 与 confirm-refresh conflict；至少实际点击一次初次 confirm 和 conflict 后二次 confirm，并保存截图、键盘焦点/accessible snapshot（或等价浏览器证据），确认 44px、无 overflow 和 live/alert 语义。

其余 Standards 冷读未发现新的底层 Catalog 写旁路、Record/T-19/T-20 越界或部署修改。共享 presenter 与新 conflict 样式沿用现有 Button/token；没有新增渐变、玻璃拟态、装饰动效或平行 Catalog coordinator。

## Spec

- [一般] `apps/web/lib/server/application/t17-dual-adapter-e2e.sqlite.contract.test.mjs:197-233,235-267,345-364` 的同库 E2E 只让 Web Cookie 入口产生并验证 `committed_needs_review`；signed Agent 入口只走 `committed_verified`。最终 Owner merged Catalog 也只有 `Web Needs Review`，所以“needs_review Owner-only/verified-map-Nearby 排除”已证明，但该结果的 **Web/Agent 等价性** 尚未端到端证明。→ 在同一真实 D1 fixture 中增加 `Agent Needs Review` 的 signed discover/select/confirm-conflict/explicit-reconfirm 流，断言 Agent reply/闭合 outcome 为 `committed_needs_review`、只进入 Owner merged Catalog，并同时缺席 verified Catalog、地图/Nearby；保留 recovery 与负向计数断言。

其余 Spec 复审通过：四条精确 `/jpmap add` 命令仍在 OpenClaw native command 中零模型解析；scope/actor/direct-conversation/nonce 在 mutation dispatch 前失败关闭；confirm response-loss 可从最新 retained committed receipt 恢复；verified 写入可被相同 Catalog/Nearby 读取；manifest 只在 owner phase 增加四个 reviewed intake operations，没有暴露 save/update/delete/Record。D-P06 仍为 Proposed，production composition 仍使用 unavailable intake/manual-unknown，Relay、Tunnel、Secret、provider 与 deploy 均未提前进入 T-18。

## 独立验证

- `git diff --check d9d4886 --` 通过；三个 `.orig` 始终未跟踪且未触碰。
- T-17 focused Web test files 10/10 通过：共享 preview presenter、panel/UI state、router、Agent gateway、D1 resolver/publisher、Nearby equivalence、Owner route surface、双 adapter E2E。
- `npm run typecheck`、`npm run lint`、`npm run format:check`、`npm run migration:check` 全部通过。
- OpenClaw focused plugin contract、语法检查及 `src`/`dist` 比对通过。完整 package test 仍被相对固定点未修改的 hardening host-preflight nested process 环境失败阻断；这与已知 Node 22.13 低于 host 要求 22.22.3/T-08 现场门一致，未用来掩盖 T-17 发现项。
- Web 完整 suite 为 154/156 test files 通过。`architecture-fitness.test.mjs` 是本轮 T-17 的真实失败：独立直接调用 production manifest audit 稳定返回 `mapping_declaration_outside_owner`，对应上面的 Standards finding。另一个 `assessment-reset-maintenance.test.mjs` 失败来自沙箱内 nested `spawnSync`；该测试与实现相对固定点均未修改，直接执行维护脚本仍按预期以状态 2 输出 no-change/usage，因此判为与 T-17 无关的环境缺口。
- 因已有明确阻断，本轮未用 production build 或 Satori 图片替代失败的架构门与浏览器门。

## UI 截图评审

- 已逐张目视七张 Satori+Sharp PNG：desktop/mobile preview、confirm loading、retryable error、verified success、needs-review success、confirm-refresh conflict。字段闭合、证据层次、冲突文案与二次确认 CTA 在这些合成图中清楚可读。
- 这些图片是有价值的视觉设计辅助物，但 renderer 自己复制 palette/layout/state，并不调用生产 React panel。根据证据文档自己的 trust-boundary 声明，它们不能关闭首轮“真实浏览器截图”一般项。

## 结论

T-17 第 2 轮仍为 **需修改**：0 项严重、3 项一般、0 项建议。首轮功能实现问题大部分已经正确关闭；剩余最小修复是去掉 gateway 的第二份 operation mapping、补 Agent `needs_review` 同库 E2E，以及提供生产组件的真实浏览器交互/截图证据。三项关闭并复跑 architecture/full gates 后，才能达到 0 serious/general 的 PASS；当前结论仍不允许勾选 T-17，也不授权进入 T-18 deploy。

---

# T-17 code/UI 评审（第 3 轮）

- 日期: 2026-09-23
- 评审方式: subagent 冷读、独立复跑与 Chromium 目视复验
- 基线固定点: `d9d4886cb99b06ee7dcf23a16e98af61b7de6731`
- 复审点: 第 2 轮三项一般发现修复后冻结的当前工作树；三个既有未跟踪 `.orig` 文件继续排除且未触碰
- 结论: **PASS**

## 发现项总览

- 严重: 0
- 一般: 0
- 建议: 0

## 第 2 轮发现项关闭情况

### Standards：manifest operation 权威与架构适应度

- `agent-service-gateway.ts` 不再维护 adapter-local tool→operation 映射。认证和请求解析完成、manifest 命中之前只使用固定 `unknown`；命中后 audit context、scope failure、输入失败、write dispatch、read success/failure 与 unexpected-failure audit 均直接携带 `tool.operation`。
- gateway contract 以替换 manifest 中 `jpmap_nearby.operation` 的方式证明 audit 读取 manifest 权威值，而不是从 `body.tool` 重建；未发现 `agentOperationName` 或等价第二份映射。
- production architecture fitness 独立完整执行 **62/62 通过**，第 2 轮的 `mapping_declaration_outside_owner` 已消失。

### Spec：同一 D1 的 Agent needs-review 等价链路

- `t17-dual-adapter-e2e.sqlite.contract.test.mjs` 在同一 SQLite/D1 fixture、同一真实 application 上同时穿过 Owner-cookie Web route adapter 与 signed HMAC Agent gateway。Web 与 Agent 各自完成 discover/select/confirm conflict/使用 `newPreview` 明确二次 confirm，最终均得到 `committed_needs_review`。
- Agent 首次 confirm 明确返回 `step='preview'`、`status='conflict'` 和“本次没有写入”的 closed presenter；随后第二条独立 signed confirm 才提交刷新后的 preview。这与 Web 使用 `newPreview.sessionId/previewVersion` 的显式二次确认语义一致。
- 最终 `verified_catalog` 精确只有 `Web Verified` 与 `Agent Verified`；Owner `full_merged_catalog` 另外包含 `Web Needs Review` 与 `Agent Needs Review`；Nearby 也精确只返回两个 verified 地点。因此 Agent needs-review 的 Owner-only、public/地图/Nearby 排除及 Web 等价已经端到端锁定。
- 同一 E2E 继续覆盖真实 Web confirm read-after-write、Agent committed receipt recovery、匿名、第二账号、群聊、wrong scope、transport nonce replay、cancel 与遗留 `POST /api/items` 503；首轮已关闭项未回归。

### UI：production React 的真实 Chromium 证据

- 已逐张目视 `evidence/ui/t17-browser/` 的 10 张 PNG：desktop/mobile complete preview 的 top/actions、confirm loading、retryable error、verified success、needs-review success，以及 conflict 的 refreshed preview/explicit reconfirm action。图片呈现真实 Tokyo Atlas 页面与可滚动 collection panel，不是脱离产品页面的状态卡片；字段无横向裁切或重叠，配对 top/action 截图合理覆盖长 preview。
- SHA-256 与 `t17-browser-smoke-2026-09-23.md` 全部一致。JSON report 保留了 9 组 browser scenario、各状态 ARIA snapshot、焦点、几何和 computed CSS；desktop 为 381/381 px、mobile 为 322/322 px，均无横向 overflow。loading 为 `aria-busy=true`；retry、success、conflict 的焦点分别为 `Add needs attention`、`Place saved`、`Preview changed`；Source 链接具备 Chromium 可见 focus outline。
- `t17-catalog-intake-browser-smoke.mjs` 冷读确认只用 `page.route` 拦截 Owner auth 与 `api/catalog-intake` HTTP fixture；它仍通过 Vinext 页面加载生产 HTML/CSS、定位生产 `.catalog-intake`、等待 React hydration，并使用实际输入框、按钮、键盘、reducer、focus、alert/status 和 production presenter。它没有替换页面、React component 或 CSS。初次 confirm、retry、conflict 后显式 reconfirm 均由真实控件驱动，reconfirm 后观察到 verified success。
- 评审环境另行启动当前 Vinext 应用，并以本地 Playwright Chromium 只读加载生产页面：确认 `.catalog-intake-search` 与输入框带真实 React fiber/props、mobile panel 为 322/322 px、生产 warm background 为 `rgb(251, 248, 241)`、top border 为 `rgb(189, 64, 37)`。结合 harness 冷读、哈希、JSON/ARIA 与逐图目视，上述浏览器证据足以关闭第 1/2 轮的真实渲染一般项；早先七张 Satori 图不作为通过依据。

## Standards + Spec 回归边界

- Web/Agent 继续复用闭合 preview presenter；已知 Tabelog/预约、provenance/time/source、coordinates、duplicates、unknowns 与 warnings 都在 confirm 前可见。conflict 返回并呈现完整 `newPreview`，只有显式二次 confirm 才提交。
- D1 resolver 仍为 active session 优先；没有 active 时只恢复保留期内最新 committed receipt。较新的 cancelled/expired 不遮蔽 committed，新 active 会遮蔽旧 receipt。
- 四条精确 `/jpmap add` 命令继续在 OpenClaw native parser 中确定性映射到四个 intake tools，零模型调用；help 同时列出 Nearby/Add 闭合语法。manifest 只在 owner phase 暴露这四个 reviewed operations，没有 Record、底层 save/update/delete 或其他 T-19/T-20 能力。
- D-P06 仍为 **Proposed**。production composition 继续 Relay disabled、manual/unknown；没有 Secret、Tunnel、provider wiring、production deploy 或蓝绿切换变更，T-18 边界未被提前执行。

## 独立验证

- `git diff --check d9d4886cb99b06ee7dcf23a16e98af61b7de6731 --` 通过；三个 `.orig` 文件保持排除且未触碰。
- T-17 focused Web test files **10/10 通过**：Web response/panel/UI state、D1 publisher/state、同库双 adapter E2E、intake operations/presenter、Agent gateway、command router。
- production architecture fitness **62/62 通过**。
- `npm run typecheck`、`npm run lint`、`npm run format:check`、`npm run migration:check` 全部通过。
- OpenClaw plugin contract、`src`/`dist` syntax 与字节一致性全部通过；四条 Add 命令仍由 deterministic native command 映射。
- Web 完整 suite 为 **155/156 test files 通过**。唯一失败仍是 `assessment-reset-maintenance.test.mjs` 在当前沙箱内的 nested process 环境失败；该测试与实现相对固定点均无 diff，且与 T-17 无关。architecture、T-17 E2E 与全部其他文件均在这次完整 suite 中通过，因此没有用该既有环境缺口掩盖 T-17 缺陷。

## 结论

T-17 第 3 轮 Standards + Spec + UI 独立评审为 **PASS**：0 项严重、0 项一般、0 项建议。第 2 轮三项一般发现均已关闭，首轮已关闭项、D-P06 manual/unknown 默认与 T-18 边界均无回归。此结论只关闭 T-17 code/UI review 门；评审者未勾票、未修改实现、未 commit/push，也未授权或执行 T-18 部署。
