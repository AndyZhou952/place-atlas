# T-07 Media 读取与流切片代码评审（第 1 轮）

- 日期: 2026-09-12
- 评审方式: subagent
- 固定点: `3cca6732a3ad4d5d96d44ef76ccffa1a8f789331` 加当前完整 working-tree fixed snapshot；按 T-07 manifest 与中央接入文件归因
- 结论: 通过

## 验证证据

- 定向测试通过：AtlasApplication/InMemory 媒体读取、D1 metadata adapter、R2 object adapter、媒体列表 HTTP 映射与内容流 HTTP 映射，共 11 项。
- 全量 `format:check`、`lint`、`typecheck`、测试（66 项）与生产构建通过；构建只有既有 Leaflet 图片路径解析警告。
- `media.list` 同时支持 Visit 与 AtlasItem 过滤，D1 和内存 adapter 保持既有 `visitId → displayOrder → createdAt` 顺序；公开结果保留编码后的媒体 URL 且不暴露 object key。
- metadata 缺失返回 `not_found` 且不访问对象存储；metadata 存在而 object 缺失返回脱敏 `dependency_failure`。D1 与 R2 异常正文均不跨越 Application interface。
- `media.open` 的静态类型只允许通过 `openMedia`，负面编译测试有效；Product Core 仅暴露标准 `ReadableStream`、content type、byte size 与可选 ETag，没有 D1/R2 或供应商类型。
- 返回流保持单消费者语义，HTTP body 取消会传播到底层对象流；底层流读取失败转换为固定脱敏错误。
- `/api/media` GET 与 `/api/media/:id/content` 均使用唯一中央 `getServerAtlasApplication()`；内容响应保留私有缓存、MIME、长度、ETag 与字节语义。T-08 所属写入 route 未被本票迁移。

## Standards

- 无。

## Spec

- 无。
