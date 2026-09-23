# T-16 实现代码门评审（第 2 轮）

- 日期: 2026-09-23
- 评审方式: 独立 subagent 冷读复审
- 固定点: `9420d8f38c49f397368d60169703e32efc220caa`
- 被评对象: 当前未提交工作树相对固定点的全部 T-16 变更；三个既有未跟踪 `.orig` 文件不在范围内，未作为实现证据读取或修改
- 结论: 需修改

## 验证证据

- 已重新冷读 `CONTEXT.md`、本特性 `spec.md`、`architecture.md`、`tickets.md` 的 T-16、完整实现 diff 与全部新增实现/迁移/测试文件。
- 聚焦 contracts：52/52 通过（`catalog-intake-operations.contract.test.mjs`、`d1-atlas-catalog-intake.sqlite.contract.test.mjs`、`d1-catalog-intake-state.sqlite.contract.test.mjs`）。
- `typecheck`、`lint`、`format:check`、`migration:check`、`git diff --check` 均通过。
- 本轮没有重跑完整测试和 production build：复审已发现阻断 Spec 的实现缺口，且根盘仅余约 32 MB；按评审协调决定保留磁盘，由修复后的下一轮一次性重跑 full/build。第 1 轮曾在旧实现上通过 529/529 与 build，不能作为本轮代码的通过证据。
- 第 1 轮的 runtime research validator、ack-loss/同 key 并发 claim、scope commitment/full-preview/digest/exact TTL/revision CAS、Catalog save/update/delete revision 与删除清理、Review Candidate 不伪造地址/`0,0`/`verifiedAt`、provider failure 终止性及 receipt 实际清理缺口均已看到实质修复；本轮下列发现仍阻止通过。

## Standards

- [严重] `apps/web/lib/server/application/d1-atlas-catalog-intake.ts:678`: publisher 虽把精确 evidence union 另存到 `intakeEvidence`，却仍同时物化旧 `ReservationSnapshot`/`TabelogSnapshot`/`SourceLink`，并由 `public-read-manifest.ts:204` 只公开这些压扁字段。尤其 reservation 为 unknown 时，`reservationSnapshot` 在 682–687 行用提交时间编造 `checkedAt`；已知 Owner assertion/Agent observation 则被统一成 `checkedAt`，715–741 行的 sources 丢失 provenance、`assertedAt|observedAt|checkedAt` 与 geocoder license。结果是公开层无法区分“Owner 提供 / Agent 观察 / durable geocoder”，unknown 还会看起来像刚核验过，违反持久化与公开映射的 provenance/time/license 保真边界。→ 让 Catalog/public DTO 直接按闭合 evidence/source union 投影；unknown 不生成时间或虚假来源，Owner/Agent/geocoder 分别保留正确时间键、provenance 与 license，并补 public read 的逐分支正负 contract。
- [建议] `apps/web/product/application/catalog-intake/catalog-intake-coordinator.ts:1123`: identity、geocoder、research 与 revision 仍分别复制“重建 preview/version/digest/TTL → CAS → conflict”的流程；本轮 warning 排序分叉正是此重复结构已经造成的实际漂移。→ 提取统一的 `refreshPreview` 深方法，让各 provider 只提供规范化 proposal，再由一个位置排序 warnings、更新 version/digest/accepted activity并 CAS。

## Spec

