# Japan Personal Atlas

一个私有、单用户、以地图和 Agent 为核心的日本地点助手。它把餐厅、咖啡店、活动、展览和建筑来源整理成附近推荐、预约提示与长期个人 Journal。

## 当前状态

项目处于实验阶段。私有地图、D1 持久数据、R2 照片、搜索、个人状态、Visit/Journal 与浏览器 Agent 操作已经可用；框架无关 Agent 服务层、创作者采集、微信渠道和旅行级运维仍在开发。

## 快速开始

要求 Node.js 22.13 或更高版本。

```bash
cd apps/web
npm ci
npm run dev
```

提交前运行：

```bash
npm run format:check
npm run lint
npm run typecheck
npm test
npm run build
```

## 文档

从 [文档导航](docs/README.md) 开始。核心文档包括：

- [产品基线](docs/product.md)
- [系统架构与开发指南](docs/architecture.md)
- [路线图与任务看板](docs/roadmap.md)
- [数据采集、实体识别与评测](docs/ingestion-and-evaluation.md)
- [决策登记册](docs/decisions.md)

稳定原则和当前架构放在 `/docs`；详细实施记录、低优先级性能问题和实验验收由 GitHub Issues 跟踪。

## 核心方向

- 微信／Agent 是目标态的主要采集和操作入口；
- 私有地图是主要浏览、空间整理和记忆入口；
- 所有入口调用同一套应用操作和持久化数据；
- Agent runtime、采集器、地图和存储通过 adapter 解耦；
- 模糊地点允许放弃判断并进入人工审核，不用猜测污染可信集合；
- 私有来源、照片和 Journal 不进入公开作品集数据。
