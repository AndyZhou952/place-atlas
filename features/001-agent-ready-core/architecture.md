# 架构 — 001 Agent-ready Application Core

- 日期：2026-09-12
- 对应规格：[`spec.md`](spec.md)
- 状态：已确认
- 用户确认：2026-09-12

## 对齐产品架构

本片落实已确认的 [`product/architecture.md`](../../product/architecture.md) 中 Application Operations 的外部 seam，触及 Atlas Catalog、Personal Memory、Decision Support 与 Acquisition 的现有 ImportJob 行为；不引入 Conversation Coordination。它验证“更换入口或实现”场景，保持模块化单体、Ports & Adapters 与 Web MVVM；业务例外仅限 [`spec.md`](spec.md) 已确认的 D-009 有效到访状态，以及 `/api/nearby` 缺少坐标时不再把缺失值解释为 `0`、而是返回 HTTP 400 `invalid_input`。

## 本片模块与缝

```ts
type OperationMap = CatalogOperations & PersonalMemoryOperations &
  MediaOperations & ImportOperations & DecisionOperations;
type JsonOperationKey = KeyByResultKind<OperationMap, "json">;
type MediaOperationKey = KeyByResultKind<OperationMap, "media_stream">;
execute<K extends JsonOperationKey>(operation: TypedOperation<K>): Promise<Result<OutputOf<K>>>;
openMedia<K extends MediaOperationKey>(operation: TypedOperation<K>): Promise<Result<MediaContent>>;
type MediaContent = { body: ReadableStream<Uint8Array>; contentType: string; byteSize: number; etag?: string };
```

- `AtlasApplication` 是唯一外部 module/interface：`execute` 在编译期关联 operation、input 与 output；`openMedia` 单独承载二进制流生命周期。公共 `Result` 只含 `invalid_input | not_found | dependency_failure | unexpected_failure`。
- `OperationMap` 与只读 operation catalog 按 Catalog、Personal Memory、Media、Import、Decision 静态组合；每个 runtime `OperationDescriptor` 仅含稳定 key、runtime validator、`resultKind: json | media_stream`、`effect: read | write | destructive`，并与类型 map 同处定义。互斥 key 集合由 `resultKind` 推导；`media.open` 在同一 catalog 但只能走 `openMedia`，编译期负面测试禁止两类 key 交叉。禁止 runtime registration、`unknown` 万能输入、未校验 cast、generic CRUD 或第二份工具清单。
- nearby descriptor 使用闭合领域 profile：`verified_catalog` 与 `full_merged_catalog`；后者完整合并 verified/needs_review、忽略 UI filters 并在核心排序。WebMCP 只提供定位输入及执行 UI-only focus，不读取 ViewModel/cache 决定集合。
- 每个领域组有一个内部 handler seam，封装该组规则；只有 AtlasApplication 协调 handler，handler 不互调。record-oriented state ports 按 AtlasItem/override/tombstone、PlaceAssessment、Visit、VisitMedia metadata、ImportJob 组织，不按 route/use case 复制。
- state seam 提供窄的具名 unit-of-work：Visit create/edit/delete、条目删除+tombstone 等跨记录 mutation 各一次 D1 原子提交；“失败零结构化写入”只约束单个 D1 unit-of-work，不适用于 D1/R2 补偿。D1 adapter 保持每项 Visit 操作至多两次 binding 往返。
- Media handler 协调并只特征化当前跨存储语义：attach 为 R2 put → D1 metadata transaction，失败时 best-effort 删除本批对象并返回 `dependency_failure`；单媒体删除先提交 D1 metadata，R2 删除失败返回 `dependency_failure` 且允许 orphan；Visit/AtlasItem 删除先提交 D1 原子变更，再 best-effort 删除 R2，R2 失败仍成功且允许 orphan。本片不增加 retry/reconcile。
- D1 adapter 实现全部结构化 state ports，R2 adapter 实现媒体对象 port；InMemory adapters 运行主 contract suite。`Clock` 与 `IdSource` 是可替代的内部依赖。核心不导入 React、Next、WebMCP、D1/R2 binding 或供应商 SDK。
- HTTP route、Browser/ViewModel client、WebMCP 是 inbound adapters：HTTP 做解析与状态映射；ViewModel 保留乐观更新/回滚；WebMCP 保留工具 schema/annotation。`focus_atlas_item` 仍是 UI-only，不进入 AtlasApplication。

依赖只允许：`HTTP | ViewModel | WebMCP → AtlasApplication → handlers → state/object ports ← D1 | R2 | InMemory adapters`；不得反向依赖或成环。

