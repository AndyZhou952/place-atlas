# T-12 CatalogIntake walking skeleton 代码评审

- 日期：2026-09-22
- 评审方式：subagent
- 固定点：`HEAD 7e6bdb5cb5cfe28a8570fdc3aeda6a0e12304d91`
- 范围：T-12 intake 模块、Application 注册／类型／架构适应度与 T-12 状态文档；并行 T-08 文件明确排除
- 首轮结论：**需修改（NEEDS CHANGES）**
- 最终结论：**通过（PASS，第 3 轮闭合）**
- 修复状态：2026-09-22 已按本评审发现项完成修复，等待独立复审；原结论在复审 PASS 前不关闭。
- 第二轮修复状态：Tabelog URL 已收口为两个允许 host 上的稳定餐厅详情路径，等待最终独立复审；T-12 仍未关闭。

## Standards

- **[严重] `atlas-application.ts:152-157,173-208`、`catalog-intake-coordinator.ts:280-302,323-479`：端口抛出的异常会逃出 `AtlasApplication.execute()`，没有被转成闭合安全 Result。** `dispatch()` 在 `try` 内直接返回 `dispatchPrepared(...)` 而未 `await`，模块自身也没有捕获 discovery/state/catalogRevision 的 rejection；独立探针让 discovery port 抛出 `private provider text` 后，调用方收到 rejected Promise 和原始文字，而不是 `unexpected_failure`/`dependency_failure`。这破坏应用边界、可能让供应商内部错误进入框架日志，也使 fail-closed 测试无法成立。→ 在唯一应用边界真正 await/catch（或在深模块统一封装所有 port 调用），返回安全闭合错误；加入 discovery、catalogRevision、state create/get/replace rejection 的回归测试，并证明零 session/Catalog 写入。

- **[一般] `catalog-intake-operations.contract.test.mjs:12-210`：删除三套遗留测试后只留下 5 个主路径断言，没有完成任务票要求的 provider/validator/failure contract 迁移。** 当前没有 malformed provider output、未知嵌套字段、所有输入边界、异常端口、非法 provenance/URL、transient 内容不得进入 state/digest 的可观察 state-port spy 等负测；现有“不持久化 transient”只对最终 preview 做字符串匹配，无法证明传给 state port 的对象。→ 以 recording state port 和 adversarial provider fixtures 覆盖上述边界；测试公开行为与 port contract，不以源码正则代替。

已自行运行：T-12 contract + architecture fitness **67/67** 通过；TypeScript、全仓 lint 与 format-check 均通过。通过的检查不能覆盖上述运行时 rejection 和缺失负测。

## Spec

- **[严重] `catalog-intake-coordinator.ts:104-160,257-270`、`result.ts:1-18`：T-12 声称建立的“闭合 contracts”只是后续规格的子集，无法承载已确认 DTO。** preview 缺少 `titleProposal/addressProposal/clarification`；location evidence 缺 durable-geocoder variant；Tabelog/reservation 缺 `agent_observed`；suspected duplicate 被固定为空 tuple；warning 只允许 `needs_review`。共享 `Result` 又缺 AddError 已确认的 `unauthorized | forbidden | expired | rate_limited` 和可选 `retryable`。T-14/T-15 若继续实现将被迫再次改公开 operation contract，而非只在既有 seam 后增加 adapter。→ 先把最终闭合 discriminated unions 和 Add 专属错误契约按 `spec.md:124-135` 完整建模；T-12 fixture 可以只产 unknown/failed-no-write，但 contract 不应删减合法变体。

- **[一般] `catalog-intake-coordinator.ts:723-756`：Tabelog assertion validator 同时误拒合法值并接受非法来源。** `Math.round(score * 100) !== score * 100` 会因浮点表示拒绝规格允许的 `0.29`、`2.03`；URL 只检查任意 canonical HTTPS，因此 `https://example.com/not-tabelog` 被接受，违反明确 Tabelog host/path allowlist。→ 使用不会被二进制浮点误差击穿的两位小数校验，并实现显式 Tabelog canonical host/path policy；加入正反 contract fixtures。

- **[一般] `catalog-intake-coordinator.ts:870-889`：文本 validator 没有拒绝全部 control characters。** 当前只拒绝 C0 与 DEL，U+0080–U+009F（例如 U+0085）仍可进入 query/session，与“所有文本拒绝 control characters”不符。→ 按 Unicode control category 统一校验所有文本并补边界测试。