- [严重] `apps/web/product/application/catalog/catalog-item-projection.ts:26`: `committed_needs_review` 已独立保存并能在 `full_merged_catalog` 读取，但后续 Visit 链路只接受 `AtlasItem`：单 item projector 在 42–45 行用 `isAtlasItem` 排除 `AtlasReviewCandidate`，`D1VisitState` 的 item context 又只在 `d1-visit-state.ts:203–221` 连接 `atlas_items`；因此 `visit.create` 在 `visit-operations.ts:73–75` 对刚返回成功的 needs-review item 稳定报 `not_found`。assessment 同样在 `place-assessment-operations.ts:45–47` 明确拒绝 candidate。这与 AC46“两种 committed 结果均可在 Owner Catalog/detail 查看并允许后续 Visit”直接冲突。→ 给 Owner-only Review Candidate 建立可供 Visit/个人状态读取的受限 item projection（仍不得进入 verified map/Nearby），让 D1 Visit context 同时读取 candidate，并增加 `committed_needs_review → visit.create/read-after-write` 合同测试。
- [一般] `apps/web/product/application/catalog-intake/catalog-intake-coordinator.ts:2686`: provider refresh 失败且原 preview 只有 `needs_review` 时，helper 在 2692–2694 行把 `provider_unavailable` 追加到末尾，得到 `[needs_review, provider_unavailable]`，违反 preview DTO 固定的 `stale_evidence → provider_unavailable → source_conflict → needs_review` 枚举序；`catalog-projection.ts:121–172` 只检查 warning code 唯一，不检查顺序，所以该非法顺序会被持久化的 Review Candidate 接受。现有失败刷新测试也只用 `some()` 检查 code，未验证完整闭合 DTO。→ 用统一 canonical warning normalizer 去重并按规范排序，同时让持久化 runtime validator 拒绝乱序 warnings，补 exact-array 和 tampered stored candidate 测试；provider 恢复时还应重算/移除已不适用的 warning。

## 第 1 轮发现处置

- runtime research closed-union validation：已修复；恶意扩展字段、URL/time/range/provenance/freshness 负测通过。
- ack-loss、same-key 并发、attempt-scoped claim：已修复；post-commit response-loss 不再误报 `failed_no_write`，同 key 只提交一次。
- scope commitment、完整 preview 重读/重算 digest、exact TTL、revision CAS：已修复；跨 scope、tampered preview、30:00 边界与 revision race 均有零写测试。
- Catalog save/update/delete revision、identity/snapshot 清理：已修复；保存/更新/删除 race 与删除后重加有覆盖。
- `Address needs review`/`0,0`/`verifiedAt` 伪事实：已修复为独立 `AtlasReviewCandidate`；verified map/Nearby 已显式只读 verified profile，未发现 candidate 泄漏。
- provider failure stale/unknown 终止性：主流程已修复为一次 conflict 后可稳定终止；仍有本轮 warning 规范化发现。
- receipt 180 天清理：已加入真实 DELETE，精确保留边界有覆盖。

## 结论

当前结果为 **需修改**：2 项严重、1 项一般、1 项建议。前两项分别破坏 needs-review 的用户承诺和 evidence 的可信公开语义，不能留给 T-17/T-18 兜底。修复严重/一般项后，应重新进行独立代码门，并补跑完整测试与 owner-poc production build。

---

# T-16 实现代码门评审（第 3 轮）

- 日期: 2026-09-23
- 评审方式: 独立 subagent 冷读复审
- 固定点: `9420d8f38c49f397368d60169703e32efc220caa`
- 被评对象: 当前未提交工作树相对固定点的全部 T-16 变更；三个既有未跟踪 `.orig` 文件不在范围内，未读取为实现证据、未修改
- 结论: 需修改

## 验证证据

- 重新冷读 `CONTEXT.md`、本特性 `spec.md`、`architecture.md`、`tickets.md` 的 T-16、当前完整 diff 与全部新增实现/迁移/测试文件；按 `hf-review` 的 Standards + Spec 双轴并入 UI/API 消费边界检查。
- 聚焦 contracts：99/99 通过，覆盖 intake coordinator/publisher/state、Catalog、Visit、destructive、public read 与 Nearby。
- `typecheck`、`lint`、`format:check`、`migration:check`、`git diff --check` 全部通过。
- 完整测试按门槛启动后已观察 290 项通过；代码门随后被下列严重项明确击穿，按评审协调要求停止，故这不是完整 suite 通过证据。只清理了本轮生成的 `/tmp/atlas-reset-*`；未碰其他目录。
- 未运行 owner-poc production build：结论已确定为需修改，且协调要求不再为失败门消耗磁盘。停止后可用空间约 45 MB。
- 第 2 轮的 unknown reservation 伪 `checkedAt` 已移除；intake-backed public projector 能从精确 evidence 生成 provenance/time/license union；warning canonical 排序/去重及 Catalog candidate、D1 active preview 对乱序/重复 warning 的拒绝也已实质加入。verified Catalog/map/Nearby 仍显式过滤 Review Candidate，未发现 candidate 泄漏。

