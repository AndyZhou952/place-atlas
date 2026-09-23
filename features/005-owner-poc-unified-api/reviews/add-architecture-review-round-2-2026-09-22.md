# Add 增量架构评审（第 2 轮 closure）

- 日期: 2026-09-22
- 评审方式: subagent
- 结论: 需修改（Needs changes）

## 评审范围

聚焦第 1 轮四项：模块/发布所有权、Google transient/durable 分区、现有 coordinator 原地替换与测试迁移、D-P06＋D1 phase-spent allowance/response-loss；同时核对新增 ADR、PASS spec、产品架构与 80 行量级。

## 剩余 blocker

- [一般] `architecture.md:23-24,35,40`: 模块所有权已经拆对，但 publication 流程仍把“Catalog 重查 duplicate/revision 并决定”与“D1 adapter commit”画成两个先后步骤。若 duplicate/revision 重查发生在 transaction 外，另一写入可在 decision 与 commit 之间占用 Place ID 或推进 catalog/session revision；仅靠先前 decision 会产生 TOCTOU。表中的 D1 adapter 也没有明确把 expected session version、catalog revision 与强 identity 作为同一 transaction 的 compare 条件。→ 选择一个明确原子 seam：要么 `AtlasCatalogIntakePort.publish(...)` 自己是深接口并在同一 D1 transaction 内重读 session/revision/identity、调用 Catalog policy、写 item/snapshots/receipt/terminal；要么 Catalog 先给纯 proposal，但 `commit(expectedSessionVersion, expectedCatalogRevision, strongIdentity, proposal, ...)` 必须在 transaction 内重新比较全部权威行/唯一键，不一致时不写并返回 conflict/new-preview。关键流程、fault tests 与 port 签名需明确这一点。

- [一般] `architecture.md:45-48,56` 与 `docs/decisions.md:D-P06`: D-P06 已覆盖 Tunnel 身份、allowance、重放、响应丢失与 raw 丢弃，但第 1 轮要求的 SSRF/DNS/IP 防线没有进入 ADR 或架构；现文字只有 URL/redirect/count 校验。Research Relay 会接触 search 结果与 canonical URLs，如果只校验 HTTPS/redirect，仍可能被 DNS rebinding、loopback/link-local/RFC1918/CGNAT/ULA/metadata 地址或 redirect 后私网目标利用。→ 在 D-P06 与 architecture/preflight 中补齐允许 origin/host/path 策略，以及每次 DNS 解析和每一跳 redirect 的公网 IP 校验；明确拒绝 URL credentials、非 HTTPS 和上述私网/metadata 范围，DNS/实际连接无法兑现时 fail closed。测试加入初始 URL、redirect、双栈与 DNS rebinding fixtures；该防线属于 Relay transport，不交给 OpenClaw/模型判断。

## 已关闭项

- `CatalogIntakeModule` 已明确位于 Application Operations，Atlas Catalog 独占 duplicate/revision、verification/publication policy，D1 adapter 不重判业务规则；只剩 transaction 内权威重查需要补明。
- Google discovery output 已分成 request-scoped `transientPresentation` 与可持久化 `durableIdentity`；state/digest 只接收后者，当前响应才可显示前者。
- 现有 `CatalogIntakeCoordinator` 被明确原地深化/替换；旧 full-evidence session/map persistence 删除，旧测试迁到 Application/provider contracts，Foursquare 与遗留接口不得形成第二写入口。
- D-P06 已建立 Proposed 决策；D1 在 RPC 前原子把整个 phase 标为 spent、不退款/不自动重试，签发短时 allowance；response loss 回退 unknown/manual 且不二次 egress，Relay 只作防御性上限并无产品状态。
- Web/Agent 共用 operation seam、Nearby Sidecar 隔离、旧 fixture 只读回退与 manifest 门保持一致；正文 56 行，符合 80 行量级，未引入 spec 外产品能力。

## 结论说明

第 1 轮四项的主体均已修正；当前只剩 publish TOCTOU 与 Relay SSRF/DNS 两个必须在实现前闭合的架构安全边界。修订后可做短 closure review。
