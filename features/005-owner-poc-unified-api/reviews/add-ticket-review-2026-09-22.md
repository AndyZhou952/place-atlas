# Add 任务票独立评审

- 日期：2026-09-22
- 方法：subagent cold review（hf-review / hf-to-tickets）
- 对象：`tickets.md` 当前 T-01–T-20 图，重点 T-12–T-18
- 基线：已通过的 `spec.md`、`architecture.md` 与 Add architecture round-3 PASS；并核对 feature 004 的 `VisitCapturePublisher`
- 首轮结论：**NEEDS CHANGES**
- 第 2 轮闭合结论：**PASS**

## Findings

- **[严重] T-17 的验收依赖未闭合。** `tickets.md:34` 要验证“模糊仅由 DeepSeek 提 proposal”，但 T-17 只阻塞于 T-14/T-15/T-16；实现该能力的 T-09 不在依赖中，而且当前仍未完成。按现有任务图，T-17 可以在 T-09 缺席时被领取，却无法满足自己的验收条件。请二选一：将 T-09 加为 T-17 blocker；或把 T-17 收窄到确定性 `/jpmap add`，把模糊 proposal 的双入口验收留在 T-09 的后继票。不得以测试桩把这条产品验收误判为完成。

- **[一般] W6 把 T-14/T-15/T-16 宣称为三个可完全并行 seam，与这些票的实际写入面和同文件串行规则不一致。** 三票都会扩展 `CatalogIntakeModule` 的 preview/session DTO、状态转换和 contract tests；T-14/T-15 还要把各自 proposal 合入同一 preview，T-16 则消费同一 preview 并接入 composition/D1 transaction。`tickets.md:53` 又规定 central composition、migration journal、operation catalog 不得并行编辑，却没有指定谁拥有共享 DTO/migration/composition，也没有汇合顺序。请把 W6 表述成“leaf adapters/port contracts 可并行”，并明确一个串行 integration owner/汇合票（或给三票分配互斥文件所有权与确定的合入顺序）；否则三票不能按表中说法安全并行，也不能各自独立证明端到端接受条件。

- **[一般] Google Places／durable geocoder 的生产供应商门没有落到可验收任务。** T-13/T-14 覆盖了 transient/durable 数据边界和 Nominatim 使用限制，T-18 只明确 D-P06 Relay 的启用门；没有票要求在生产启用前证明 Google key 仅服务端可见且不进日志/DTO、API restriction 与配额/费用上限、attribution/policy regression，也没有要求 durable geocoder 的 provider switch、`sourceUrl/license/checkedAt` 完整字段在真实配置中校准。请在 T-13/T-14 加 fixture contract，并在 T-18 加真实但脱敏的 provider preflight；任一凭证、许可、配额或 attribution 条件失败时应 fail closed/manual/needs_review，而不是阻塞整个 Add。

- **[一般] Record 图中有两条看起来是排期偏好而非真实技术 blocker。** T-19 是规格门，却被 T-11 的 Nearby 永久切换阻塞；T-20 又被 T-16 Add confirm 阻塞，尽管其写入边界由已核实存在的 `feature004/T-20 VisitCapturePublisher` 和 T-19 Record 规格定义，现有 Catalog item 已足以开发/测试。若确有依赖，请在票中写明 Record 必须消费 T-16 的哪个稳定接口/不变量；否则将“Add/部署优先”记录为 deferred/product sequencing，而从 `Blocked by` 移除，以保持阻塞图只表达不可开始的前置条件。

## 已确认无阻塞问题

- T-12 是可测试的 expansion/contraction walking skeleton：先闭合四个 operation、迁移遗留测试并持续关闭旁路，符合首个可执行切片要求。
- T-15 的 D-P06 allowance、SSRF/rebinding、response-loss 与 fail-closed 门和已通过架构一致；Relay 可保持 disabled，不应强迫不安全启用。
- T-17 与 T-18 已正确区分本地双 adapter 验收和生产 migration/deploy/cutover/rollback；旧 fixture 回退与新写不反迁也已写入生产票。
- T-12–T-20 编号、`feature004/T-20 VisitCapturePublisher` 交叉引用及 progress 中的待办状态未见错号；`git diff --check` 无内容错误（执行环境只报告既有 sandbox loopback 限制，复核改用只读提升执行）。

修正以上四项后可进入 implement；当前不建议把任务图标记为 PASS。

## 第 2 轮闭合复审

- 日期：2026-09-22
- 范围：只复核上述四项，不扩展评审范围
- 结论：**PASS**

1. **T-17 隐含语义依赖已关闭。** T-17 已收窄为确定性 `/jpmap add`，明确精确命令零模型调用，并把 DeepSeek 模糊 proposal 留在 T-09；因此不再需要把 T-09 作为 T-17 blocker。
2. **W6 过度并行已关闭。** T-14/T-15 只允许并行 leaf adapter/provider contract tests；共享 preview/session DTO、composition、migration 和 `CatalogIntakeModule` 明确由中央按 T-14 → T-16 → T-15 integration 串行汇合。T-16 以 fixture research 独立发布，T-17 同时依赖完成后的 T-15/T-16，开始依赖与最终汇合顺序一致。
3. **生产 provider 门已关闭。** T-18 现明确验收 Google Places 服务端密钥、API/restriction、quota/billing、policy/attribution，以及 DurableGeocoder production identity、rate/cache/attribution、provider switch 和 `sourceUrl/license/checkedAt`；任一条件失败均降级为 fail-closed/manual/needs_review，不阻塞基本 Add。T-13/T-14 的 transient/durable 与 Nominatim contract acceptance 保持配套。
4. **Record 虚假 blocker 已关闭。** T-19 改为无技术 blocker，并把 Add 优先记录为产品排期；T-20 只保留 T-19 与 `feature004/T-20 VisitCapturePublisher` 两项真实依赖，不再错误依赖 T-16。

`tickets.md` 的 blocker、波次和中央汇合说明现已一致；`progress.md` 也准确记录本轮修正但仍保持任务票待确认、尚未实现。最终 `git diff --check` 通过。任务图可进入用户确认与 T-12 implement。
