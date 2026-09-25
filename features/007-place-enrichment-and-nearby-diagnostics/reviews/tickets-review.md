# 地点自动补全与 Nearby 诊断任务票评审（第 1 轮）

- 日期: 2026-09-24
- 评审方式: subagent
- 结论: 需修改

## 发现项

- [一般] `tickets.md:14`：T-04 把两条关键真实验收写成了可被较弱结果满足的替代项：微信链允许以 `confirm/cancel` 中的 cancel 收尾，无法证明 production `ProjectCommandRouter`／微信 presenter 的 confirm 真正生成唯一 `committed_needs_review` receipt；池袋链又允许“已收藏地点或诚实业务空结果”，而已通过架构要求 Owner Worker 的 Web smoke 返回真实 saved result，用户给出的回归场景也明确已有池袋收藏。这样 T-04 可以在核心缺陷仍未闭合时被勾选。→ 将微信主验收固定为真实入口的 `/jpmap add … → select 1 → preview → confirm`，断言无旧提示、只生成一个 Review Candidate/receipt（cancel 可另列独立负向验收）；将池袋主验收固定为私有 Sidecar 成功 geocode 并触发 Routes、Owner Worker Web Nearby 返回预先核验的真实池袋 saved item。业务空结果只能作为另一个合法场景测试，不能替代该回归验收；同时明确记录脱敏构建/部署标识与结果类作为证据。

- [一般] `tickets.md:8-12`：任务票尚未完整承接已通过规格／架构的可测试合同。T-01 只概括“Browser 与 signed Agent 共用 fixtures”和若干负向语义，没有把 provider outcome 表的每一行分配为双入口等价断言（result class、retryability、no-write）；T-02 的 production UI 状态清单遗漏 discover 无候选的 empty/refine-query 状态及 pending 时 disabled 按钮的可见文字原因；T-03 虽写了显式重试，却没有验收“无自动 provider retry、每次显式重试重新预留 quota、失败不退款”，也没有把 `not_found` 与 `dependency_failure` 两种 Nearby UI 文案同时列为可验证结果。仅在 T-04 运行“全量 tests”不能证明这些测试会被实现。→ 在对应票内补上具名合同／fixture／UI 证据及预期断言，使每票自身即可独立判定完成；T-04 只负责重跑并汇总这些已定义的门。

- [一般] `tickets.md:21-29`：并行表宣称 T-01 与 T-03 “无共享实现文件”，但各票没有 `Affected/Owned files` 或模块所有权清单；末行只禁止并行修改 coordinator、DTO、Owner composition、binding contract 和部署配置，却没有指定谁负责这些必需改动、何时移交。尤其 T-03 要接入 Owner metered diagnostics，T-04 又负责共享 composition；若 T-03 不碰 composition，它不是 production 纵切，若要碰则当前 W1 边界没有可执行的归属。共享 E2E／fitness 测试文件也未说明采用独立新文件还是串行修改。→ 为 T-01/T-02/T-03/T-04 各列明确的生产文件与测试文件所有权；明确 T-03 在独立模块缝用测试 composition 完成纵切、Owner production composition／部署配置由 T-04 独占串行接线，或增加相应依赖边；共享 DTO、binding contract、fitness/E2E 文件同样指定唯一票或拆为各票独立测试文件。

## 已确认项

- 依赖图为 `T-01 → T-02 → T-04` 与 `T-03 → T-04`，未发现循环；T-01/T-03 均有可先行的回归纵切目标。
- `ENRICH-01` 位于“明确后继（不进入本轮 DoD）”，受 `D-P06 accepted` 与 Research Relay 安全／部署门阻塞；本轮只诚实显示 unknown，没有把自动 Tabelog／预约 research 或 DeepSeek 编排混入主票。
- T-02 已覆盖渐进披露、production ViewModel/React/CSS、desktop/390px、overflow、focus/live region、disclosure ARIA、44×44px 与同容器 Google Maps attribution 的主要 UI 证据；补齐上述遗漏状态后即可形成闭合验收。

---

# 地点自动补全与 Nearby 诊断任务票评审（第 2 轮）

- 日期: 2026-09-24
- 评审方式: subagent
- 结论: 需修改

## 发现项

