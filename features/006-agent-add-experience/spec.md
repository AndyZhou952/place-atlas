# 规格 — Agent Add 体验与旧 Creator Import 收缩

## Problem Statement

当前 Catalog Intake 的核心安全链已经可用，但真实微信操作把审计级 preview 的 Place ID、经纬度、证据时间、license 和完整来源 URL 全部发给用户。信息虽然正确，却不适合手机聊天界面，截图中的普通 preview 接近一整屏，核心的“是不是这家店、能不能进地图、还缺什么、下一步做什么”反而不突出。

同时，README 和线上界面没有一份面向 Owner 的完整使用说明，用户难以快速确认 Web 与微信分别能做什么、正确命令是什么、遇到 unknown／候选歧义／待审核时如何继续。

现有 Inbox 还暴露了一条未完成且不再需要的 Creator Import 链路：页面要求填写 creator/profile、展示永远 pending 的 collector 状态，并通过独立 `import.*` API、WebMCP tool 和 D1 adapter 排队。这条链路既不是当前按餐厅 Add 的入口，也没有可用 collector，容易让 Owner 误以为它是推荐导入方式；但同页的 Review Candidates 是 Add 的必要审核入口，必须保留。

真实导入还暴露出 durable geocoder、Tabelog／预约 research、DeepSeek 模糊语义和类别／推荐菜字段等后续能力缺口；这些涉及 provider、安全门和 schema，不与本次低风险呈现改动混为一个交付。

## Solution

1. 为微信增加独立的精简 Channel Presenter。核心 `catalog.intake.*` operation、持久 evidence 和 Web Owner 审核界面保持完整；只有微信回复采用手机优先的摘要。
2. 新增一份面向 Owner 的 User Manual，覆盖 Web 和微信当前已实现的功能、推荐输入方式、完整 Add 流程、Nearby、unknown／待审核／冲突和常见恢复方式。
3. README 在快速开始之前提供明显的“使用手册”入口。
4. 从 UI、browser operation catalog、WebMCP、API route、application composition、client/state 和产品 domain 中移除 Creator Import；保留 Add 的 Review Candidates，并把导航从 `Inbox` 改为更准确的 `Review`。
5. 历史 `import_jobs` migration／表保持原样，不做生产数据删除或破坏性 migration；只是停止从运行时代码访问它。
6. 把本次真实操作发现的 provider、语义和 schema 问题拆成后续独立特性，不用 prompt 或渠道文案掩盖。

## User Stories

1. 作为 Owner，我希望微信 preview 只显示需要确认的核心信息，这样我能在手机上快速决定保存或取消。
2. 作为 Owner，我希望候选和警告逐项换行，这样长地址不会和操作指令挤在一起。
3. 作为 Owner，我希望仍能在 Web Owner 界面查看完整来源和 evidence，这样精简微信回复不会牺牲可审核性。
4. 作为 Owner，我希望成功消息只告诉我地点去了哪里，不显示内部 receipt。
5. 作为 Owner，我希望有一份短手册说明网页和微信的正确使用方法及常见失败处理。
6. 作为维护者，我希望手册中的命令与真实 parser contract 一致，避免文档教用户发送系统不接受的语法。
7. 作为 Owner，我希望界面只保留按餐厅 Add 和待审核流程，不再看到无法工作的 creator 批量导入入口。

## Acceptance Criteria

### 候选回复

1. 候选回复最多三项，并使用以下稳定结构；没有值的可选行省略：

   ```text
   Japan Atlas｜请选择餐厅

   1. <名称>
      地址：<地址>
      来源：Google Maps

   回复：/jpmap add select <编号>
   ```

2. 每项只允许序号、瞬时名称、瞬时地址和 Google attribution；不得显示 Place ID、坐标、内部 session/version 或长调试信息。
3. 候选名称最多显示 80、地址最多显示 240、attribution label 最多显示 40 个 Unicode code points；超出字段在 code-point 边界裁减并追加单字符 `…`。最多显示三个已返回候选，ordinal 不重排，命令不裁减。按此规则生成的完整候选回复必须不超过 1,200 code points，并继续满足 transport 的 4,096 字符硬上限。

### 普通 preview

4. 普通 preview 使用以下行序；`区域` 仅在已知时显示，unknown 项汇总到一行：

   ```text
   Japan Atlas｜请确认

   餐厅：<名称>
   区域：<区域>
   地址：<地址或待补充>
   地图定位：已确认｜待补充
   Tabelog：<分数或未找到>
   预约：<摘要或未知>

   待补充：<逗号分隔字段>

   保存：/jpmap add confirm
   取消：/jpmap add cancel
   ```

