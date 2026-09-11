# Japan Atlas 文档导航

最后更新：2026-09-09

这里仅保留会直接指导产品、开发和后续决策的文档。实施历史、低优先级问题、实验记录和逐次验收证据由 GitHub Issues 与 Git 历史保存，不再复制到 `/docs`。

## 新成员阅读顺序

1. [产品基线](product.md)：产品为谁服务、主要流程、体验与数据语义。
2. [系统架构与开发指南](architecture.md)：系统边界、代码分层、数据模型、接口、安全和本地开发。
3. [路线图](roadmap.md)：当前阶段、任务依赖、下一步与 v1 完成标准。
4. [采集与评测](ingestion-and-evaluation.md)：创作者内容采集、地点识别、预约核验和评测方法。
5. [决策登记册](decisions.md)：已接受、已替代和待验证的关键决策。

## 当前状态

项目处于**实验阶段**。

已经可用：

- 仅所有者可访问的地图与持久化数据库；
- 经来源核验的地点、活动和建筑记录；
- 地点编辑、确定性搜索、喜欢／到访状态与个人评分；
- 可重复 Visit、照片上传、说明、弹窗浏览与 Journal 纠错；
- Web UI 与浏览器 Agent 共用的 HTTP 操作；
- 格式、Lint、类型、单元测试和生产构建 CI。

尚未形成完整闭环：

- 与存储实现解耦的 Agent 应用层和服务端鉴权；
- 独立浏览器创作者采集与人工审核；
- 对话式照片 capture session；
- OpenClaw／微信适配器及七天稳定性验证；
- 24/7 部署、备份恢复、弱网与纯手机旅行演练。

## 跟踪规则

- `/docs`：稳定产品原则、当前架构、开发约束和阶段性路线。
- GitHub Issues：跨阶段 RFC、低优先级性能问题、实验方案、验收证据和待办细节。
- Git 历史：已删除的旧版本文档和实施过程。

当前长期跟踪入口：

- [#1 地图平移／缩放性能](https://github.com/AndyZhou952/jp-food-event-map/issues/1)
- [#3 Agent-first 交付路线 RFC](https://github.com/AndyZhou952/jp-food-event-map/issues/3)
- [#4 对话式图片与大图库 RFC](https://github.com/AndyZhou952/jp-food-event-map/issues/4)
- [#5 Visit 与到访状态一致性](https://github.com/AndyZhou952/jp-food-event-map/issues/5)

Issue #2 已关闭；其仍有效的乐观更新、幂等和 D1 往返预算已并入架构文档。

## 文档维护规则

1. 不再维护中英文镜像；本目录正文统一使用中文，代码标识保持原名。
2. 同一事实只在一个主文档中定义，其他文档使用链接。
3. 当前实现、目标架构和提议方案必须明确区分。
4. 时效性餐厅评分、活动日期、具体账号和抓取结果属于数据库或 Issue，不属于核心文档。
5. 新的长期技术决策进入 `decisions.md`；被替代的决定保留一句原因，不保留完整过程。
6. Roadmap 只维护阶段、依赖和当前状态；细粒度执行记录放入 Issue。
