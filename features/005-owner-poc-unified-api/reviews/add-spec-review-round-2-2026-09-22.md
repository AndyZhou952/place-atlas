# Add 增量规格评审（第 2 轮）

- 日期: 2026-09-22
- 评审方式: subagent
- 结论: 需修改（Needs changes）

## 评审范围

独立冷读修订后的 `spec.md`、`tickets.md`、`progress.md`、`product/assumptions.md` 与第 1 轮评审；按 HarnessFlow requirements checklist 和 `hf-ui-design` 规格检查项，复核 Google/Leaflet、Tabelog best-effort、闭合 operation 契约、会话/幂等、confirm refresh、verified/Nearby、UI 及工件一致性。

## 发现项

- [一般] `spec.md:37,94-98,127-129`: 用户故事仍承诺“只输入餐厅名”即可选择并预览，但 `select` input 强制调用方提供非空 `ownerFields.title/address`；Google 瞬时文本又明确不能一键改标成 Owner 数据，而 `DurableGeocoderPort` 的结果只能在已经提供地址后进入流程。于是 `/jpmap add <name>` 即使成功找到 Place ID，也可能在用户另行输入地址前无法生成合法 preview，和 Agent 应帮助补齐地址的核心故事不一致。→ 让 `select` 只要求 session/version/ordinal，Owner override 可选；由有持久化许可的 durable source 以餐厅名＋位置线索提出 `title/address/coordinates`，preview 显示来源后由 Owner confirm。若 durable source 无结果，再明确进入“请 Owner 补地址”状态并允许最终 `needs_review`；不得借 Google transient content 填充 durable 字段。补充“仅名称成功、仅名称无 durable result、Owner 后补地址”三条可判定流程。

- [一般] `spec.md:101-104,157` 与 `product/assumptions.md:A-48`: WebResearch 的硬预算写成**整条 intake 总计** 1 次 search、5 个 page requests，但首次 Tabelog/官网研究可以消费完 5 页，而 confirm 又强制重新取得所有 enabled provider observations。当前契约没有预留 confirm 请求，可能导致 Agent 成功产出 proposal 后永远只能在 confirm 时预算耗尽→unknown/stale→conflict，无法按原证据提交。→ 在保持用户确认总预算不变的前提下明确阶段配额（例如初次研究最多 3 页、confirm 保留 2 页），或规定 confirm 在什么条件下可用未过期 observation 而不联网；必须保证任一允许的初次研究消费都存在确定的可终止 confirm 路径。fixtures 覆盖用满初次配额、confirm refresh、refresh 失败后一次 conflict 再确认，以及总计不超过 1/5/15s/60s/3 redirects。

- [一般] `spec.md:47,126-133`: 标题虽称“闭合 Add DTO”，但仍有开放部分：`coordinates`、`locationEvidence`、`freshness`、`suspectedDuplicates/unknownFields/warnings` 没有闭合 shape/range；只定义 discover output 和 preview DTO，没有 select/confirm/cancel 的 result/error unions；`owner_asserted` 坐标在 AC36 只带 `assertedAt`，operation input 又没有坐标来源 URL，但 persisted `sources[]` 的 `owner_asserted location` 强制 `url`，该合法输入无法映射到声明的持久化 schema。→ 补齐四个 operation 的 success/error outputs、稳定错误类别及所有嵌套 discriminated unions；经纬度限定 finite 与合法范围，freshness 枚举及边界明确。Owner 坐标来源要么允许没有 URL 并用明确的 `owner_asserted` location evidence union，要么要求 input 提供经校验的 source URL，二者择一并保证 input→preview→persisted→public 映射总是可表示。

- [一般] `spec.md:99,104-106`: 状态表只列出 `confirm→committed`，但 confirm-time evidence/revision 变化被规定为“生成新 preview/version并返回 conflict”；这实际上是 `preview_ready → preview_ready` 状态转移，却未列入闭合合法转移。refresh 失败后保留 stale 值再确认的版本/digest 行为也没有明确，测试难以判断第二次 confirm 应 commit、再次 conflict 还是持续 refresh。→ 把 preview edit/refresh conflict 的 self-transition 写入状态表，明确每次 refresh 的 version/digest/accepted-activity 规则；规定第一次 conflict 返回的新 preview 在无用户编辑时再次 confirm 的联网与 digest语义，保证有限步终止而不是冲突循环。

- [一般] `spec.md:179`、`product/assumptions.md:A-47,A-49`、`progress.md:31-34`: spec 声称用户已确认全部 review 修订（含 OSM-compatible geocoder 和精确 mutation/session 规则），但假设台账把 A-47/A-49 标成仅“生效”，只有 A-48 Tabelog 选择为“已确认”。这让评审者无法判断哪些是用户决定、哪些是为推进而采用的默认值。→ 按真实确认记录统一状态：若用户只明确确认 Tabelog Agent-first，则 spec 用户确认行只声明该部分，A-47/A-49 保持生效假设；若其余也已明确确认，则把相应台账改为“已确认”并写明依据。tickets/progress 随最终状态同步，不要用一条总括确认覆盖不同权威级别。

## 第 1 轮发现项复核

- Google Places 已收窄为 request-only content＋可长期保存 Place ID；Google Geocoding 不再为 Add 提供 durable location，且禁止进入 Leaflet。`DurableGeocoderPort` 与 Nominatim 的许可、1 req/s、UA/Referer、cache、attribution、禁 autocomplete/systematic scraping 均成为明确 contract。第 1 轮严重发现已解决。
- 用户现已选择个人非商用、Owner-directed、single-intake、Agent-first Tabelog best-effort。修订稿诚实标记 `agent_observed/observedAt`、不声称官方授权、禁止 SERP HTML/internal API/绕过限制，并在工具失败时用手填/unknown 兜底；本轮不因该已确认产品选择本身重复阻塞。剩余问题仅是 confirm 刷新预算的内部可执行性。
- Add-only key 已 domain/version 分离，输入、执行顺序、过期/取消/旧 preview、committed TTL 后回放、180 天 receipt、跨 owner/channel/conversation 拒绝均已可测；verified/needs_review、`reused_existing` 与地图/Nearby 可见性也已补齐。
- UI 已覆盖 empty/error/ambiguous/expired/conflict CTA、disabled reason、`aria-busy`、live region、字段错误、阶段焦点、键盘路径、触控尺寸、桌面/移动真实渲染测试；第 1 轮 UI 发现已解决。

## 结论说明

修订已解决第 1 轮两项严重问题及大部分一般问题，但上述 operation 可达性、研究预算与闭合 DTO/状态机仍直接影响第三方能否写出唯一通过/失败判定，因此本轮不能通过。只需返回 to-spec 修正这些发现项；无需推翻用户确认的 Tabelog Agent-first 方向。
