# 性能证据 — 2026-09-07

状态：实现与部署验证通过；地图交互 trace 仍待完成

## Issue #1 — 地图平移与缩放

### 修改前

- Leaflet 被强制设置为 `updateWhenIdle: true` 与
  `updateWhenZooming: false`，瓦片工作集中到交互结束，而不是使用桌面端渐进默认值；
- `keepBuffer` 为 4；
- Item／筛选变化会清空整层标记并全部重建；
- 每次 `ResizeObserver` 回调都立即触发地图尺寸重算。

### 修改后

- 移除两项反向调度覆盖，恢复 Leaflet 渐进默认值；
- `keepBuffer` 恢复为 2，并恢复正常的标记缩放行为；
- 通过 `AtlasMapAdapter` 隔离 React 与 Leaflet，瓦片供应商配置可注入；
- 依据稳定 ID／signature 对账标记，不再清空整层；
- Resize 统一到每动画帧一次，并合并 move-end。

本地证据：marker-plan 单元测试验证重叠标记偏移稳定，并保证未变化的标记既不删除也不重建；类型检查、Lint、生产构建与全部单元测试通过。关闭 issue 前仍需托管环境的帧与瓦片时间。

## Issue #2 — Journal 写入延迟

### 修改前

一次新增约执行 13 条 D1 statement、经历 5 个串行等待阶段：先全量读取五组数据解析地点，写入 Visit，再重复五组读取、读取 assessment，最后 UPSERT；两次写入也不是原子的。

### 修改后

- 一次定向地点解析替代写入期间的全部全表读取；
- 一个 D1 `batch()` 原子执行幂等 Visit 插入与定向 assessment UPSERT；
- 客户端 mutation UUID 同时作为乐观与持久 Visit ID；
- 重试使用 `ON CONFLICT(id) DO NOTHING`，不会产生重复 Visit；
- Journal 等待期间不再禁用无关的地图／地点操作。

新增 Visit 的结构预算为：**2 次 D1 binding 往返、3 条 statement、0 次全表读取**，修改前约为 13 条 statement 与 5 个串行阶段。SQLite 契约测试验证幂等性，以及 favorite／summary 等无关字段不会被覆盖。

生产环境使用同一个幂等 Visit ID 采样五次，分别为 1.889 s、2.020 s、2.703 s、3.178 s 与 3.986 s：**p50 为 2.703 s，观测 p95 为 3.986 s**。临时 Visit 随后已删除，并确认生产 visits 表为空。同一环境下，在进入有意义的应用逻辑前，只读端点也很慢：静态 capabilities TTFB 2.894 s、空 Journal TTFB 2.016 s、items TTFB 2.078 s。这说明本次采样路径存在约两秒的 Sites／私有鉴权／运行时底噪；D1 查询数量是正确性与扩展问题，但不是全部托管延迟。网页因此将持久确认视为异步过程，立即绘制乐观 Visit。如果后台同步耗时日后影响实际使用，可再评估独立的 APAC 服务／API 主机。

### 2026-09-08 edit／delete 修正

问题不只是 API 慢。ViewModel 已经乐观修改本地状态，但 View 仍然在 `await` 云端回包后才收起编辑器／删除确认框，因此约两秒的平台底噪被直接暴露给用户。现在 Save 会在同一交互帧退出编辑态，Delete 会立即关闭确认框并移除 Visit；若持久化失败，ViewModel 恢复原数据，View 重新打开相应操作界面。

服务端也完成收敛：edit 从 3 次串行 D1 binding 往返降为 **2 次**（一次同时解析 Visit 与地点，一次原子写入）；删除最后一个 Visit 从最多 6 次降为 **2 次**（一次解析，一次包含删除与 `has_visited` 对账的原子批次）。两条路径都没有全表读取，并保留地点级评分、喜欢状态和 summary。

部署后使用可回收临时记录验证：edit API 为 2.353 s，delete API 为 2.348 s；随后只读 Journal 为 2.019 s。结果再次表明剩余约两秒主要位于 Sites 私有鉴权／运行时路径，而不是当前 mutation 业务逻辑。临时记录已删除并回读确认不存在。由于前台现在不等待该回包，用户可见 Save／Delete 响应不再受这段网络时间阻塞。

## 验收预算

| 指标 | 预算 |
|---|---:|
| 交互或主线程长任务 | 不得超过 200 ms |
| 帧间隔 | p95 < 50 ms；最大值 < 100 ms |
| 固定 100 ms 测试瓦片延迟下的稳定时间 | p95 < 400 ms |
| Journal 乐观绘制 | p95 <= 100 ms |
| Journal create／edit／delete D1 binding 往返 | 各 2 |
| 重试重复／半完成 Visit | 0 |

地图自动化必须使用测试／拦截瓦片，不能批量压测公共 OSM 瓦片服务。托管冒烟检查同时覆盖 Codex 内置浏览器与独立 Chrome，以区分嵌入式浏览器合成问题、应用问题与瓦片网络延迟。