## Standards

- [严重] `apps/web/product/application/catalog-intake/catalog-intake-coordinator.ts:1216`: `provider_unavailable` 是不区分 provider 的单一 warning，但 geocoder 成功会调用 `withoutRefreshFailureWarnings` 删除它，research 成功也会在 1339–1348 行删除它；每个 provider 失败则又通过 2692–2699 行重新加入。两个 provider 同时启用且“一成一败”时会形成稳定振荡：例如 geocoder 持续失败、research 成功，第一次 geocoder 添加 warning 并返回 conflict，下一次 geocoder 保持不变后 research 删除 warning 并再返回 conflict，随后重复，永远到不了 publish。反向组合也有同类问题。这使第 1 轮要求的 provider failure stale/unknown 终止性发生回归，而现有测试只各自覆盖单 provider。→ 聚合一次 confirm 中所有 enabled provider 的 refresh 结果后统一重算 warning，或使用 provider-specific 内部失败状态再投影通用 warning；补 geocoder/research 一成一败的连续 confirm 测试，证明一次稳定 conflict 后可提交且 observation time 不被伪更新。
- [一般] `apps/web/features/atlas/public-read-client.ts:30`: public manifest 已为 intake item 返回精确的 reservation/Tabelog evidence union，但浏览器仍直接把响应反序列化为旧 `AtlasItem[]`。`reservation:{status:'unknown'}` 没有旧模型要求的 `mode/label`，而 `use-atlas-view-model.ts:171`、`atlas-screen.tsx:719` 与 1093–1097 仍读取这些旧字段；known intake evidence 的 `assertedAt|observedAt` 也不会进入页面“核验时间”。同一公开 API 的 production consumer 因 unchecked generic cast 绕过类型边界，新 intake item 会显示空预约文案/错误的时间语义。→ 为 Public Catalog DTO 建独立 browser decoder/view model：显式处理 legacy 与 intake discriminant，将 unknown 呈现为 unknown，并按 provenance 读取正确时间键；补 manifest → `loadPublicCatalog` → 页面模型的 intake known/unknown contract。
- [建议] `apps/web/product/application/catalog-intake/catalog-intake-coordinator.ts:1123`: 第 2 轮建议的统一 `refreshPreview` 仍未落实；identity/geocoder/research/revision 各自复制 version/digest/TTL/CAS/conflict 流程，本轮双 provider warning 振荡继续证明这种重复已经制造行为分叉。→ 把 provider 结果先聚合为一个规范化 proposal，再由单一深方法更新 evidence、warnings、version/digest/accepted activity 与 CAS。

## Spec

