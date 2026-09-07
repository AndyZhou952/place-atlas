# 性能证据 — 2026-09-07

状态：本地实现验证通过；等待部署后的托管实测

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

## Issue #2 — Journal 保存延迟

### 修改前

一次新增约执行 13 条 D1 statement、经历 5 个串行等待阶段：先全量读取五组数据解析地点，写入 Visit，再重复五组读取、读取 assessment，最后 UPSERT；两次写入也不是原子的。

### 修改后

- 一次定向地点解析替代写入期间的全部全表读取；
- 一个 D1 `batch()` 原子执行幂等 Visit 插入与定向 assessment UPSERT；
- 客户端 mutation UUID 同时作为乐观与持久 Visit ID；
- 重试使用 `ON CONFLICT(id) DO NOTHING`，不会产生重复 Visit；
- Journal 等待期间不再禁用无关的地图／地点操作。

新增 Visit 的结构预算为：**2 次 D1 binding 往返、3 条 statement、0 次全表读取**，修改前约为 13 条 statement 与 5 个串行阶段。SQLite 契约测试验证幂等性，以及 favorite／summary 等无关字段不会被覆盖。部署后仍需采样 p50／p95。

## 验收预算

| 指标 | 预算 |
|---|---:|
| 交互或主线程长任务 | 不得超过 200 ms |
| 帧间隔 | p95 < 50 ms；最大值 < 100 ms |
| 固定 100 ms 测试瓦片延迟下的稳定时间 | p95 < 400 ms |
| Journal 乐观绘制 | p95 <= 100 ms |
| Journal D1 binding 往返 | 2 |
| 重试重复／半完成 Visit | 0 |

地图自动化必须使用测试／拦截瓦片，不能批量压测公共 OSM 瓦片服务。托管冒烟检查同时覆盖 Codex 内置浏览器与独立 Chrome，以区分嵌入式浏览器合成问题、应用问题与瓦片网络延迟。
