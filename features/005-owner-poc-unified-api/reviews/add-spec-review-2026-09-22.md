# Add 增量规格评审（第 1 轮）

- 日期: 2026-09-22
- 评审方式: subagent
- 结论: 需修改（Needs changes）

## 评审范围

独立冷读 `features/005-owner-poc-unified-api/spec.md` 的 Add 增量，并对照 `CONTEXT.md`、`product/architecture.md`、`docs/decisions.md`、`product/assumptions.md`、feature 004 已确认的 Add 规格／架构、HarnessFlow requirements checklist 与 `hf-ui-design` 规格检查项。供应商边界另核对了 2026-09-22 可访问的 Google 与食べログ官方政策。

## 发现项

- [严重] `spec.md:21,95,102,153`（并与 feature 004 `architecture.md:54` 冲突）: 规格要求把 Google Geocoding 返回的规范地址与经纬度长期写入 `atlas_items`，随后用于公开 Atlas/Leaflet；但 Google 当前官方政策写明 Geocoding content 的预取、缓存与存储通常受限（Place ID 是明确例外），且 Geocoding 结果显示在地图上时必须显示在 Google Map。feature 004 因此明确限定 Google Geocoding/Routes 为 request-only、不得把地址／坐标／geometry 放入 Leaflet。本增量静默推翻了该边界，且 Further Notes 只核对 Places policy，没有核对 Geocoding policy。→ 在规格层先选定一条合法、可测试的 durable location 路径：例如 Place ID 仅作强身份，长期地址／坐标来自有明确持久化和非 Google 地图展示许可的来源或 Owner 明确录入；若继续使用 Google Geocoding，则必须把允许缓存期限、刷新／删除、attribution 和 Google Map 展示边界写成验收条件，不能宣称无限期存入 Atlas/Leaflet。依据：[Google Geocoding policies](https://developers.google.com/maps/documentation/geocoding/policies)、[Google Places policies](https://developers.google.com/maps/documentation/places/web-service/policies)。

- [严重] `spec.md:39,99,117,137,145,154`: User Story/Acceptance Criteria 把 Agent 读取 canonical Tabelog 页面并持久化评分写成可交付行为，但当前食べログ `robots.txt` 对 `GPTBot` 为 `Disallow: /`，利用规约还限制未经许可复制、利用和为再利用而保存网站信息。末尾“policy gate 不满足就关闭”只是运行时逃生口，不能让前文的成功路径成立；“检查 Google 搜索结果页”也没有指定获准的 Search API/许可字段，可能退化为抓 Google 搜索 HTML。→ 把发布基线改为：Owner 手工输入 Tabelog scalar snapshot 是必达路径；Agent 自动研究必须是 capability-gated 可选 adapter，只有具体 user-agent、origin、搜索 API、字段级读取/瞬时显示/持久化许可与速率证据全部批准才启用。当前政策不允许时 direct Tabelog adapter 必须 disabled；不得用搜索结果 HTML 抓取规避。Acceptance/UI/E2E 必须同时验证“研究能力关闭但 Add 仍成功且 Tabelog=unknown”。依据：[食べログ利用規約](https://tabelog.com/help/rules/)、[食べログ robots.txt](https://tabelog.com/robots.txt)。

- [一般] `spec.md:95-96,101-102` 对比 feature 004 `spec.md:99-105`: 新规格没有保留已确认的 confirm-time provider 重读与 evidence-digest 比较，也没有重新声明 `committed_verified | committed_needs_review | conflict | failed_no_write` 四种结果。它一方面禁止持久化 Places candidate response，另一方面要求候选集合在 D1 中不可变，却没有定义只持久化哪些许可字段；30 分钟后可能用陈旧候选／研究快照提交。→ 明确候选集合只保存稳定 Place ID、排序映射及服务端元数据，request-only 字段不得落库；select/preview/confirm 各阶段规定允许重取哪些字段。恢复 feature 004 的 confirm-time 证据复核或逐字段 freshness policy，并把四种提交结果及零半写入写回验收标准。

- [一般] `spec.md:17,69,96,101,115,138`: Add-only mutation key 仍不是足够精确的可执行契约。缺少版本化派生输入、命名域与“当前 preview”检查顺序，也没有说明一次成功 confirm 后 session 过期时重复请求应回放 receipt，还是被 expiry 提前拒绝；若旧 preview 已被修改／取消，当前文字也未明确拒绝。→ 固定例如 `add-confirm:v1 + ownerId + operation + serverSessionId + currentPreviewVersion + authoritativePreviewDigest` 的服务端 canonical derivation（不要接收 client key），先以 owner/channel/conversation 授权加载 session，再原子校验 active/current/expiry、claim、write、terminal receipt。明确：未提交过期/取消 preview 拒绝且零写入；已 committed 的相同 key 即使 session 后续过期也回放原 receipt；不同 current digest 冲突。增加跨 owner、跨 conversation、旧 preview、cancel 后 confirm 与 receipt 保留期测试。

- [一般] `spec.md:96,115,138`: 会话时限仍写成“建议连续 30 分钟”，不是可判定要求；没有 session 状态表、何种事件刷新 `lastAcceptedActivityAt`、Web 如何形成 conversation identity、terminal session 保留期，以及取消/过期后序号和 confirm 的结果。→ 把 30 分钟定为规范边界（含恰好 30:00 的行为），定义 `discovering | candidates_ready | preview_ready | committed | cancelled | expired` 等闭合状态和合法转移；只有被接受的本会话操作续期。明确 Web/Agent 的 owner/channel/conversation key、一个 active session 的替换策略、过期清理与 receipt 保留，并为重启/并发/跨入口越权提供 fixtures。

- [一般] `spec.md:94-103,116` 对比 feature 004 `spec.md:103-106`: Add 成功后没有规定何时为 `verified`、何时为 `needs_review`，也没有规定两者在地图与 Nearby 的不同可见性。`102` 的“成功后 Nearby 立即读取”会让人误以为所有 committed item 都进入 verified-only Nearby，与 `77` 和既有领域规则不一致。→ 恢复明确发布判定：只有满足经批准来源支持的稳定分店身份、规范名称、可持久化地址/坐标、完整 provenance/checkedAt 且无冲突才 `committed_verified`；否则 `committed_needs_review`。两者均可在 Owner Catalog 查看，后者带待核验标记且不进入默认 Nearby；强键复用返回自身独立 receipt/result。

- [一般] `spec.md:47,98-100,116`: 外部证据 DTO 尚不闭合且存在互相矛盾的可选性：公开 `reservation` 要求 `label,checkedAt`，内部 schema 却允许 `url?/checkedAt?` 且没有 `label`；`sources` 的 public DTO 丢失 `checkedAt`；`mode`、Tabelog score 范围/精度、reviewCount 整数边界、文本长度/Unicode normalization、URL canonicalization 以及 Owner 手填和 Agent 核验的 provenance 类型均未定义。预约规则只有核验时间，没有 stale/refresh/unknown 的时效规则，容易把数月前的预约开放日当成当前规则。→ 给 operation input、preview、persisted snapshot 和 public projection 各写一份闭合 schema/约束及映射；来源至少区分 `owner_entered | researched_official | researched_third_party`。规定预约规则的新鲜度/过期展示与刷新失败行为；动态 walk-in/queue 继续不从 reservable 推断。

- [一般] `spec.md:97,119-126,139`: UI 虽罗列状态与 token，但关键可观察行为不足：empty/error 没有明确 CTA，ambiguous 候选的选择语义未规定，disabled confirm 没有可访问原因，异步研究/preview 没有 `aria-busy`/status live-region 要求，登录失效、session 过期、stale preview/conflict 后焦点去向也未定义。→ 规定 empty→“补充街区/地址”、error→“重试且保留输入”、ambiguous→原生 radio/listbox + 地址/来源、expired/conflict→生成新 preview 的 CTA；错误用 `aria-describedby/aria-invalid`，异步容器用 `aria-busy`，结果/成功用适当 live region，disabled 原因有可访问文本，阶段切换焦点落到新标题/错误摘要。桌面和移动截图/交互测试逐项断言这些状态，触控目标继续 ≥44×44px。

## 已满足项

- Web 与 Agent 共用 `catalog.intake.*` operations、确认前不写入、DeepSeek 不产出事实、Tabelog 与个人评分分离、Google external rating 延后、Record 不继承 Add-only event-ID 例外，这些方向与用户确认及共享语言一致。
- 范围外事项已明确；UI 延续 warm editorial atlas，并提供 taste 参数和设计令牌复用方向。
- 测试决策已经选择 Application Operation、WebResearchPort、幂等与真实渲染等正确高层测试缝；修复上述契约缺口后可直接细化为可判定 fixtures。