- [严重] `apps/web/product/application/destructive/destructive-operations.ts:44`: Review Candidate 的 Visit create/update 已改用 `VisitTarget`，但 `visit.delete` 仍依赖只返回 `AtlasItem` 的 `DestructiveItemProjection`（`destructive-state.ts:18–20`），并在 50–51 行把 candidate 判为不存在；production 查询 `d1-destructive-state.ts:151–175` 也只连接 `atlas_items`，没有读取 `atlas_review_candidates`。因此同一 `committed_needs_review` item 可以创建和更新 Visit，却无法删除该 Visit，直接违反 AC46“允许后续 Visit”及本轮 create/update/delete 验收。→ 让 Visit deletion 使用与 create/update 相同的 candidate-aware Visit target projection，并在 D1 deletion context 合并 candidate payload；更新闭合 result type，补 candidate Visit create→update→delete→有效到访状态回落的 Application+D1 contract。
- [一般] `apps/web/lib/server/public-read/public-read-manifest.ts:41`: `PublicCatalogItemV1` 仍把无 provenance 的旧 Tabelog/reservation/source shape 与新 intake discriminated union 混在同一 v1 类型（41–145 行），而 AC1 要求 `tabelog/reservation/sources` 严格使用闭合 provenance/time union。对 intake-backed item 的主要路径已经精确，但 314–318 行在 `intakeEvidence.tabelog.status='unknown'` 时仍可能回退到顶层 legacy `source.tabelog`，使权威 unknown 被旧 `checkedAt` 覆盖。→ 让 intakeEvidence 一旦存在就完全支配 intake evidence projection（unknown 即不输出 Tabelog），并把 legacy 输出显式版本化/迁移为不冒充 provenance 的兼容 DTO，而不是混入声明为严格的 v1 union；补 inconsistent stored item 的 fail-closed 测试。

## 第 2 轮发现处置

- needs-review Visit：create/update 已修复，delete 尚未修复，仍为严重项。
- persisted/public evidence：publisher 不再为 unknown reservation 编造 `checkedAt`，精确 intake evidence 与 public sources 已加入；仍有 browser consumer 与 legacy/unknown precedence 缺口。
- warnings canonical 顺序/去重：单数组规范化与 Catalog/D1 validator 已修复；多 provider 成败组合引入新的非终止振荡。
- 第 1 轮 transaction/scope/digest/TTL/revision/identity/response-loss/receipt-cleanup 保护经复核未见回归；相关 publisher focused contracts 继续通过。

## UI 检查

- 本轮没有新增视觉布局或交互组件，Review Candidate 仍不进入公开地图/Nearby；既有 T-14 截图的美学方向、焦点与三态不因本轮变更失效。
- 但新 Public Catalog evidence shape 没有进入 browser decoder/view model，属于上列一般级数据展示边界问题；在修复前不接受其用户可感知展示为通过，也不以旧截图代替 intake read-after-write 验证。

## 结论

当前结果为 **需修改**：2 项严重、2 项一般、1 项建议。修复严重/一般项后需再次独立复审，并一次性完成 full suite 与 owner-poc production build。

---

# T-16 实现代码门评审（第 4 轮）

- 日期: 2026-09-23
- 评审方式: 独立 subagent 冷读复审
- 固定点: `9420d8f38c49f397368d60169703e32efc220caa`
- 被评对象: 当前未提交工作树相对固定点的全部 T-16 变更；三个既有未跟踪 `.orig` 文件不在范围内，未读取为实现证据、未修改
- 结论: 需修改

## 验证证据

- 重新冷读 `CONTEXT.md`、本特性 `spec.md`、`architecture.md`、`tickets.md` 的 T-16、当前完整 diff 与新增实现／迁移／测试；按 `hf-review` 的 Standards + Spec 双轴并入公开 DTO 与浏览器消费边界检查。
- 聚焦 contracts：109/109 通过，覆盖 intake coordinator/publisher/state、Catalog、Visit create/update/delete、D1 destructive/Visit adapters、Public Read、browser decoder 与 Nearby。
- `typecheck`、`lint`、`format:check`、`migration:check`、`git diff --check` 全部通过。
- 完整 `npm test` 未运行：检查时根盘可用空间从约 24 MB 降至约 10 MB，低于本轮约定的 20 MB 启动门槛；未生成可清理的 `/tmp/atlas-reset-*`。owner-poc build 同样未运行，因为可用空间低于 15 MB 门槛。未清理任何其他目录。
- 额外使用真实 `listAtlasItemsResponse` + 内存 `ReviewCandidate` 复现匿名目录行为：响应为 HTTP 500，正文为 `Public data is temporarily unavailable.`；这不是推断，而是当前 route/projector 的可复现结果。
- 第 3 轮四个目标均看到实质修复：candidate 已贯通 Visit create/update/delete且不进入 verified profile/Nearby；两种 provider 一成一败组合可终止且 observation time 稳定；browser 显式区分 legacy/intake；intakeEvidence unknown 不再回落到 legacy 字段。第 1 轮事务/scope/digest/exact TTL/revision/identity/ack-loss/180 天清理保护未见回归。

