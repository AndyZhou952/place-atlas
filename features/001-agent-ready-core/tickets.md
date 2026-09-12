# 任务票 — 001 Agent-ready Application Core

- 用户确认：2026-09-12

## 执行清单

- [x] T-01 ImportJob 行走骨架 — Blocked by: None — 建立类型化 AtlasApplication、静态 operation catalog、闭合错误、内存/D1 adapter，并让 ImportJob list 贯穿 HTTP。
- [x] T-02 ImportJob 写入切片 — Blocked by: T-01 — 迁移 queue/delete、平台推断、Clock/IdSource，并收缩 Inbox routes。
- [x] T-03 Catalog、Search 与 Nearby 读取切片 — Blocked by: T-01 — 迁移条目合并、search 和两种 nearby profile，并收缩 Items/Nearby GET。
- [x] T-04 Catalog 非破坏性写入切片 — Blocked by: T-03 — 迁移 needs_review 保存与标题/描述/personalState override。
- [x] T-05 PlaceAssessment 与 D-009 切片 — Blocked by: T-03 — 迁移评分、喜欢、manualVisited、summary，并统一有效到访状态。
- [x] T-06 Visit 读取、创建与编辑切片 — Blocked by: T-05 — 迁移 Visit list/create/update、评分副作用、重投语义与 D1 unit-of-work。
- [x] T-07 Media 读取与流切片 — Blocked by: T-01 — 迁移 media list/openMedia、可移植流 envelope 与内容 route。
- [x] T-08 Media 写入切片 — Blocked by: T-07 — 迁移 attach/caption/single-delete，并保持当前 D1/R2 补偿与 orphan 语义。
- [x] T-09 Visit/AtlasItem 破坏性流程 — Blocked by: T-04, T-05, T-06, T-08 — 迁移两类级联删除、tombstone、到访重算与 best-effort R2 清理。
- [x] T-10 Browser Adapter 与 ViewModel 收缩 — Blocked by: T-02, T-03, T-04, T-05, T-06, T-07, T-08, T-09 — Web 改用 Browser AtlasApplication adapter，保留乐观更新与回滚。
- [x] T-11 WebMCP 与 capabilities 收缩 — Blocked by: T-10 — 从同一 adapter mapping 生成能力清单，持久操作不再读取 ViewModel cache。
- [x] T-12 Reset migration 与维护工具 — Blocked by: T-05, T-09, T-11 — 新增封闭四字段 reset、D1/R2 快照验证和维护/回退 runbook；不执行生产 reset。
- [x] T-13 最终收缩与架构适应度门 — Blocked by: T-02, T-03, T-04, T-05, T-06, T-07, T-08, T-09, T-10, T-11, T-12 — 删除旧 writer/重复实现，加入依赖与 catalog 检查并通过完整 CI。
- [ ] T-14 生产维护切换 — Blocked by: T-13 — 在独立代码门通过且用户批准窗口后，冻结写入、备份、reset、部署、对账、smoke 和恢复写入。

## 每票 TDD 验收

| 票 | Red → Green 的外部行为 | 主要所有权 |
|---|---|---|
| T-01 | 类型化 key/input/output 与 JSON/media key 负面编译测试先失败；随后 ImportJob list 在 InMemory/D1 与原 HTTP JSON 上一致，四类错误穷尽且脱敏；只建立 `defineOperationGroup` 静态组合机制，不预建其他领域 operation/port | 新 `product/application` 最小机制、Import group/port、adapters/composition、Inbox GET |
| T-02 | queued 初态、排序、平台推断、删除不存在项及 dependency failure 先失败；随后 Application、D1、HTTP 契约一致且不增加 worker | Import module/adapter、Inbox POST/DELETE |
| T-03 | 合并/tombstone/malformed；Search 的 NFKC、大小写、标点、多词 AND、字段/标签部分匹配、bigram 与空查询；Nearby 的经纬度、HTTP limit 1–20/默认值及现有稳定等距顺序先失败；随后 `verified_catalog` 只含可信条目，`full_merged_catalog` 含 needs_review 且忽略所有 UI filters | Catalog/Decision read、Items GET、Nearby GET |
| T-04 | 非法 verified 发布、override 合并、not_found 与刷新恢复先失败；随后采集结果只能写为 needs_review，route 只做协议映射 | Catalog write、Items POST/PATCH |
| T-05 | 评分 0/5/任意小数、四状态独立性与 `manualVisited × Visit count` 真值表先失败；随后所有读写返回 `Visit exists OR manualVisited` | Assessment handler/adapter、personal route |
| T-06 | 最低内容、评分/笔记清除、同 ID 同/异 payload、副作用、原子失败及两次 D1 往返预算先失败；随后保持现有无 conflict/replay 行为 | Visit handler/adapter、Journal GET/POST/PATCH |
| T-07 | 按 Visit／地点过滤和既有顺序、metadata/object 缺失、单次消费、取消、脱敏流失败与响应头先失败；随后 `media.open` 只能走 openMedia，URL/类型/长度/ETag 兼容 | Media read、D1/R2 read adapters、GET/content routes |
| T-08 | JPEG/PNG/WebP/GIF MIME+签名、8 MB、说明、R2 put/D1 metadata 失败、single-delete orphan 和 HTTP 每请求最多 4 张先失败；混合合法/非法批次只锁定当前 allSettled+best-effort cleanup，不强化为全批预校验；随后 filename/hash/order/content URL 与当前错误语义保持 | Media write、media routes；不做 retry/reconcile |
| T-09 | D1 原子失败、最后 Visit 真值、R2 删除失败与 tombstone 可见性先失败；随后单媒体删除失败返回 dependency failure，而 Visit/Item 删除在 best-effort R2 失败时仍成功 | destructive orchestration、Journal/Item DELETE |
| T-10 | fake transport、乐观成功/失败收敛、Browser 一次选择最多 24 张并按每批 4 张上传、完成批次即时进入状态先失败；随后 ViewModel 不计算服务端业务规则，现有 UI 无可感知变化 | atlas-api-client、use-atlas-view-model；不改视觉/地图 |
| T-11 | 工具名/schema/annotation、mapping、`full_merged_catalog` 含 verified/needs_review、忽略 UI filters、按距离返回前五与 UI-only focus 先失败；随后 capabilities/WebMCP 共用映射且不以 cache 为事实源 | use-atlas-webmcp、capabilities route |
| T-12 | 全 D1 表与 R2 key manifest 快照先证明旧方案不安全；随后仅 `overall_rating/is_favorite/has_visited/summary` 可变、时间戳和其余数据不变，重复 migration 幂等，Visit 仍推导行った | 单一 migration owner、migration tests、runbook |
| T-13 | import/依赖/cycle/catalog 检查先捕获受控违规；随后 route→legacy store 直连、第二业务实现和第二能力清单均为零，format/lint/typecheck/test/build 全绿 | 单一收缩 owner、CI/fitness tests |
| T-14 | 在生产快照副本完成一次完整演练；正式窗口只有白名单字段变化，R2 manifest 不变，读写 smoke 通过；失败时保持冻结并恢复 D1 快照/旧版本 | 主 Agent 编排，用户掌握 go/no-go |

