# Japan Atlas 产品架构

- 日期：2026-09-12
- 状态：已确认
- 用户确认：2026-09-12

本文件是仓库级架构地图，约束后续特性架构；共享语言见 [`CONTEXT.md`](../CONTEXT.md)，实现细节见 [`docs/architecture.md`](../docs/architecture.md)。

## 1. 架构特征

| 特征 | 可测质量属性场景 |
|---|---|
| 框架无关的可演进性 | 新增第二种渠道、Agent runtime 或存储 adapter 时，只新增/替换接缝外实现，产品核心不导入其 SDK；度量：核心改动文件为 0，全部 operation contract tests 通过。 |
| 可信与可追溯 | 连接器或模型提交含糊、冲突的第三方内容时，系统自动确认或 abstain 并保留证据；度量：自动确认精确分店 precision ≥90%（目标 95%）、Top-3 recall ≥95%、provenance 完整率 100%。 |
| 写入可靠与可恢复 | 渠道重复投递、存储局部失败或用户误删时，系统去重、给出可审计结果并允许恢复；度量：重复/半写入为 0，普通删除 30 天内可恢复，失败批次不复制成功媒体。 |
| 私密且最小授权 | 未授权主体、提示注入或未确认的破坏性/外部动作到达任意入口时，系统拒绝且不泄露私密内容；度量：权限负面测试 100% 通过，日志与长期存储满足既定保留期限。 |
| 旅行场景可用性 | 用户在手机和弱网中查询、记录或追加照片时，界面先响应并最终给出同步结果；度量：可见乐观更新 p95 ≤100 ms；在 RTT 800 ms、10% 请求失败的弱网 fixture 下，成功写入 30 秒内收到回执，超时 5 秒内显示待重试，网络恢复后 60 秒内收敛且重复写入为 0。 |

## 2. 原则与风格

- 采用**模块化单体 + Ports & Adapters**；模块化单体描述代码与领域形态，当前 Web 常驻核心保持一个仓库和部署单元，见 [`D-002、D-004、D-016`](../docs/decisions.md)。
- Product Core 提供小而稳定的深接口，隐藏业务不变量、幂等、恢复和编排；渠道、模型、采集器、地图及存储只能作为 adapter 接入。
- 依赖方向固定为 `Channel/UI → Application Operations → Domain Modules → Ports ← Infrastructure Adapters`；核心不得导入 React、route、D1/R2 或 harness SDK。
- Web 使用 MVVM：`View → ViewModel → Browser Adapter`；View 不直接持久化，也不复制业务状态，见 [`D-003`](../docs/decisions.md)。
- 高权限本地 connector 必须在独立短时进程、浏览器 profile 与信任区运行，只以窄接口向 Web 核心交付版本化证据；是否再拆分云端常驻模块仍由 `D-P02` 的实验证据决定。
- 不为尚无第二实现或量化证据的变化预建接缝；存储拆分、微服务和地图换代均推迟到复核触发命中。

## 3. 按易变性划分的逻辑模块

| 模块 | 职责 | 封装的变化 |
|---|---|---|
| Application Operations | 作为所有入口的唯一产品接口，执行授权后的业务编排并返回一致结果 | 操作流程、幂等/回执策略、跨模块协调方式 |
| Atlas Catalog | 维护 Atlas 条目的规范身份、可信状态、来源断言与时效事实；独占 verified/abstain 与发布决策 | 地点类型、发布证据标准、来源及预约/活动新鲜度规则 |
| Personal Memory | 维护地点评价、Visit、VisitMedia、有效到访状态与回收站生命周期 | 个人记忆不变量、媒体归属、恢复和保留策略 |
| Decision Support | 执行搜索、nearby、硬条件筛选与后续推荐 | 搜索匹配、地理实现、候选排序与解释策略 |
| Acquisition & Review | 把 ImportJob 经连接器、提取和实体解析转为 Evidence Manifest 与 Review Candidate，不发布可信条目 | 社交平台、浏览器自动化、OCR/ASR/模型与候选生成规则 |
| Conversation Coordination | 把渠道消息、Agent runtime 与短时 capture session 映射到应用操作 | 微信协议、harness、对话状态、附件到 Visit 的关联策略 |

允许的 context map（箭头只表示代码依赖；未列出的模块间依赖均禁止）：

```text
Web/UI adapter ──同步──> Application Operations ──同步──> Catalog / Personal Memory / Decision Support
Channel adapter ──消息──> Conversation Coordination ──同步──> Application Operations
Application Operations ──同步启动/读取结果──> Acquisition & Review
Infrastructure adapters ──实现 ports──> Product Core
```

数据交接为 `Acquisition → Evidence Manifest / Review Candidate → Application Operations → Atlas Catalog`；Atlas Catalog 独占 verified、abstain 与发布决策。Application Operations 是唯一跨模块协调者；领域模块不得互调或反向依赖入口，Conversation 只解释渠道上下文。依赖图必须无环。来源媒体与私人 VisitMedia 不跨用同一生命周期。

## 4. 开发视图

