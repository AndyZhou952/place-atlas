# Acquisition Proposal、证据与评测边界

状态：未来提案边界（不是当前 capability）
最后更新：2026-09-24

## 1. 当前产品路径

当前新增地点只走 `Catalog Intake → Preview/Confirm → Verified Item 或 Review Candidate`。网页和 Agent 使用同一套 application operations；系统没有 creator ImportJob、批量 discovery、登录浏览器 collector 或后台导入队列。

Review Candidate 是当前 Owner 审核边界：证据不足或冲突的地点可以保留供核验，但不能进入公开地图或 Nearby。遗留 `import_jobs` 物理表只为 migration 兼容存在，不构成可调用能力。

## 2. Acquisition & Review 为什么仍保留

Acquisition & Review 是产品架构中的 **proposal-only** 边界。未来只有出现经过用户确认的新来源需求时，才可以立项一个可替换 adapter，把外部线索转换为版本化 Evidence Manifest 和 Review Candidate。它不能直接创建 Verified Item，不能绕过 Owner 确认，也不能取得 Catalog／D1 写权限。

任何新提案必须先回答：

- 输入类型和用户授权范围是什么；
- 原始内容是否允许读取、暂存与长期保留；
- 如何保存 URL、核验时间、证据位置、提取方法和版本；
- 如何限制预算、速率、重试、凭证和网络访问；
- 如何校准精确分店的 precision、Top-3 recall 与正确 abstention；
- 如何在失败时保持无写入、可观察并可人工恢复。

没有独立规格、威胁模型、provider policy、评测 fixture 和确认门时，不实现来源 adapter。

## 3. Evidence Manifest 最小原则

未来 adapter 的输出必须是闭合、版本化、可验证的 evidence DTO，而不是数据库行或模型自由文本。派生结论必须能回指来源 URL、文本位置、时间戳或其他允许保留的证据；模型摘要不能替代原始证据定位。

第三方内容默认只长期保存必要的 URL、hash、核验时间和最小派生观察。完整网页、评论、图片、音视频和账号凭证不得因“研究方便”进入长期存储。所有网页、OCR、文件名和模型输出均按不可信输入处理。

## 4. 身份与事实评测

地点身份和时效事实分开评测：

| 指标 | 初始目标 |
|---|---:|
| 自动确认精确分店 precision | ≥ 90%，目标 95% |
| Top-3 candidate recall | ≥ 95%（可判定样本） |
| 正确 abstention | ≥ 95% |
| 身份／外部事实 provenance 完整率 | 100% |

Tabelog、预约、walk-in、排队与活动信息是带来源和时间的 claim，不是永久事实。官方来源优先；没有可靠证据时必须保持 unknown。模型自报 confidence 不是校准概率，也不能单独支持发布。

Runtime 评测与领域评测分开：渠道重投、超时、重启、权限和恢复属于 Runtime；实体匹配、来源事实和 abstention 属于领域质量。更换 OpenClaw 或模型不会自动改善证据质量。

## 5. 当前明确不做

- 不恢复 creator/profile import 表单、ImportJob API 或 collector worker；
- 不允许任意网页抓取、登录 Cookie 上云或 connector 直写数据库；
- 不把模型猜测当作地址、评分、预约或排队事实；
- 不在本特性实现 Screenshot-to-Add。

`Screenshot-to-Add` 只记录为路线图中的低优先级 `FUTURE-01`，前置 Stable Place Enrichment。未来若立项，它只能提出候选并复用 Catalog Intake 的 select → preview → confirm，不能直接发布地点。