5. 普通 preview 不显示 Place ID、原始经纬度、evidence 时间、license、provenance 枚举、内部 item ID、receipt、digest 或来源 URL。
6. 微信 preview 的显示值在 code-point 边界裁减并追加 `…`：名称 80、区域 40、地址 180、Tabelog 40、预约摘要 140、unknown 汇总 120。字段行和两条命令永不省略，但字段值允许按上述规则裁减。无 warning 的普通 preview 硬上限为 900 Unicode code points；带 warning／conflict 的 preview 硬上限为 1,200 code points；两者继续满足 transport 的 4,096 字符硬上限。
7. Tabelog 已知时只显示两位小数和可选 review count；预约已知时显示用户可理解的摘要，不能从预约状态推断 walk-in 或排队状态。

### 警告、冲突与成功

8. suspected duplicate、stale evidence 和 provider warning 不能被静默隐藏；合并后最多显示三条 `⚠️` 短警告，稳定优先级为：strong duplicate → `source_conflict` → `needs_review` → `provider_unavailable` → weak duplicate → `stale_evidence`。同级 duplicate 按 `itemId` 升序；warning code 只有一个 canonical message。未展示项统一折叠为“更多证据请在网页 Owner 预览查看”。每条显示文本最多 160 code points并以 `…` 标记裁减。
9. confirm-time conflict 固定以“资料有变化，本次尚未写入”开头，随后使用同一精简 preview，并显示：

   ```text
   同意新版：/jpmap add confirm
   取消：/jpmap add cancel
   ```

10. 三种成功状态使用闭合文案，不显示 receipt：
    - `committed_verified`：`Japan Atlas｜已保存并加入地图。`
    - `committed_needs_review`：`Japan Atlas｜已保存到 Owner 待审核；补全地址或定位后才会进入地图和 Nearby。`
    - `reused_existing`：`Japan Atlas｜已关联已有地点，没有重复建档。`
11. cancel 保持 `Japan Atlas｜本次 Add 已取消。`；failed-no-write 必须明确“没有写入”并提示重新查看 preview 或取消。

### 数据与渠道边界

12. `catalog.intake.*` 的结构化输出、持久 evidence、Web preview 和 provider contract 不因精简微信消息而删减或改变。
13. 精简逻辑只属于 Conversation／Channel Presenter；OpenClaw client 只转发服务端 bounded `replyText`，不得复制业务字段选择规则。
14. Web Owner preview 继续显示完整 evidence、来源、时间、license、坐标和重复项；本特性不修改 Web Add 表单或数据库 schema。

### User Manual

15. User Manual 至少覆盖：
    - 公开浏览与 Owner 登录后的写权限；
    - Web 的喜欢、去过、评分、评论、Visit、照片和 Add；
    - `/jpmap nearby <街区或地址>`；
    - `/jpmap add <店名 + 推荐的分店／街区／地址线索>`；
    - `select 1-3`、`confirm`、`cancel`；
    - 只有店名、多个候选、unknown、needs-review、expired/conflict 和暂时不可用时的处理；
    - 当前限制：精确命令不经过 DeepSeek，Tabelog／预约自动研究未上线，类别／推荐菜尚无正式 Add 字段，Record 尚未开放。
16. README 在正文前部链接 User Manual；文档不得包含密码、API key、HMAC、内部 endpoint 或真实账号标识。
17. 文档中的每条 `/jpmap` 示例都由 parser contract fixture 验证为有效或被明确标为无效示例。

### 移除 Creator Import