## 核心数据与兼容

- `effectiveVisited = Visit 存在 OR manualVisited`；存储中的旧 `has_visited` 由 D1 adapter 隐藏并按 manualVisited 解释，`personalState: visited` 不参与计算。创建 Visit 不写 manualVisited；删除后重新推导。
- 新增不可变 migration 仅将 PlaceAssessment 的 `is_favorite`、旧到访位、`overall_rating`、`summary` 重置为 false/null；不更新时间戳或改变其他 D1 字段、记录及 R2 object。迁移前后以全 D1 快照和 R2 object-key manifest 证明封闭白名单。
- HTTP nearby 保持 `verified` 集合与 1–20 limit；WebMCP nearby 必须由 AtlasApplication 读取**完整合并集合**（含 `verified` 与 `needs_review`），忽略搜索、类型、个人状态和喜欢等全部 UI filters，再按距离取前五。
- 相同 Visit ID 重投不新增 Visit，但仍按当前请求更新其所指 PlaceAssessment，并返回当前请求视图；不增加 conflict/result replay。媒体类型、8 MB、说明、hash、顺序与当前补偿保持不变；HTTP 每批 4 张、Browser 选择 24 张属于 inbound adapter。
- `MediaContent` 与供应商无关且只能消费一次；成功取得后 inbound adapter 负责完整消费或取消 `body`。metadata 缺失为 `not_found`，metadata 存在而 object 缺失为 `dependency_failure`；开始传输后的读取失败只能产生脱敏流错误并由 transport abort，不泄漏 R2 异常。
- HTTP 路径/方法、关键状态码、JSON shape、媒体 URL，以及 WebMCP 工具名/input schema/destructive annotation 保持兼容。四类错误由 inbound adapter 映射且不得泄漏 SQL、binding、bucket、堆栈或供应商异常。

## 关键流程

1. **结构化操作**：inbound adapter 校验协议 → `execute` 选择静态 typed handler → handler 经 record state ports 读写 → AtlasApplication 归一化 Result → adapter 映射现有 HTTP/WebMCP/ViewModel 结果。
2. **Visit 与有效状态**：Personal Memory handler 读取 PlaceAssessment/Visit → 执行现有写入或重投副作用 → 以 `Visit exists OR manualVisited` 生成 mutation/read 视图 → 所有入口观察同一结果。
3. **媒体**：`execute` 处理 metadata/attach/caption/delete 并协调 state/object ports；`openMedia` 从 object port 返回框架无关内容流，HTTP adapter 添加现有响应头与 URL 语义。

## 迁移与测试

1. 先以现有行为的 characterization tests 建立静态 OperationMap、descriptor、四类错误、AtlasApplication 与 InMemory adapters；CI 加依赖无环/禁用 import 检查。
2. 以单次维护切换发布：入口冻结全部 D1/R2 写入（覆盖个人状态、Visit、media）并排空旧 writer 请求 → 保存全 D1 快照/R2 manifest → 执行不可变、幂等四字段 reset → 部署并切换全部新 writer → CI/import 检查证明无绕过 AtlasApplication 的旧 writer → smoke 后恢复写入。
3. 任一步失败均保持写冻结；若已 reset，则恢复 D1 快照与旧版本并复验，确认白名单外数据及 R2 manifest 无变化后才重新开放，避免 reset 后的新数据被二次清除。
- 最后从静态 descriptor catalog 生成 capabilities/工具映射并保留一个 Web 冒烟链路。
- 主测试 seam 是 AtlasApplication + InMemory adapters；D1/R2 只做 state/object adapter integration tests，含全快照迁移、Visit 重投和媒体补偿；HTTP/WebMCP 只做代表性映射 contract tests。

## 横切偏离与范围护栏

- 相对产品架构仅提前落实 D-009、用户于 2026-09-12 确认的 nearby 缺失坐标 HTTP 400 修正，并执行用户授权的 PlaceAssessment 四字段测试状态重置；现有硬删除继续存在但不得声称实现 [`D-017`](../../docs/decisions.md)。
- APP-02 的完整幂等/receipt、auth、授权、审计、Trash Entry，以及推荐、identity confirmation、VisitCaptureSession、微信和媒体 hardening 均不进入本片；不增加对应错误类别、port 或占位实现。

## ADR 链接

沿用 [`D-002/D-003/D-004/D-009/D-016`](../../docs/decisions.md) 与 [`product/decisions.md`](../../product/decisions.md)；本片无新增不可逆产品决策。
