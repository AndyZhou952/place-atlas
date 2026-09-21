# 004 OpenClaw × Japan Atlas PoC 架构评审（第 2 轮）

- 日期: 2026-09-13
- 评审方式: subagent
- 结论: 通过（PASS）

## 发现项

- 无严重、一般或建议发现。

## 上一轮发现关闭核对

### 严重

- 已关闭跨主机 capture 状态问题：`architecture.md:29-34` 将 D1 定为 session 权威源，并增加签名 `CaptureRouteLookup`。只有明确 `none` 才能进入普通助手；超时、stale、歧义及网络错误均固定失败关闭，不进模型、不改草稿。短期缓存、状态转移失效、重启／竞态／断网真实链路测试均有落点。
- 已关闭 Visit＋媒体原子可见性问题：`architecture.md:15-16,39-43` 增加 `VisitCapturePublisher.publish`、composite `CaptureStatePort` 与 `StagedMediaPort`。R2 stage/promote/verify 明确位于 D1 事务外，只有全部 live object 通过 hash/size 核验后，单一 D1 transactional `batch()` 才同时发布 Visit、assessment、全部 media metadata、capture state 与最终 receipt；`recovery_required`、response-lost、24 小时 abandon、orphan reconciliation 和全边界故障矩阵均已覆盖。该路径不再假设现有独立 `visit.create`／`media.attach` 可以拼成原子提交。
- 已关闭模型图片隐私问题：`architecture.md:65` 只允许 DeepSeek 接收批准的最少文字和不可还原附件元数据，明确禁止图片 bytes、缩略图与 EXIF，已与 `spec.md:142,182` 对齐。

### 一般

- 已关闭 coordinator 过宽与测试缝错位：`architecture.md:15-24` 分离 `CatalogIntakeCoordinator`、`VisitCaptureCoordinator` 和 `VisitCapturePublisher`，保留单向依赖，Catalog 独占 verified/abstain，两个 coordinator 只能经 `AtlasApplication` 调用产品能力；规格五个高层测试缝已有一一映射。
- 已关闭 Agent 工具面混用风险：`architecture.md:13,36-39` 将 `AgentToolCatalog` 定为唯一 Agent manifest 投影，明确不复用现有 browser capability 清单；read/write 阶段、effect/scope/confirmation/retry、destructive/maintenance/reset/底层写操作默认拒绝及隐藏 key 负面 contract tests 均已冻结。
- 已关闭 HMAC 与幂等重试冲突：`architecture.md:40-43` 明确 canonical bytes、常量时间比较、五分钟窗口、`(projectId,keyId,nonce)` 唯一与保留期；传输重试使用新 nonce＋同 mutation ID，业务层以 canonical payload digest 回放 receipt／拒绝冲突。两端 secret 存放、D1 metadata、overlap 轮换、撤销与时钟漂移测试均已定义。
- 已关闭“无换乘”供应商偏好误判：`architecture.md:52` 要求 Transit adapter 从 legs/steps 计算总门到门时间、boarding/line identity 和 transfer count，只接受 `≤20:00` 且 line 不切换，不信任 `FEWER_TRANSFERS`；20:00/20:01、换乘和缺字段 fixtures 均有覆盖。
- 已关闭 Google/Foursquare/Leaflet 合规缺口：`architecture.md:51,53,56` 禁止 Google 地址、坐标和 geometry 进入 Leaflet 或持久层，规定就近“Google Maps” attribution 与公开 ToS/Privacy；Foursquare 持久化必须由实际 API agreement／逐字段证据支持，不能从 Places OS 同名字段推定，rating 未获许可保持 unknown。统一 policy gate 继续覆盖 credential、origin、redirect/DNS/SSRF、字段矩阵和条款 contract tests。
- 已关闭 60 美元成本门不可验收问题：`architecture.md:66-68` 增加 `UsageCostMeter`，统一归集固定与变动成本、用真实账单／usage 校准 projection、设置总额硬门与 buffer，并为各 provider 设置 warn/hard quota；超限只降级为 unknown/dependency warning，不会自动升级付费层，read/write/soak 前均保存预算报告。

## 新问题检查

- 修订后的 `CaptureRouteLookup`、`AgentToolCatalog`、两个 coordinator、`VisitCapturePublisher` 和 provider ports 仍遵守 `Channel → Conversation/Application Operations → Domain → Ports ← Adapters` 的无环方向，没有把 OpenClaw、Cloudflare、Google、Foursquare 或 DeepSeek SDK 引入 Product Core。
- Catalog intake 的 strong/weak identity、immutable evidence/revision、verified/abstain 所有权继续落在 Catalog 路径；Visit capture 的 session/event ordering、预览确认、媒体 staging/publish 与回执恢复落在独立路径，没有重新合并成巨型 coordinator。
- R2 对象先幂等 promote、后由私有 D1 metadata 原子发布可见性的顺序，与私有 bucket 和现有 `media.open` 先查 metadata 的读取边界兼容；promote 失败、D1 回滚及遗留对象均有明确不可见和 reconciliation 结果。
- deterministic routing 保持 canonical slash direct-dispatch 与 capability-gated pre-model 路径分离；普通模型无项目凭证，lookup 不确定时也不会退回模型，项目 tool/scope/state namespace 仍隔离。
- `EntryAccess` 继续使用 walk-in/queue 独立 assertion 和 unknown-first；Google/Foursquare 的 reservable/reservations 不会被推导为 walk-in 或排队事实。
- Cloudflare 数据平面与 Lightsail runtime 分离，Agent host 可独立迁往 Hetzner/OCI；D1/R2 仍在 ports 后，没有引入阻碍后续存储 adapter 替换的新核心依赖。

## 结论说明

上一轮 3 项严重和 6 项一般发现均已关闭，修订未引入新的严重、一般或建议问题。当前架构已覆盖规格要求的模块接缝、确定性路由、鉴权与重放、Catalog/Visit 流程、D1/R2 可见性、供应商合规、EntryAccess unknown-first、部署可迁移性和成本门，可以进入 `hf-to-tickets`。
