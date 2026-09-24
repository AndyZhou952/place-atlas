# T-17 演示验收

- 日期: 2026-09-24
- 模式: interactive
- 结论: 接受
- 用户确认: `continue`

## 已验收

- Web Owner 可以从完整 preview 执行 Confirm；loading、retryable error、verified success、needs-review success 与 conflict 显式二次确认均使用生产 React panel。
- 确定性命令固定为 `/jpmap add <query>`、`/jpmap add select <n>`、`/jpmap add confirm`、`/jpmap add cancel`，精确命令不调用模型。
- Web Owner-cookie 与 Agent signed HMAC 共用四个 `catalog.intake.*` operations，并在同一真实 D1 fixture 上验证四操作、权限负向、nonce replay、receipt recovery 与 read-after-write。
- verified 地点进入公开 Catalog、地图与 Nearby；needs-review 仅 Owner 可见。
- 10 张真实 Chromium production React 截图及 JSON report 覆盖 desktop/mobile、ARIA、焦点、44px controls、computed CSS 与无横向溢出。

## 证据

- 独立评审: `t17-code-ui-review-2026-09-23.md`，第 3 轮 PASS，严重 0 / 一般 0 / 建议 0。
- 浏览器证据: `../evidence/ui/t17-browser-smoke-2026-09-23.md` 与 `../evidence/ui/t17-browser/`。
- 验证: architecture fitness 62/62；T-17 focused 10/10；OpenClaw plugin/src-dist、TypeScript、lint、format、migration 与 diff check 全绿。

## 保留边界

- 本验收不代表线上 Add 已发布。production migrations、provider composition、OpenClaw endpoint/credential 切换、线上 smoke 与回退属于 T-18。
- D-P06 仍为 Proposed；Research Relay 继续默认关闭并回退 manual/unknown，直到 T-18 对真实 Node/OpenClaw/Tunnel artifact 完成 preflight 与独立威胁复审。
- DeepSeek 模糊语义 proposal 仍属于 T-09；Record 属于 T-19/T-20。