## Standards

- [一般] `apps/web/lib/server/public-read/public-read-manifest.ts:17-40,296-298`: 为区分 legacy/intake，公开响应新增了必填 `evidenceModel`，但已确认 AC1 的 `PublicCatalogItemV1` allowlist 没有该字段并明确“其余字段禁止”（`features/005-owner-poc-unified-api/spec.md:47`）。实现需要显式 decoder 的方向正确，但不能在未更新已确认 contract 的情况下扩张匿名公开 DTO。→ 在不增加未批准公开字段的前提下按闭合 evidence union 判别，或先走规格变更／复审把版本判别字段纳入正式 DTO；补 exact-key contract。
- [建议] `apps/web/product/application/catalog-intake/catalog-intake-coordinator.ts:1118-1344`: identity、provider evidence 与 revision 仍各自承担 preview/version/digest/TTL/CAS/conflict 的相近流程。第 3 轮振荡已通过先聚合 provider 结果再统一 warning 修复，但重复结构仍增加后续分叉风险。→ 后续提取单一 `refreshPreview` 深方法；本项不单独阻止通过。

## Spec

- [严重] `apps/web/app/api/items/list-atlas-items-response.ts:12-27`、`apps/web/lib/server/public-read/public-read-manifest.ts:287-335`、`apps/web/app/api/items/[id]/get-atlas-item-response.ts:9-39`: `committed_needs_review` 现在正确保存为不伪造地址／坐标／`verifiedAt` 的 `AtlasReviewCandidate`，但匿名 `/api/items` 仍读取 `full_merged_catalog`，public projector 又无条件要求 `area/address/latitude/longitude/reservation`。只要目录存在一个合法 candidate，整个匿名 catalog list 就返回 500；candidate detail 同样没有 Owner-only 投影，browser `catalog.list` 只走匿名 `loadPublicCatalog`，Owner 也看不到它。该行为既未把 candidate 作为 Owner-only Catalog/detail 展示，又破坏所有 verified 地点的公开列表，违反 AC1 与 AC46。→ 匿名 list/get 只读取／投影 verified Catalog；另建 Owner 鉴权的闭合 ReviewCandidate list/detail DTO，并让 Owner browser adapter 使用它。补 `committed_needs_review → anonymous list 200 且不含 candidate → owner list/detail 可见 → Visit create/update/delete → verified map/Nearby 不可见` route/Application contract。

## UI 检查

- 本轮没有新增视觉布局；candidate Visit lifecycle 与 intake evidence browser decoder 的数据层聚焦测试通过，既有 T-14 美学方向未见代码漂移。
- 但 Owner-only candidate 无法经当前 browser Catalog route 到达界面，匿名列表反而会 500，因此不能用既有截图把该路径判为通过。根盘低于 build 门槛，本轮未启动 production build/真实渲染；该资源缺口与功能阻断均需在下一轮关闭。

## 结论

当前结果为 **需修改**：1 项严重、1 项一般、1 项建议。第 3 轮四个目标修复本身均已复验通过，但 Review Candidate 尚未正确接入公开 verified-only 与 Owner-only 两条读取投影；修复严重/一般项并补 route contracts 后，需再做独立代码门，并在磁盘达到阈值后运行完整测试与 owner-poc production build。

---

# T-16 实现代码／UI 门评审（第 5 轮）