每张实现票由同一 Agent 完成测试失败、最小实现、测试通过与重构，不把测试和实现拆给不同 Agent。票内发现规格外行为差异时必须停止并回报，不能顺手选择。

## 并行波次

| 波次 | 可执行票 | 有用并发 | 合并门 |
|---|---|---:|---|
| W1 | T-01 | 1 | 只冻结 AtlasApplication 调用形态、Result、descriptor/`defineOperationGroup` 约定；Import group 行走骨架与独立 seam review 通过 |
| W2 | T-02、T-03、T-07 | 最多 3 | 各票只新增领域自有 group/ports；完成后由单一集成 owner 更新静态聚合并运行全库 typecheck/build |
| W3 | T-04、T-05、T-08 | 最多 3 | 各票只扩展领域自有 group；单一集成 owner 汇总后 Catalog/Assessment/Media contract 与完整 CI 通过 |
| W4 | T-06 | 1 | Visit 重投、真值表、D1 原子性与往返预算通过 |
| W5 | T-09 | 1 | 所有破坏性流程的 D1/R2 现状语义被 characterization 锁定 |
| W6 | T-10 → T-11 | 1 | Browser 后再迁移 WebMCP；UI smoke 与工具快照通过 |
| W7 | T-12、T-13 | 先后各 1 | migration 只生成/测试不执行；最终完整 CI 与独立代码评审通过 |
| W8 | T-14 | 主 Agent + 用户 | 仅在用户批准维护窗口后执行 |

总并发上限为主 Agent 加 3 个 Subagent；本特性只有 W2/W3 适合三个实现者并行。其他波次保持单 owner，评审 Agent 不修改代码。

## 文件冲突与冻结规则

- T-01 后只冻结 AtlasApplication 调用形态、Result/错误集合、descriptor 与 `defineOperationGroup` 静态组合约定；不预建或冻结尚未验证的领域 map/port。
- 各领域 operation map、descriptor 与 record port 留在领域自有文件做加法扩展；并行作者不得修改中央静态聚合或 composition root。每个波次完成后指定一个非并行集成 owner，以显式 import 汇总已通过的领域 group 并运行全量 contract。禁止 runtime registration。
- 若下游票必须改变已冻结机制，全波停止并回到 T-01 串行修订与复审；不能由某个并行作者顺手扩展。
- 同一波次不得同时修改 `atlas-store.ts`、`media-store.ts`、`model.ts`、`use-atlas-view-model.ts`、`use-atlas-webmcp.ts`、`db/schema.ts` 或 migration journal/meta。
- W2/W3 的并行票只写各自的新领域目录、adapter、route 与测试；旧 store 的最终删除由 T-13 单一 owner 处理。
- Subagent 不切换分支、不提交、不运行全仓写格式化；主 Agent 在每个 wave gate 统一集成、格式化、测试与提交。
- APP-02 鉴权/receipt/通用幂等、30 天 Trash、媒体加固、Agent/微信、推荐和新 UI 全部禁止进入这些票。

## T-14 人工维护门

T-12 只准备并验证 migration，不会触碰生产数据。T-14 的机器依赖只有 T-13；执行前还必须满足独立 `hf-review` 代码门通过，并再次获得用户对具体时间的批准，然后按以下顺序执行：

1. 暂停所有个人状态、Visit、媒体、条目、Inbox 与 WebMCP 写入，排空旧请求。
2. 导出并验证完整 D1 snapshot，保存 R2 object-key manifest，在副本上再次演练。
3. 执行幂等四字段 reset，切换新 writer，运行只读 smoke 与全量对账。
4. 使用用户认可的一次真实操作做写入 smoke；若不希望写生产状态，则只在 staging 做 mutation smoke。
5. 成功后恢复写入；失败则继续冻结、恢复旧版本与 D1 snapshot，复验后才开放。

写入重新开放后不得恢复旧 snapshot，以免覆盖新的个人数据。
