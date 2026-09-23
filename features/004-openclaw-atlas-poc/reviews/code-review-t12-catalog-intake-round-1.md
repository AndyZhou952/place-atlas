# T-12 Catalog intake discovery 实现评审（第 1 轮）

- 日期: 2026-09-15
- 评审方式: subagent
- 固定点: `HEAD` (`df2ec5958e974debca70b27b977662fd75cb7b87`)，四个被评文件相对固定点均为新增
- 结论: 需修改

## Standards

- [一般] `apps/web/product/application/catalog-intake/catalog-intake-coordinator.ts:430-455`: `normalizeWeakText` 在既有唯一 search policy 之外重新实现 NFKC／小写／标点清理匹配，真实 architecture fitness 已报 `duplicate_business_policy (search:known-primitive)`；这会让 Catalog 疑似重复规则与产品搜索规则各自演化。→ 将共享文本匹配原语收回已批准的 policy owner，或先把“搜索”与“身份疑似重复”明确拆成有记录的两个领域 policy 并相应调整 fitness，不能在 coordinator 内保留第二套匿名归一化实现。

## Spec

- [一般] `apps/web/product/application/catalog-intake/catalog-intake-coordinator.ts:146-157,205-288`: `cancel` 只覆盖 store，但新的 `discover` 完全不检查已存 session；同一 `sessionId` 取消后可再次查询 provider 并回到 `preview`。评审者最小复现得到 `{"calls":2,"status":"preview"}`，不符合“取消终态”。→ `discover` 开始时读取并执行闭合状态转换；`cancelled` 必须重放终态或拒绝，不能重新开放，也要补回归测试。
- [一般] `apps/web/product/application/catalog-intake/catalog-intake-coordinator.ts:205-219`: coordinator 不校验空白 name/address/near；空白名称会实际调用 discovery provider 并可生成预览。评审者最小复现观察到 provider 收到 `{name:"   ",near:"   "}` 且返回 `preview`，没有安全失败关闭。→ 在任何 Catalog/provider 调用前规范化并验证查询，空 name/address 返回稳定 `invalid_input`；空白可选 near 应省略，并覆盖 name-only、name+area、address-only 的空白边界测试。
- [一般] `apps/web/product/application/catalog-intake/place-discovery.ts:43-50` 与 `apps/web/product/application/catalog-intake/catalog-intake-coordinator.ts:337-366,369-407`: evidence policy 只表达 `durableFields`，但 preview 无条件把坐标嵌入 OpenStreetMap 深链；它无法证明该供应商坐标获准用于 Leaflet／第三方地图展示，也无法携带必需 attribution。已批准架构明确禁止把 Google Geocoding/Routes 内容放入 Leaflet。→ 把展示用途（至少 chat／map provider compatibility）和 attribution 纳入不可伪造的受控 policy decision；未明确允许时不要用供应商坐标生成第三方地图链接，保持 unknown/fail-closed，并补 Google-like deny fixture。
- [一般] `apps/web/product/application/catalog-intake/place-discovery.ts:34-51` 与 `apps/web/product/application/catalog-intake/catalog-intake-coordinator.ts:84-88,266-273`: discovery candidate 和 `selection_required` 摘要都没有分店／区域字段；同名分店时只返回名称和地址，无法满足规格要求的“至少显示名称、分店／区域与地址”。→ 在 provider-neutral candidate/evidence 中增加有 provenance 和字段许可的 branch/area（拿不到时明确 unknown），并在最多三个候选的摘要中呈现，补同名不同分店测试。

## 验证记录

- 通过: T-12 focused tests、Foursquare contract/calibration 与 provider-policy regression，共 16/16。
- 通过: 四个固定范围文件 `oxlint`、`oxfmt --check`。
- 全仓 `typecheck` 未通过，但仅报告任务范围外既有 `scripts/migration-packaging.ts` 两处 Buffer 类型错误。
- architecture fitness 60/61；本票新增的独立失败为 `catalog-intake-coordinator.ts` 的 `duplicate_business_policy`。同次运行另有三项并行工作区中的 `agent.nearby` 组合错误，不归属本票。

## 已核对通过的规格点

- 支持仅名称、名称＋区域、仅地址三类输入形态；正常输入下先读 Catalog 再调用 provider。
- 强 identity 可复用已有条目；名称／地址／近坐标只作为最多三个疑似重复提示，不自动合并。
- 多候选最多三个，candidate ID 绑定已存 evidence；选择阶段不重新搜索。
- preview 含 evidence digest、version、catalog revision，内存实现冻结 evidence；本切片未注入或调用 `CatalogWrite`，不会创建 AtlasItem。
- 未获许可的外部评分保持 `unknown`；已许可 rating 需来源 URL、核验时间及评论数字段许可。
