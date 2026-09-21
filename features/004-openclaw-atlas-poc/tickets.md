# 任务票 — 004 OpenClaw × Japan Atlas PoC

- 用户确认：2026-09-13
- 执行范围：T-01–T-14 已授权实施；T-15 及后续 Record 票等待细节确认
- 执行方式：按独立文件所有权并行；每票由同一实现 Agent 完成红→绿，中央组合与部署由主任务汇合
- 测试接缝：`ProjectCommandRouter`、`AgentServiceGateway`、`NearbyRecommendation`、`CatalogIntakeCoordinator`、`VisitCaptureCoordinator/Publisher`

## 执行清单

- [x] T-01 `/jpmap nearby` 假数据行走骨架 — Blocked by: None — 以闭合命令、read-only manifest、AtlasApplication 假 provider 和微信文本回执贯穿最薄端到端路径，不暴露 write/destructive。
- [x] T-02 签名 Nearby 服务切片 — Blocked by: T-01 — 让 HMAC、owner/channel/scope、nonce、审计与稳定错误贯穿真实 Agent HTTP route；同 mutation digest 回放、冲突和脱敏可验证。
- [ ] T-03 Cloudflare 隔离只读环境与成本计量 — Blocked by: T-02 — 部署当前前端、Worker API、fixture D1/R2、Secrets 与 UsageCostMeter，不接 Sites 生产数据，保存可复现配置和预算报告。
- [ ] T-04 Lightsail canonical `/jpmap` native command — Blocked by: T-02, T-03 — 安装不注册模型工具的受限 plugin command，以 raw args 直达签名 Worker，保存实际版本、配置、sender/channel/from/to deny 证据和零模型调用 trace。
- [x] T-05 ProviderPolicyGateway 行走骨架与合规矩阵 — Blocked by: None — 以一个受控 provider 请求贯穿 origin/DNS/redirect/SSRF、字段许可、attribution、缓存、配额和 fail-closed；落盘 Google/Foursquare 字段与条款证据。
- [x] T-06 Google 地址解析与步行 Nearby — Blocked by: T-01, T-05 — 手动地址文字经三态解析、verified food 候选、现场步行路线与 15 分钟硬筛选返回最多五项，默认未到访优先。
- [ ] T-06A 真实目录坐标粗筛与 Route Matrix — Blocked by: T-06 — 将 repo seed 明确迁入 D1 或定义为 Catalog 内置记录；按持久坐标粗筛／Top-N，只对 shortlist 批量计算步行路线，步行层为空时才计算少量电车路线，并以调用次数、延迟和预算测试验收。
- [x] T-07 2 公里与直达电车 fallback — Blocked by: T-06 — 仅在步行层为空时返回 2 km 距离候选和门到门 ≤20:00、transit line 不切换的候选，缺证据明确降级。
- [x] T-08 EntryAccess 与 Nearby 完整回执 — Blocked by: T-05, T-06 — 最终候选逐项核验 walk-in/queue，预约事实不做推断，个人/外部评分、来源、时间、warning 与地图深链闭合呈现。
- [ ] T-09 真实微信只读 gate — Blocked by: T-04, T-07, T-08 — owner 微信在隔离数据上完成 `/jpmap nearby`；第二账号、群聊、伪造凭证和隐藏工具失败，日志与费用通过门限。
- [ ] T-10 微信稳定事件 ID 与 PreModelIngressRouter 探针 — Blocked by: T-09 — 证明跨重投 event ID/sequence 稳定，并验证 bare alias、防火墙、capture lookup、重启/断网 fail-closed；失败则所有 write gate 保持关闭。
- [ ] T-11 可选地点发现供应商决策门（Foursquare 实验暂停）— Blocked by: T-05 — 比较 Google Places、开放数据与用户确认数据的字段许可、持久化、地图兼容、价格和日本分店质量；Foursquare 已验证的 adapter 不进入 Nearby 或默认运行链路。
- [x] T-12 Catalog intake discovery 切片 — Blocked by: T-02, T-05 — 从名称／名称加可选街区／完整地址完成强键查重、受控来源补全、弱匹配提示、最多三候选、immutable evidence、preview version 与取消，不产生地点写入；先以 provider port/fixture 完成，不绑定 T-11 的具体供应商。
- [ ] T-13 Catalog confirm 原子发布与回执 — Blocked by: T-10, T-12 — 现场重读 evidence/revision，在单一 D1 transaction 完成 verified/needs_review、强键唯一约束和稳定 receipt；重投回放、异 payload 冲突。
- [ ] T-14 真实微信餐厅建档 gate — Blocked by: T-11, T-13 — 跑通“只发店名或完整地址→受控来源补全→分店消歧→预览→确认→地图可见”，覆盖复用已有、两类 committed、建档后 record 启动失败只重试启动。
- [ ] T-15 Record 语义与数据模型确认门 — Blocked by: T-09 — 与用户确认总体评分归属、逐图细分评分含义/量表/展示、输入店名别名与分店消歧、多段内容 inference；更新 spec/architecture 并独立评审。
- [ ] T-16 Record start、地点解析与权威 capture lookup — Blocked by: T-10, T-15 — 以明确 item 创建会话；名称不一致时只给候选并确认，Cloudflare D1 权威状态控制任何普通文字/图片能否进入模型。
- [ ] T-17 总体评分与评语草稿推断 — Blocked by: T-16 — 多段文字只生成可纠正候选，评分/地点冲突需澄清，顺序、配额、暂停和过期行为闭合。
- [ ] T-18 图片暂存、说明与逐图评分 — Blocked by: T-15, T-16 — 微信图片以 event ID 幂等进入 R2 staged 区，reply/序号绑定说明和细分评分；图片 bytes/缩略图/EXIF 不进模型。
- [ ] T-19 Record 控制命令与 immutable 预览 — Blocked by: T-17, T-18 — 完成 status/end/resume/cancel/confirm 状态表、preview version、纯照片约束、迟到事件与终态重放。
- [ ] T-20 VisitCapturePublisher 原子发布与恢复 — Blocked by: T-19 — 使用稳定 IDs、R2 stage/promote/verify 与单一 D1 batch，让 Visit/assessment/全部媒体/receipt 一次可见并支持 recovery/abandon/reconcile。
- [ ] T-21 真实微信 Record gate — Blocked by: T-14, T-20 — 完成多段文字、多图、预览确认、故障恢复和地图读取同一 Visit；重复、丢失、半可见与越权成功均为零。
- [ ] T-22 弱网、安全、七天 soak 与真实数据门 — Blocked by: T-21 — 完成弱网/重启/QR/成本/纯手机演练和独立安全评审；轮换已暴露 DeepSeek key 后才允许真实私人数据。

