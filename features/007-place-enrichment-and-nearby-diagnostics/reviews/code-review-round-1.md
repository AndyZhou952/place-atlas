# 地点自动补全与 Nearby 诊断代码评审（第 1 轮）

- 日期: 2026-09-24
- 评审方式: subagent
- 固定点: `749be52f00938e2ef4090afa7244cce14a566cfe`
- 结论: 需修改

## Standards

- [一般] `apps/web/features/atlas/feature-007-catalog-intake-react-css.contract.test.mjs:1-99`、`apps/web/features/atlas/feature-007-catalog-intake-browser-harness.contract.test.mjs:1-25`、`features/007-place-enrichment-and-nearby-diagnostics/evidence/t04-local-integration-2026-09-24.md:53-61`：当前 UI 门只执行了源码正则检查；真正驱动 production React/CSS 的 Playwright harness 没有运行，仓库也明确只有 blocker JSON、没有 desktop/390 截图、自动可访问性结果或视觉评审。源码里出现 `aria-expanded`、`min-height` 和 focus 调用，不能证明浏览器中的 disclosure、焦点、44×44 target、无横向溢出、Google attribution 可见性或 loading/error/success 三态成立。按 `hf-ui-design`，真实渲染与截图评审是代码门而不只是上线 demo。→ 在有 Chromium/Playwright 的环境运行现有 production harness，保存 desktop/390 截图和 JSON；评审者核对视觉方向、五态、focus/live region/ARIA、target size、overflow 与 attribution 后再复审。静态源码合同可保留为快速门，但不能替代浏览器行为证据。

## Spec

- [一般] `apps/web/product/application/catalog-intake/catalog-intake-coordinator.ts:922-967,2169-2191`：首次 durable geocoder `ambiguous` 会正确返回 `ambiguous_location / Add an area or address...`，但同一 select 的幂等 replay 会由 `replaySelect()` 改写成已要求彻底消失的 `missing_area_or_address / Add a restaurant name, area, or address to continue.`。这既不是原响应的 byte-for-byte replay，也会在 Browser response-loss/CAS replay 路径重新制造“已经给了店名还要再给店名”的旧交互。→ 把实际 clarification（或足以确定性重建它的闭合状态）保存到 session/transition，并让 replay 返回完全相同的 code/prompt/fields；增加 ambiguous select 的 Browser 与 signed Agent response-loss/replay contract，断言旧提示在任何路径都不存在。

- [一般] `apps/web/product/application/conversation/feature-007-wechat-no-match.contract.test.mjs:33-99`、`apps/web/product/application/catalog-intake/feature-007-no-match.contract.test.mjs:1-430`：新的 Browser/signed-Agent 等价测试只覆盖 stable `no_match` happy path；其他 provider outcome 表行仍主要停留在 Product Core 单入口测试。规格和 T-01 明确要求 discover unavailable/malformed、select refetch unavailable/malformed/mismatch、geocoder ambiguous/unavailable、confirm identity/evidence change/failure、publisher closed no-write/exception等每一行都从 Browser adapter 与 signed Agent gateway 验证相同 result class、retryability 和 no-write。当前 adapter/error mapping 或 presenter 分歧仍可能漏过。→ 建立数据驱动的双入口 outcome-matrix contract，逐行断言 Browser 结果与 Agent receipt `intake` 等价、HTTP/AddError retryability 一致、Catalog/session 无意外写入，并把 replay/expiry/CAS 也放入该外部缝。

- [一般] `apps/web/route-sidecar/nearby-diagnostic-recorder.ts:1-21,41-48`、`apps/web/lib/server/application/owner-poc-composition.ts:48-54`、`features/007-place-enrichment-and-nearby-diagnostics/architecture.md:18,64-66`：诊断事件只表示失败／`not_found` 和 quota rejected/not-checked；正常 geocode、正常 walking matrix、quota reserved 均不记录，Owner production 更注入 `noOpNearbyDiagnosticRecorder`。因此 T-04 无法按已确认架构产出“quota decision + geocoding success + Routes reached”的脱敏两层 smoke 证据，也无法在生产区分 Owner reservation 已成功后 Sidecar 成功返回。现有 fixture 能证明代码组合，不等于真实 credential/API path 的诊断证据。→ 为 allowlisted event 增加成功/已预留的闭合类别，在 Owner production 注入真正仅运维可见且非持久化的 allowlisted recorder，并用合同证明一次成功 Nearby 只记录 SKU/endpoint、reserved/success 等允许字段，绝不记录 query、坐标、Catalog facts、provider body 或 secret；补普通 upstream 4xx 与两个 operation 的诊断覆盖。

## 已核对且未发现阻断项

- stable `no_match` 在 confirm-time 不再冒充 provider failure：focused contract 证明 digest 保持、一次 confirm 只 publish 一次，replay 不重复 publish；resolved↔no_match evidence change 走 conflict/no-write。
- Production `ProjectCommandRouter`、signed Agent gateway 与微信 presenter 已在 no-match 主路径复用同一 Application Operation；Review Candidate 经 D1 纵切保持 Public Read 不可见。
- Sidecar 固定 endpoint、`redirect: manual`、secret 注入边界、request-only evidence、Owner Worker 不直接绑定 `GOOGLE_MAPS_API_KEY`、产品只见 `not_found | dependency_failure` 的边界保持成立。
- “池袋 + verified saved item”测试不是同义反复：它从 `nearby.recommend` 贯穿 location resolver、verified Catalog shortlist、walking matrix 和最终 saved result；fake Sidecar 位于批准的外部 port。它是有效的确定性产品纵切，但不能替代仍待完成的 production Sidecar/Owner smoke。

## 评审者运行证据

- Feature 007 focused contracts：12/12 suites PASS。
- `npm run typecheck`：PASS。
- `npm run lint`：PASS。
- `npm run format:check`：PASS。
- 并行全量 `npm test` 曾出现一个 sqlite aggregate 子进程失败；同一文件单独复跑 PASS。随后以 `--test-concurrency=1` 重跑至第 109 个 suite 均 PASS，按主任务要求停止等待，故本轮不把这次未完整结束的全量运行计作 release-gate PASS，也不把 sqlite 并发噪音列为产品 finding。