```text
product/                         产品架构、假设、进度与特性工件
apps/web/product/                框架无关模块、Application Operations 与 ports
apps/web/adapters/               D1/R2、HTTP、WebMCP、采集器、模型、地图等 adapters
apps/web/features/atlas/         Web View、ViewModel 与浏览器交互
apps/web/app/                    route 与组合根；只解析请求、装配依赖和映射响应
apps/web/tests/{contract,e2e}/   跨 adapter 契约与关键场景测试
docs/                            稳定产品说明、路线图与已接受决策
```

- 新业务规则进入所属产品模块；新供应商/框架代码进入 adapter；跨入口契约只在 Application Operations 定义一次。
- 产品模块测试与源码相邻；跨模块行为走 contract tests，用户可感知流程走 E2E。旧代码按行为保持式垂直切片迁移，不做一次性重写。

## 5. 关键场景

1. **来源到地图**：用户发起导入 → Acquisition 保存 Evidence Manifest 并产出 Review Candidate → Application Operations 交给 Catalog → Catalog 独占自动发布、abstain 或提交人工审核的决定 → 可信条目出现在所有入口。【可信与可追溯、框架无关、私密】
2. **附近决策**：渠道提交位置与条件 → Conversation 转成交互意图 → Application Operations 调用 Decision Support 执行硬筛选与可替换排序 → 返回少量候选及未知/过期提示。【旅行可用、框架无关】
3. **对话到访**：用户发送评分、笔记及连续照片 → Conversation 确认明确地点/会话 → Application Operations 调用 Personal Memory 写入一次 Visit → 地图读取同一结果；重复消息不重复写入。【写入可靠、私密、旅行可用】
4. **删除与恢复**：任意入口确认普通删除 → Application Operations 调用所属模块进入回收站 → 30 天内恢复或到期清理 D1/R2；显式永久删除再次确认并即时清理主存储。【写入可靠、私密】
5. **更换入口或实现**：同一应用操作经测试 adapter、WebMCP 和未来微信执行，或由替代存储/模型实现承接，结果满足同一契约。【框架无关、写入可靠】

## 6. 横切约定与决策

- 所有外部输入先按版本化 schema 校验；网页、OCR、模型输出和文件元数据均不可信。错误映射稳定且不暴露内部或私密数据。
- 所有 mutation 携带身份与稳定操作标识，执行权限检查、原子写入/补偿、结构化审计并返回可重放结果；删除及预约、付款、取消、对外消息需明确确认，见 [`D-008`](../docs/decisions.md)。
- `有效行った = 存在 Visit OR manualVisited`；评分、Visit 与媒体保持分离，见 [`D-005、D-009、D-012`](../docs/decisions.md)。
- 普通删除、日志、附件、第三方原始媒体和私人 Journal 遵守 [`D-017、D-018`](../docs/decisions.md)；云模型处理遵守 [`D-019`](../docs/decisions.md)。
- migration 不可修改；时间统一持久化为明确时区的机器值并在规则层使用 JST；日志只记录结构化标识、结果、耗时和错误类别。
- OpenClaw、云端常驻拓扑及 host/region 仍是待证据确认的 adapter/部署选择，见 [`D-P01、D-P02`](../docs/decisions.md)。

## 7. 演进路径与复核触发

1. 先从现有 Web 垂直切片抽取 Application Operations 与测试 adapter，保持地点、个人状态、Visit、媒体、ImportJob、搜索和 nearby 行为。
2. 再补齐媒体恢复、统一幂等/审计/授权；随后分别接入采集审核、推荐、对话采集和候选 Agent runtime。
3. 微信 PoC 通过后才选择 24/7 host/region；最后完成备份恢复、七天 soak 和纯手机旅行演练。
4. 任一触发命中即重开产品架构：可信条目 ≥10,000 或地理查询 p95 ≥500 ms；后台操作 p95 ≥2.5 s 且影响 Agent 运维；出现第二个独立发布团队或两个必须独立伸缩/故障隔离的常驻工作负载；移动地图 fixture 条件下稳定 p95 ≥400 ms 或帧间隔 p95 ≥50 ms；连续两次保留/恢复审计失败。
5. 所有 p95 触发使用同一版本化测量协议：固定设备/数据/网络 fixture，预热后至少 100 个完成样本；生产观测采用滚动七天且至少 100 个样本。阈值连续两个窗口超标才触发，协议版本变化须经架构评审。

## 8. 适应度函数

| 保护对象 | 校验方式 | 频率 |
|---|---|---|
| 依赖方向与框架无关 | CI 禁止 product core 导入 UI、delivery、D1/R2 与 harness SDK | 每次 CI |
| Application Operations 契约 | 同一 contract suite 运行于测试及生产 adapters；operation catalog 只生成一次 | 每次 CI |
| 幂等、权限与恢复 | 重复/冲突、越权、局部失败、删除/恢复的负面与故障注入测试 | 每次 CI |
| 可信与 provenance | 固定校准集报告 precision、recall、abstention 与 provenance 完整率 | 每次 connector/模型版本 |
| 旅行性能与运维 | 按版本化测量协议自动验证弱网最终收敛、乐观更新与地图预算；保留审计每日运行，发布前执行恢复演练、弱网/纯手机演练与七天 soak | CI、每日与每次发布 |
| 模块局部性 | 新需求应有唯一代码归属，典型变化不跨越超过两个产品模块 | 每次 hf-review |