符合项：四个 operation 已注册到唯一 `AtlasApplication`；production default 统一返回 dependency failure；confirm 仍零 Catalog write；当前 session 只保存 Owner query 与 Place ID tuple；Agent manifest 未开放 Add；owner-poc 遗留 direct POST 仍先经 policy 返回 503；未发现 Foursquare runtime composition 或后续 T-13+ provider/deploy 实现越界。

## 第 2 轮闭合复审

- 日期：2026-09-22
- 范围：只复核首轮发现项、对应回归与修复范围
- 结论：**需修改（NEEDS CHANGES）**

### Standards

首轮两项 Standards 发现均已关闭：

- `atlas-application.ts:173-197` 现在真正 `await dispatchPrepared` 并将未知 rejection 清洗为统一 `unexpected_failure`；intake 模块还在 port 边界把 discovery、catalog revision、state create/get/replace failure 转为安全 `AddError`。recording state spy 证明 raw error 不泄漏，且失败阶段不会发生后续 session replace/Catalog write。
- contract suite 已扩展到异常 handler、五类 port failure、recording state、transient/digest 隔离、malformed/expanded provider payload、closed inputs、Tabelog 和 Unicode controls，不再只依赖 happy path。

当前模块为 1,290 行，但其中约前 390 行是已确认的最终闭合 DTO/state/port 类型，后部集中 operation wiring、validators 与 canonical digest；它保持一个 `CatalogIntakeModule` 公共 seam，未出现第二 coordinator 或跨模块业务复制。本轮不把行数本身判为严重异味。T-13–T-16 若继续显著增长，可在不改变深接口的前提下把纯 DTO/validator/internal-state 文件化；现在提前拆分不是通过门的条件。

### Spec

已关闭：最终 preview/provenance/freshness/duplicate/warning unions 已完整建模但没有提前实现 T-13+ 行为；Unicode `Cc` 被统一拒绝；`0.29`、`2.03` 合法且浮点误差不再误拒；malformed provider 在持久化前失败；T-08 evidence 第 17 行也已改成历史状态并说明当前全仓 lint 通过。

- **[一般] `catalog-intake-coordinator.ts:1211-1218`：Tabelog URL 的 host 已限制，但 path 仍不是规格要求的“明确允许 Tabelog host/path”。** 当前唯一条件是 `pathname !== '/'`，因此独立探针确认 `https://tabelog.com/help/rules/` 会被当成餐厅 canonical URL 接受并写入 preview；同理任意非根路径都通过。现有测试只拒绝 foreign host，没有覆盖同 host 的 help/user/search 等非餐厅路径。→ 建立明确的 restaurant canonical path matcher（并决定是否允许地区/语言等真实 canonical variants），加入合法餐厅 URL 与同 host 非餐厅 URL 的正反 fixtures。

### Error boundary assessment

`AddError` 的外部 enumerable/JSON 形状现精确为 `code/message/retryable`；`kind` 是 non-enumerable、不会进入 `Object.keys`、spread、`JSON.stringify` 或 `structuredClone`，只为当前 Application 内部错误分类兼容而存在。当前 mutation coordinator 对失败结果直接返回、不持久化该内部属性，尚未发现泄漏或 clone 后仍依赖 `kind` 的路径。因此该兼容做法在 T-12 范围内可接受；后续 Add adapter 必须按 `code` 映射，不得显式序列化 `kind`。

复跑证据：T-12 focused contracts **10/10**、TypeScript、全仓 lint、format-check 与 `git diff --check` 全部通过。由于仍有上述 path-policy 一项一般问题，本轮不能判定 PASS。

## 第 3 轮最终闭合复审

- 日期：2026-09-22
- 范围：只复核第 2 轮唯一剩余的 Tabelog canonical restaurant path finding
- 结论：**通过（PASS）**

第 2 轮唯一发现项已关闭：`isCanonicalTabelogUrl` 现在只允许 `tabelog.com`／`www.tabelog.com` 上形如 `/{region}/A{area}/A{subarea}/{numericRestaurantId}/` 的 HTTPS canonical 餐厅详情路径，并拒绝 query。正向契约覆盖 Tokyo 与 Osaka 的合法餐厅路径；反向契约明确覆盖 foreign host、`help`、`rstLst`、`user`、`search`、缺少餐厅 ID、ID 后额外路径和 query，全部返回闭合的 `invalid_input`。

独立复跑聚焦 intake contract：**10/10 通过**；`git diff --check` 通过。没有剩余 blocker，T-12 Standards + Spec 代码门最终 **PASS**。