- 日期: 2026-09-23
- 评审方式: 独立 subagent 冷读复审
- 固定点: `9420d8f38c49f397368d60169703e32efc220caa`
- 被评对象: 当前未提交工作树相对固定点的全部 T-16 变更；三个既有未跟踪 `.orig` 文件不在范围内，未读取为实现证据、未修改
- 结论: 需修改

## 验证证据

- 重新冷读 `CONTEXT.md`、本特性 `spec.md`、`architecture.md`、`tickets.md` 的 T-16、当前完整 diff 与新增实现／迁移／测试；按 `hf-review` Standards + Spec 双轴及 `hf-ui-design` checklist 检查公开／Owner 边界。
- 聚焦 contracts 122/122 通过，覆盖 publisher/session/Catalog、candidate Owner routes/browser decoder/Inbox contract、Visit/destructive、Public Read 与 Nearby。
- `typecheck`、`lint`、`format:check`、`migration:check`、`git diff --check` 全部通过。
- 独立内存 proof 实际得到 candidate 的匿名 `assessment.display`（含 itemId、favorite、manualVisited、summary）和 `visit.listDisplay`（含 itemId、itemTitle、note），证实下列泄漏并非静态推断。
- 完整 `npm test` 依磁盘门槛启动；确认严重项后按协调立即停止，停止前观察 61 项通过、退出码 130，不能作为完整 suite 证据。未产生 `/tmp/atlas-reset-*`；owner-poc build 未运行。
- 代码门已被严重项击穿，按协调停止真实 UI 渲染／截图；未用 source contract 或旧截图替代视觉验收。

## Standards

- [一般] `apps/web/features/atlas/public-read-client.ts:65-82` 把 Owner candidate endpoint 的 HTTP 401 直接变成空数组；`use-atlas-view-model.ts:138-157` 随后标为 `ready`，`atlas-screen.tsx:1477-1485` 显示 “No places need review.”。当初始 Owner status 为 true、Cookie 随后失效时，页面把“需重新登录”误报为“没有待复核地点”，且不触发既有 login-required 状态机。→ 401 应触发 Owner login-required 并进入 signed-out／明确认证错误态，补 session 失效 browser/view-model contract 与真实 401 渲染。

## Spec

- [严重] `apps/web/product/application/public-display/public-display-operations.ts:51-72,94-101,123-132` 没有把匿名 personal read 限制到 verified Catalog：assessment 只检查 `catalog.get` 非空，而 `catalog-read.ts:37-38` 现在会返回 `AtlasReviewCandidate`；visit list/detail 完全不检查 Catalog。T-16 又在 `visit-operations.ts:71-110` 明确允许 candidate 后续 Visit。结果是 Owner-only candidate 的 ID、标题、评分／收藏／评论、Visit note 和媒体关联可经匿名 personal/journal/display-media 链路公开；browser 还会因随后请求 candidate item detail 的 404 使 Journal 加载失败。该行为违反“needs_review 只在 Owner Catalog”的架构边界。→ public assessment/visit/media display 必须以 verified catalog 为授权集合：candidate assessment/detail/media not-found，list 过滤 candidate visits；Owner 私有链路仍保留完整 lifecycle，并补 anonymous 零泄漏 route/Application contracts。

## 第 4 轮发现处置

- Anonymous Catalog list/detail 已改为 verified-only/候选 404；Owner candidate routes 先鉴权且 Inbox 分离；candidate 仍不进 map/Nearby；未批准的 `evidenceModel` 已移除，Public DTO exact projector 与 legacy/intake decoder 聚焦测试通过。前四轮事务、scope/digest/TTL/revision、ack-loss/concurrency、cleanup、Visit lifecycle、provider warning/终止性保护未见回归。

## 结论

当前结果为 **需修改**：1 项严重、1 项一般。先修复 candidate personal/Visit/media 的匿名旁路和 401 误空态，再进行独立 code+UI gate，并完成未中断 full suite、owner-poc build 与规定截图。

