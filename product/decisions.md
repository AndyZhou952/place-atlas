# 决策记录

这里只记录 Harness Flow 阶段确认；完整产品与技术决策以 [`docs/decisions.md`](../docs/decisions.md) 为准。

- D-1 2026-09-11 Japan Atlas 保持私有、单用户、Agent-first 与 map-first — 依据：已合并产品基线 D-001。
- D-2 2026-09-11 所有渠道使用同一框架无关产品核心，Web 保持 MVVM 边界 — 依据：已合并决策 D-002/D-003。
- D-3 2026-09-11 D1/R2 是 v1 存储基线，达到量化触发条件后才重审 — 依据：已合并决策 D-004。
- D-4 2026-09-11 Harness Flow 使用 interactive 模式；规格、架构、代码评审和演示验收等待用户确认 — 依据：用户要求先完成边界定义再实施。
- D-5 2026-09-12 当前采用模块化单体与 Ports & Adapters，不立即拆独立服务；只有量化复核触发命中才重开部署划分。
- D-6 2026-09-12 `[已部分取代]` 首个正式特性采用行为保持式迁移；其中 ImportJob／creator collector 部分已由 D-12 取代，其余地点、个人状态、Visit、媒体、搜索与 nearby 边界继续有效。
- D-7 2026-09-12 `有效行った = 存在 Visit OR manualVisited`；真实 Visit 不得被人工“没去过”覆盖，删除最后一条 Visit 后只在既有 `manualVisited=true` 时保留。
- D-8 2026-09-12 普通删除统一进入 30 天回收站；永久删除需显式确认，主存储立即清理，备份按既定周期淘汰。
- D-9 2026-09-12 数据保留：未分配附件 24 小时、第三方原始媒体最多 72 小时、原始聊天正文 7 天、结构化审计 180 天；私人 Journal 保存至用户删除，必要的来源证据可长期私有保存。
- D-10 2026-09-12 可使用不训练且受限保留的云模型处理批准的数据；上传前剥离 EXIF 与凭证，日志仅保存结构化结果，未来可按证据增加本地处理选项。
- D-11 2026-09-12 `/api/nearby` 缺少 `lat` 或 `lon` 时不再沿用旧实现把缺失值意外转换为 `0` 的行为，统一返回 HTTP 400 `invalid_input` — 用户确认将旧行为视为缺陷；依据：D-016 补充。
- D-12 2026-09-24 当前新增地点统一使用 Catalog Intake 的 discover → select → preview → confirm，并按证据进入 Verified Item 或 Review Candidate；撤销 creator ImportJob UI、route 与领域 capability。Acquisition & Review 只保留未来 proposal 边界，遗留 `import_jobs` 物理表仅为 migration 兼容，不代表运行时能力。