## 并行波次与汇合门

| 波次 | 可执行票 | 最大实现并发 | 汇合门 |
|---|---|---:|---|
| W0 | T-01、T-05 | 2 | 冻结 read-only 行走骨架、provider policy contract 与字段矩阵 |
| W1 | T-02、T-06；随后 T-07/T-08 | 2 | 主任务统一 composition；Nearby contract 与 provider fixtures 全绿 |
| W2 | T-03 | 1 | Cloudflare 隔离环境、fixture D1/R2 与 read-only Worker 通过 |
| W3 | T-04、T-12；T-11 可独立决策 | 2 | canonical direct dispatch 与 provider-neutral Catalog preview 独立完成 |
| W4 | T-09；随后 T-10、T-13 | 2 | Read gate 先通过；write ingress 与 Catalog confirm 汇合 |
| W5 | T-14、T-06A | 2 | Catalog 写入真实 E2E 与独立代码门通过 |
| W6 | T-15 | 1 | 用户确认 Record 增量规格/架构并通过独立评审后才解锁后续票 |
| W7+ | T-16–T-22 | 待 T-15 重排 | 本轮不提前实施 |

- 并行作者不修改中央 `atlas-application.ts`、server composition、共享 migration journal 或同一 provider policy 文件；主任务负责每波次汇合。
- 需要改变已冻结公开接缝时停止该波次，回到接缝 owner 串行修订并独立复审。
- 第一、第二阶段可自动推进到 T-14；不部署生产 reset，不接生产 D1/R2，不改变站点 audience，不把 secret/私人内容写入 Git、日志或模型。
- Cloudflare/AWS 外部配置只使用隔离资源；任何会产生计划外费用、改变真实数据或需要新账户授权的动作保持为显式 gate。