---

# T-16 实现代码／UI 门评审（第 6 轮）

- 日期: 2026-09-23
- 评审方式: 独立 subagent 冷读复审
- 固定点: `9420d8f38c49f397368d60169703e32efc220caa`
- 被评对象: 当前未提交工作树相对固定点的全部 T-16 变更；三个既有未跟踪 `.orig` 文件不在范围内，未读取为实现证据、未修改
- 结论: 需修改

## 验证证据

- 聚焦 contracts 139/139 通过；`typecheck`、`lint`、`format:check`、`migration:check`、`git diff --check` 全部通过。
- 完整 `npm test` 按要求只运行一次并自然结束：564 项中 561 通过、3 失败，退出码 1。原始长输出在工具传输中被截断；可恢复的失败明确包含 production architecture fitness。随后只删除本项目生成的 `/tmp/atlas-reset-*`，未清理其他目录。单独精确重跑 `architecture-fitness.test.mjs` 为 61/62；完整 suite 的另外两项失败无法从截断输出可靠恢复，本评审不猜测其身份，留待作者聚焦定位。
- `npm run build:owner-poc` 通过；构建前可用空间约 107 MB。
- 第 5 轮两项发现已实质修复：统一 `PublicDisplayAccess` verified-catalog gate 覆盖 assessment、Visit list/detail 与 media，candidate 匿名路径 fail closed 且 verified 正常；Owner candidate 401 现在产生 typed `auth_required`、发布 login-required event，并由 view model 进入 `signed_out`，不再误报 empty。前四轮关键保护未见回归。
- 因完整测试的架构门已经失败，按评审协调停止真实 UI 渲染／截图；未用 source contract 或旧截图替代视觉验收。

## Standards

- [一般] `apps/web/product/application/visits/visit-item-projection.ts:1-3`、`apps/web/product/application/visits/visit.ts:1`、`apps/web/product/application/visits/visit-state.ts:1-4`: 新增的 `VisitTarget` 放在 projection 模块后形成 `visit-item-projection -> visit-state -> visit -> visit-item-projection` 依赖环；production architecture fitness 明确报 `dependency_cycle`，而已确认架构要求 Application Operations 无环依赖。→ 把 `VisitTarget` 放到不反向依赖 projection/state 的稳定领域类型 owner，让 projection 单向引用，并以 production architecture fitness 归零为验收。
- [一般] `apps/web/features/atlas/model.ts:41-133`、`apps/web/scripts/architecture-fitness.ts:2161-2208`: `OwnerReviewCandidateView` 作为新的大接口直接加入受约束的 UI compatibility adapter，但该 adapter 的闭合 allowlist 未批准此声明；production architecture fitness 明确报 `compatibility_adapter_shape / model:unsupported-statement`。→ 将 candidate browser DTO 放入明确的 Owner/browser adapter 模块并由 `model.ts` 仅作获准别名，或在有架构依据与测试的前提下正式更新 manifest allowlist；不得仅放宽 fitness 规则来消音。

## Spec

- 本轮未发现新的五路 confirm、candidate 可见性、公开数据或 Owner 认证规格偏差；当前阻断来自 Standards 轴的默认测试与无环／compatibility-adapter 架构门。

## 结论

当前结果为 **需修改**：0 项严重、2 项一般、0 项建议。第 5 轮隐私泄漏与 401 误空态已关闭，owner-poc production build 通过；但默认完整测试为 561/564，且可复现的 production architecture fitness 同时报告依赖环与 compatibility adapter shape 违规。修复两项一般问题并查明完整 suite 余下两项失败后，需重新完成 full suite 与真实 code/UI gate；所有严重／一般项归零前不能 PASS。

---

# T-16 实现代码／UI 门评审（第 7 轮）

