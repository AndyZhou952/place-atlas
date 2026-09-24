# Feature 006 演示验收

- 日期：2026-09-24
- 模式：interactive
- 状态：等待 Owner 在线确认
- 自动化结论：通过

## 可见验收路径

1. 微信 `/jpmap add`：候选、preview、conflict、成功与失败回复采用手机优先短格式，不显示 Place ID、坐标、license、receipt 或来源 URL；390×844 五态证据见 `../evidence/t01-wechat/`。
2. Web Review：导航为 `Review`，不再出现 creator import、collector 或 import jobs；真实 D1 needs-review candidate `verified-2` 经 Owner route/client/ViewModel/React 在 desktop/390px 可见，同一记录对 anonymous Items、Map marker 和 Nearby 隐藏；证据见 `../evidence/ui/t09-review-persisted-*`。
3. 个人评分与 Tabelog：`SPICY CURRY 魯珈` 保存个人分数 3.5 后，列表与详情仍同时显示 Tabelog 3.87；清空个人评分／评论也能即时收敛，reload 后一致；证据见 `../evidence/t07-tabelog-personal-rating-regression-2026-09-24.md`。
4. Owner 使用手册：README 前部链接 `docs/user-manual.md`，命令示例由 production parser contract 验证。

## 发布前门

- 第 3 轮独立代码评审：PASS，无严重／一般发现。
- 全量测试：637/637；受限 sandbox 唯一 nested-spawn EPERM 文件已在非 sandbox 原样 3/3 通过。
- Typecheck、lint、format、migration check、architecture fitness、production build：PASS。
- 已发布 migration 未改写；遗留 `import_jobs` schema、sentinel 行与 payload 在升级 smoke 前后不变。

## Owner 反馈

- 待线上部署后确认：Review 页面已无 Creator Import；个人评分写入后 Tabelog badge 仍在；微信 Add 回复长度和分组可用。