- [一般] `tickets.md:12,29`：T-03 的生产文件所有权仍遗漏两处完成该票不可绕过的现有实现：Owner quota 预留、调用与失败归一实际在 `route-sidecar/metered-route-sidecar-client.ts`，而 Sidecar 私有 outcome 向产品 `not_found | dependency_failure` 的稳定降格实际在 `route-sidecar/route-sidecar-nearby-adapter.ts`。T-03 当前只列 `d1-metered-route-sidecar-client.ts` 和 `nearby-recommendation-operation.ts`，实现者若遵守 Owned files 就无法完成本票；若直接修改遗漏文件，又违反“所有权冲突时立即停在本票边界”的规则。→ 将这两个文件明确归 T-03（以及相应专属 tests），或把其改动拆到有显式依赖边的独立票；同时明确新增 `NearbyDiagnosticRecorder` 文件及 Sidecar worker/composition 接线分别归 T-03 测试纵切还是 T-04 production 汇合，避免诊断接缝在两个波次间成为无人负责的隐式共享面。

## 首轮闭合情况

- T-04 已把三条真实主验收固定为不可替代链：Web Add 单次 confirm、真实微信 confirm、池袋 Sidecar geocode→Routes 且 Owner Worker 返回预核验 saved item；cancel 与业务空结果已降为额外负向／合法场景。
- T-01 已显式承担 provider outcome 表逐行 Browser/signed Agent 等价合同；T-02 已补 empty/refine-query 与 pending disabled 可见原因；T-03 已补 `not_found`／`dependency_failure` 双态，以及无自动 retry、每次显式 retry 新预留 quota、失败不退款。
- 依赖图仍为无环；T-03 使用测试 composition，T-04 独占 Owner production composition、部署、fitness 与跨模块 E2E 的串行意图已经明确。上述遗漏文件补归属后，边界才具备可执行性。
- ENRICH-01 继续明确位于本轮 DoD 之外，受 D-P06 与 Research Relay 独立门约束；主票未混入自动 research。

---

# 地点自动补全与 Nearby 诊断任务票评审（第 3 轮）

- 日期: 2026-09-24
- 评审方式: subagent
- 结论: 需修改

## 发现项

- [一般] `tickets.md:12,14,25`：T-03 与 T-04 的详细票面已经明确“Sidecar worker production 接线归 T-03、Owner production composition/injection 归 T-04”，但 W1 并行表仍写成 T-03“只用测试 composition，不触碰 production composition”。该无修饰表述直接禁止了 T-03 在第 12 行被要求完成的 Sidecar worker production 接线，与“所有权冲突时立即停在本票边界”的纪律结合后会造成执行硬停。→ 将第 25 行收窄为“T-03 使用 Owner 测试 composition，不触碰 **Owner** production composition；Sidecar worker production 接线仍归 T-03”，使汇总表与逐票 Owned files 完全一致。

## 第 2 轮闭合情况

- `metered-route-sidecar-client.ts`、`d1-metered-route-sidecar-client.ts`、`route-sidecar-nearby-adapter.ts`、`worker.ts` 与新增 `NearbyDiagnosticRecorder` 均已明确归 T-03；T-03 负责 Sidecar worker production 接线和 Owner 测试 composition，T-04 负责 Owner production injection、service binding 与部署。
- 除上述并行表旧句外，未发现新的依赖环、规格／架构覆盖缺口或 ENRICH-01 越界。

---

# 地点自动补全与 Nearby 诊断任务票评审（第 4 轮）

- 日期: 2026-09-24
- 评审方式: subagent
- 结论: 通过

## 发现项

- 无。

## 最终复核结论

- W1 汇总表现已与逐票所有权一致：T-03 负责 Sidecar worker production 接线与 Owner test composition，但不触碰 Owner production composition；T-04 串行负责 Owner production injection、service binding、部署、fitness 与跨模块 E2E。
- 四张主票均有独立可验证的结果与明确阻塞边；依赖图 `T-01 → T-02 → T-04`、`T-03 → T-04` 无环，生产与专属测试文件边界可执行。
- T-04 固定覆盖真实 Web Add、微信 confirm 与池袋 saved-item 三条不可替代验收链；provider outcome 双入口矩阵、Web UI 状态／无障碍证据、Nearby failure 分层及 retry/quota 语义均已分配到具名任务票。
- ENRICH-01 继续明确排除在本轮 DoD 外，并受 D-P06 与 Research Relay 独立门约束；当前票面没有承诺或混入自动 research。