18. 顶部导航把 `Inbox` 改名为 `Review`；Review 页面保留 Add 产生的 Review Candidates 及其 loading、signed-out、error、empty 和 list 状态。
19. Review 页面不再出现 creator/profile 输入框、`Queue import`、Collector status 或 Import jobs；桌面和 390px 手机截图均不得残留这些文本或控件。
20. 运行时 contract 中不再存在 `import.list`、`import.queue`、`import.delete` 或 `queue_creator_import`：从 `AtlasApplication`、browser operation catalog、WebMCP capabilities、client/state 和 server composition 中删除。
21. `/api/inbox` 与 `/api/inbox/[id]` 不再作为应用 route 存在；不得另建隐藏或兼容入口绕过本次删除。
22. 当前泛化命名的 `ImportJob` 实现实际只承载 creator/profile 排队，且没有 collector；本特性明确从当前共享语言与产品架构中撤回它，并删除对应 domain／operation、D1 adapter、response mapper 及测试。`Acquisition & Review` 保留为未来截图／来源证据 proposal 的逻辑边界，但当前不包含持久后台采集队列；若未来确需异步任务，须用真实场景重新立项、命名和设计，不能复活旧 Creator API。
23. 既有 D1 migrations 和线上 `import_jobs` 表／历史数据保持不变；本特性不执行 drop、truncate、清理数据或重写已发布 migration。
24. Map、Journal、Nearby、Catalog Add 和 Review Candidate 的行为与权限模型保持不变。
25. 同步更新 `CONTEXT.md`、产品架构／决策和稳定文档：不再把 `ImportJob` 或 creator/profile 采集描述为当前能力；Catalog Intake 与 Review Candidates 成为当前唯一建档／审核路径。

### 个人评分不得覆盖外部评分

26. Owner 保存个人评分、喜欢、去过或总体评论时，只能修改 Personal Memory／assessment 字段；不得清空、替换或降级 Catalog 上的 Tabelog snapshot、预约、地址、坐标、标题、来源或 verification。
27. mutation 成功后的即时前端状态与重新加载后的持久状态必须一致：同一地点可以同时显示 `食べログ <外部评分>` 与 `マイ <个人评分>`；保存个人评分不能让任一入口中的 Tabelog badge 消失。
28. 回归测试必须从含已知 Tabelog snapshot 的地点开始，经网页实际使用的统一 assessment API 保存个人评分，并同时断言 API response、ViewModel state、Catalog read-back 都保留原 Tabelog；不得以仅重新 fetch 全目录掩盖错误的 mutation merge。

## Implementation Decisions

- 最高产品边界继续是 `AtlasApplication catalog.intake.*`；不新增第二套 Agent Add service。
- 审计级 `CatalogIntakePreviewPresentation` 继续服务 Web；新增微信专用 presenter，从同一个 `CatalogIntakePreview` 只读投影精简文本。
- presenter 通过闭合字段 allowlist 构造输出，不先生成审计长文本再做字符串截断。
- OpenClaw 保持薄 adapter：可信 sender 校验、确定性项目命令解析、HMAC transport、deadline 与 bounded reply。
- 本特性不调用 DeepSeek，不启用 Research Relay，不改变 durable geocoder，也不新增 Catalog 字段。
- Creator Import 是被删除的旁路；Catalog Intake Add 与 Review Candidates 仍是唯一餐厅建档／审核主链。
- 已发布 D1 schema 只向前兼容：允许遗留未使用表存在，不以破坏性 schema 清理换取代码整洁。
- 本增量显式修订产品架构：撤回当前 `ImportJob` 概念；`Acquisition & Review` 仅保留“外部线索先形成 proposal/evidence、不可直接发布”的边界，不承诺现有后台 job 或 collector。

## Message Design

- 延续现有 `Japan Atlas｜` 标题与中文命令提示，不引入另一套品牌语气。
- 手机优先：一个事实一行、空行分组、命令独立成行；不用 Markdown 表格，不把多个字段挤在同一段。
- `未知／未找到／待补充` 是明确状态，不使用“可能”“应该”等模糊词。
- 普通、警告、冲突、成功和失败五态都必须在 390px 宽的等价微信聊天容器截图中可扫描。
- Web 只做信息架构收缩：延续现有暖色编辑风格和组件，不重新设计；`Review` 页首屏直接呈现待审核餐厅，不再用已废弃的 acquisition hero 抢占空间。
- 截图沿用微信聊天容器的中性排版，不新建 Atlas Web 视觉系统；`DESIGN_VARIANCE=1`、`MOTION_INTENSITY=1`、`VISUAL_DENSITY=2`，无装饰动效。

## Testing Decisions

