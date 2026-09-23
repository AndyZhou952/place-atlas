# T-14 演示验收

- 日期: 2026-09-23
- 模式: interactive
- 结论: 接受
- 用户确认: `sure continue`

## 已验收范围

- Web Add panel 的 desktop、mobile 与标准 401 Owner-login 三种真实浏览器状态。
- only-name intake、候选/追问、durable location proposal、provider-unavailable needs-review preview 与闭合错误状态。
- 401 后保留 Owner 输入并展开既有非 modal Owner Login。
- collection 关闭态使用原生 `inert` 隔离隐藏控件；Web conversation 由签名 Owner session 在服务端派生并拒绝客户端接管。

## 证据

- 独立 code/UI review 第 2 轮 PASS：严重 0、一般 0、建议 0。
- focused 14/14、完整测试 515/515、TypeScript、lint、format、diff、owner-poc build 与 migration-check 全部通过。
- 截图：`t14-add-desktop.png`、`t14-add-mobile.png`、`t14-add-401.png`。

## 保留边界

- 本次接受不表示线上 Add 已可用。
- production `catalogIntakeModule` composition、DurableGeocoder production identity/provider switch、migration/deploy 与线上 smoke 属 T-18；完成前真实 `/api/catalog-intake/*` 继续 fail closed。
- Catalog confirm/publish 属 T-16，本次 UI 的 Confirm 保持禁用。
