# T-11 WebMCP 与 capabilities 收缩代码评审（第 1 轮）

- 日期: 2026-09-12
- 评审方式: 独立 subagent
- 固定快照: baseline `3cca6732a3ad4d5d96d44ef76ccffa1a8f789331` + 当前完整 working-tree fixed snapshot（含 untracked 文件）
- 结论: 通过

## 验证证据

- 已按 T-11 manifest 冷读 `atlas-browser-operation-catalog`、Browser AtlasApplication、WebMCP、capabilities、nearby adapter 与相关测试，并与 baseline WebMCP/capabilities 契约逐项对照；未修改实现代码、任务票或进度。
- 14 个既有 WebMCP tool 的名称、输入 schema、required/additionalProperties 与 read/write/destructive annotations 有完整精确快照，顺序和 baseline 一致；三个删除工具保留 `destructiveHint: true`，`focus_atlas_item` 与 nearby 保留 UI read annotation。
- 除 `focus_atlas_item` 这个明确的 UI-only 操作外，所有查询与持久工具均直接执行注入的 `BrowserAtlasApplication`。`list_atlas_items` 请求 `full_merged_catalog` 并由测试证明同时返回 verified 与 needs_review；媒体列表从 Application 读取后才移除私有 hash，未从 ViewModel media cache 派生结果。
- `find_nearby_atlas_items` 只从浏览器读取坐标，然后直接调用 `decision.nearby`，固定 `limit: 5` 与 `profile: full_merged_catalog`；不读取 UI search/kind/personal/favorite filters，距离计算和排序仍只在 Product Core。成功后仅把第一项交给 UI-only focus 行为。
- 普通 HTTP nearby 未指定 profile 时仍为 `verified_catalog`；仅显式 `full_merged_catalog` 扩大集合，显式 verified 仍走 verified，其他值固定返回 400。定向测试以真实 Catalog/Decision Application 证明默认集合、完整集合、非法 profile、坐标与 limit 行为。
- `browserOperationHttpCatalog` 是 Browser adapter、capabilities 与 WebMCP 唯一共享的运行时 Application-key/HTTP mapping。生产扫描未发现 WebMCP 手写 `/api/*` 路径、capabilities 第二 operations 数组或另一份 HTTP operation catalog；Browser 的类型 map 仅关联各 key 的输入输出，不形成第二运行时清单。
- `media.attach` 在共享 catalog 中显式标记 `bodyKind: multipart`，只作为既有 capabilities HTTP operation 与 Browser 分批上传能力；WebMCP 的 14 个 JSON 工具未伪造二进制上传工具。
- capabilities endpoint 的 service/version/channelStatus、11 项 HTTP operation、字段与顺序与 baseline 完全相同。独立只读 localhost smoke 实际取得同一 JSON；上传项仍包含 `multipart/form-data` 和既有 contract。
- 提供的页面 runtime evidence 显示 reload 后首次过早 `fetchTools` 可处于 React effect 注册前，页面发出工具注册通知后再次读取即稳定获得完整 14 项且页面可用。结合 effect 的注册/AbortSignal 生命周期与精确工具快照，未发现丢失注册或持续空目录；该短暂 pre-registration 窗口不是本轮阻断项。
- 定向验证：17/17 通过；覆盖 WebMCP contract/forwarding、共享 catalog/capabilities、Browser transport、ViewModel boundary、nearby HTTP 与核心 profile。
- 完整门禁：`format:check`、`lint`、`typecheck`、全量测试 158/158、`build` 与 `git diff --check 3cca673` 全部通过。build 仅出现既有 Leaflet 图片解析警告。

## Standards

- 无发现项。共享 catalog 集中稳定的 HTTP/operation 变化，WebMCP 只保留渠道专属 schema、输入转换和 UI-only focus；未发现第二 mapping/catalog、缓存事实源、距离规则复制、消息链或范围外通用性。

## Spec

- 无发现项。14-tool WebMCP 兼容、统一 Browser AtlasApplication 转交、full-merged list/nearby、focus UI-only、multipart 隔离、nearby profile 护栏及 capabilities JSON/顺序均符合已确认规格、架构与 T-11 验收。