- 日期: 2026-09-23
- 评审方式: 独立 subagent 冷读复审
- 固定点: `9420d8f38c49f397368d60169703e32efc220caa`
- 被评对象: 当前未提交工作树相对固定点的全部 T-16 变更；三个既有未跟踪 `.orig` 文件不在范围内，未读取为实现证据、未修改
- 结论: 通过
- 用户确认: 2026-09-23（用户指示 `continue`）

## 验证证据

- 重新冷读 `CONTEXT.md`、本特性 `spec.md`、`architecture.md`、`tickets.md` 的 T-16、当前 diff 与全部新增文件；按 `hf-review` Standards + Spec 双轴并入 `hf-ui-design` checklist。
- production architecture fitness、Visit boundary 与 ViewModel boundary 共 64/64 通过：`VisitTarget` 已移入不依赖 projection/state 的中立模块，无 dependency cycle；`OwnerReviewCandidateView` 已移出受限 `model.ts`，compatibility adapter shape 恢复；只有 `visit-item-projection.ts` 可调用 `projectCatalog`，handlers 仍被 boundary test 禁止。
- 全部 changed/new focused tests 144/144 通过，覆盖五路 publish、transaction/session/scope/digest/exact TTL/revision/identity、response-loss/concurrency/receipt、candidate Visit lifecycle、PublicDisplayAccess、Owner 401、public DTO/evidence/warning、Nearby 与 routes。
- `typecheck`、`lint`、`format:check`、`migration:check`、`git diff --check` 全部通过。
- 完整 `npm test` 本轮只运行一次并自然结束：564/564 通过，退出码 0；随后只删除本项目生成的 `/tmp/atlas-reset-*`，未清理其他目录。
- `npm run build:owner-poc` 通过。完整测试清理后、构建前根盘可用约 73 MB。
- 第 5 轮统一 `PublicDisplayAccess` verified-catalog gate 与 typed Owner `auth_required -> login-required event -> signed_out` 保护继续通过；前四轮 transaction、scope、canonical digest、exact TTL、revision CAS、ack-loss、并发、180 天 receipt cleanup、candidate 隔离、evidence provenance/time/license 与 provider warning/终止性未见回归。

## Standards

- 无严重或一般发现。第 6 轮的 dependency cycle 与 compatibility adapter shape 两项一般问题均已修复，且未通过放宽 architecture fitness 或 handler boundary 规则消音。

## Spec

- 无严重或一般发现。五路 confirm、server-only mutation key、原子 publish、response-loss replay、needs-review Owner-only、verified map/Nearby 与匿名 personal/media 零泄漏等 T-16 边界均有正负 contract 支持。

## UI 检查

- 环境缺少可复用的 Chrome/Chromium/Chrome Headless Shell 可执行文件；已检查标准系统路径与既有 Playwright/Puppeteer cache，均为空。按评审协调禁止下载大型浏览器，因此本轮未生成 desktop/mobile 截图，也不把源码或 contract 测试伪称为真实视觉验证。
- 源码／contract 辅助证据显示 Owner Inbox candidate 区域沿用既有暖色 editorial tokens，具备 `h2 -> h3` 标题层级、`aria-busy` loading、signed-out Owner login CTA、`role=alert` error + retry、empty CTA、ready/list 与原生可聚焦按钮；candidate 不进入 map/Nearby。真实排版、响应式、焦点外观与视觉硬伤仍缺浏览器截图证据。
- [建议] UI evidence gap（运行环境）: 在可复用浏览器可用后补拍 Owner Inbox desktop ready/list 与 mobile signed-out/empty/error 至少一态，并按 editorial tokens、排版、焦点和 candidate 不进地图做目视复验；本项是环境证据缺口，不是已观察到的实现缺陷。

## 结论

当前代码门结果为 **通过**：0 项严重、0 项一般、1 项建议。第 6 轮两项架构阻断已关闭，focused/static/full/build 全绿；真实 UI 截图因环境无浏览器且禁止下载而未完成，已作为明确 evidence gap 记录，不宣称视觉门已有截图证明。
