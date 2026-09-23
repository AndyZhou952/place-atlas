# T-11 Foursquare API New mapper 代码评审

- 日期: 2026-09-13
- 评审方式: subagent
- 固定点: `HEAD df2ec5958e974debca70b27b977662fd75cb7b87`
- 范围: Foursquare mapper、其 contract test、API New 日本 fixture 和两份日本合成校准 fixture
- 结论: 通过

## Standards

- [建议] `apps/web/adapters/providers/foursquare/foursquare-place-discovery.contract.test.mjs:161-212`: 实现已会对越界／错误类型的顶层坐标和旧 `geocodes.main` 嵌套形状失败关闭，但这些边界尚未作为持久 contract case 落盘。→ 后续在现有 malformed test 中补入越界 latitude、非数字 longitude 和仅嵌套 geocodes 三个回归用例。

未发现严重或一般 Standards 问题。mapper 仅投影稳定 place ID、名称、地址和坐标；任一候选缺少或携带非法必需字段时整个响应返回 `undefined`。受评文件中未发现 secret、API key、token 或真实 provider account 标识。

## Spec

无严重或一般发现。

- 当前 Foursquare Places API New 官方字段表将 `latitude` 和 `longitude` 定义为 place 顶层字段；mapper 及三份日本 fixture 已与该形状对齐，不再从 `geocodes.main` 读取。
- 顶层坐标必须是有限数字且落在合法纬经度范围；评审者额外以越界 latitude、字符串 longitude 和旧嵌套坐标形状验证均失败关闭。
- 供应商 `rating`、描述和其他未登记字段不进入 mapper 结果；discovery 对外评分仍固定为 `unknown/not_permitted`。
- 零、一和四个候选的 contract 仍证明 provider 最多返回三项，本次字段形状修正未改变候选顺序或上限。

## 验证证据

- 通过：Foursquare discovery contract 与 offline calibration 5/5。
- 通过：定向 `oxlint`。
- 通过：额外 malformed/raw-field 只读断言 4/4。
- 通过：受评文件敏感标识扫描无命中。
- 依据: https://docs.foursquare.com/fsq-developers-places/reference/response-fields