- 最高测试缝为 `ProjectCommandRouter` + fixture `CatalogIntakePreview`；同一 preview 继续通过 Web 审计 presenter 测试完整 evidence，同时通过微信 presenter 测试精简 allowlist。
- Presenter contract 精确断言字段、行序、空行、unknown、警告、命令、每字段显示上限和 900／1,200 code-point 硬上限；使用所有合法字段均达到 schema 最大长度的 fixture 证明字段行与命令仍完整存在。
- 负面断言微信普通回复不含 Place ID、坐标、license、内部 ID、receipt、digest、provenance 枚举和来源 URL。
- conflict contract 验证“零写入”文案、新版 confirm/cancel 命令和警告保留。
- 三种成功状态逐一精确断言；`failed_no_write` 和 cancel 单独断言。
- OpenClaw client contract 继续证明只接受 bounded signed reply，不在 host 重写 presenter。
- 文档测试读取 User Manual 中的命令代码块，通过同一 parser fixture 验证语法，并扫描 secret-shaped 内容。
- 实现与代码评审必须真实渲染 390×844px 等价微信聊天容器并保存截图证据，至少覆盖：三候选、完整普通 preview、四条以上警告的 conflict，以及 success 和 failed-no-write。harness 必须直接调用 production presenter 并逐字渲染其原始 `replyText`，不得手写场景文本、二次换行、删字段或用 scenario-specific CSS；全部场景只用同一套中性聊天容器样式。证据记录每个 reply 的 SHA-256、code-point 数、容器 `scrollWidth/clientWidth` 和截图路径；截图评审无水平溢出、无命令粘连、事实与 CTA 分组清晰才可通过。
- Web contract／render 测试覆盖 `Review` 导航和 Review Candidates 的五种状态，并负面断言 creator 表单、collector、Import jobs、`import.*` operation、WebMCP tool 与 `/api/inbox` route 均不存在。
- 真实 production React/CSS 浏览器门先以 Add `committed_needs_review` fixture 产生一条候选，再证明 Owner-only `Review` list 读回同一条，而 anonymous Public Read、Map 与 Nearby 均不可见；保存 desktop 与 390px list 截图，并至少保存 empty、error、signed-out 之一的真实状态截图。
- migration 安全门固定两层：① 校验已发布 migration manifest/checksum 未修改，并扫描本次差异／新 SQL，拒绝针对 `import_jobs` 的 `DROP`、`TRUNCATE`、`DELETE` 或 `UPDATE`；② 从含 sentinel `import_jobs` 行的升级前 D1 fixture 执行完整 migration packaging/build smoke，逐项比对表 schema、行数与 sentinel payload 不变。

## Out of Scope

- Durable geocoder 的 GSI 或其他 provider 生产化与 Google transient location 交叉核验。
- D-P06 仍为 Proposed 的 production Research Relay；在签名 allowance、Tunnel 身份、双栈 DNS/IP pin、redirect/rebinding、单次 egress、公网旁路负测、回退和真实单店 smoke 全部通过前继续保持 disabled/manual-unknown。
- DeepSeek 受限语义 proposal 与 prompt；精确 `/jpmap` 继续零模型。
- Web Tabelog／预约手填、类别、推荐菜和 Owner 备注 schema。
- Record 多段评论、图片和逐图评分；继续由既有 T-19/T-20 独立规格处理。
- 自动预约、付款、取消、对外发消息、多用户权限与公开写入。
- 删除或清理生产 D1 的遗留 `import_jobs` 表和历史数据。
- Screenshot-to-Add 的 operation、capability、route、schema、prompt 或图片处理代码；本轮只登记一条低优先级 backlog issue。

## Further Notes

- 后续建议拆为三个独立特性：
  1. **Stable Place Enrichment（最高优先级）**：把本次 Codex 临时完成的 Google identity → 日本 durable 地址／坐标 → 距离校验 → 正式 preview/confirm 编排纳入本仓库，并提供复用同一 operations 的 Owner Import Client，供 Codex 等受信操作 Agent 做逐条或批量 prepare；
  2. **Semantic Add Proposal**：显式 `jpmap` 项目路由后的 DeepSeek closed proposal，不自动 select/confirm；
  3. **Catalog Metadata**：类别、推荐菜与可见性明确的 Owner 备注 schema、migration、双入口读写。
- 另记低优先级后续 issue：**Screenshot-to-Add**。Owner 把网页／App 中的餐厅截图发给 Agent，Agent 先从图片和文字识别餐厅并提出可确认候选，再复用现有 `catalog.intake.*` 的 select → preview → confirm 主链；不得恢复 Creator Import，也不得跳过确认直接写入。
- Tabelog／预约自动研究只有在 D-P06 production 门独立通过后才进入实现；否则继续使用 manual/unknown 退化路径。
- 用户确认: 2026-09-24（Agent Add、User Manual、确定性优先／Agent 补全方向；Creator Import 删除作为本轮新增范围）
