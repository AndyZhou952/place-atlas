# Add 增量架构评审（第 3 轮 closure）

- 日期: 2026-09-22
- 评审方式: subagent
- 结论: 通过（PASS）

## 评审范围

仅核对第 2 轮两项：同一 transaction 内的权威重查/决策/原子提交，以及 D-P06 Relay 的 DNS/public-IP/SSRF/rebinding/pinned transport 与 fail-closed preflight。

## 发现项

- 无严重或一般发现。

## 闭合证据

- `architecture.md:23,39` 已把 `AtlasCatalogIntakePort.publish(preview, mutationKey, expectedSessionVersion, catalogRevision)` 定义为单一深接口。Production D1 adapter 在同一 transaction 内重读并 CAS 当前 session preview、Catalog revision 与强 Place identity，随后执行 Atlas Catalog duplicate/verification/publication policy，并原子写 identity、item、snapshots、receipt 与 session terminal；Application 不接收可在事务外延迟提交的 decision。冲突返回新 preview 且零写入，关闭了 decision/commit TOCTOU。
- `architecture.md:47-48` 与 `docs/decisions.md:D-P06` 已把 hardened transport 固定为 HTTPS:443，拒绝 URL credentials、IP literal、非批准 scheme/port 与 metadata host；初始 host 和每跳 redirect 均解析 A+AAAA，拒绝 loopback/private/link-local/multicast/unspecified/CGNAT/ULA/metadata ranges，并把实际连接固定到已验证 IP、保留原 TLS SNI/Host，每跳重验且最多三跳。
- OpenClaw search tool 只提供 URL candidates，canonical page 必须经过 Relay-owned pinned transport，不能用通用 browser fetch 旁路。DNS/IP pin、双栈、redirect、metadata 与 rebinding 任一保证无法兑现即关闭 Relay并回退 manual/unknown，符合 fail-closed。
- T-12 接受门已覆盖 allowance/Tunnel/tool binding、无公网旁路、response-loss 单次 egress、A+AAAA、禁止地址、TLS SNI/Host pin、逐跳 redirect、DNS rebinding 和 metadata fixtures；D-P06 的重审/拒绝条件与架构一致。

## 结论说明

第 2 轮两个 blocker 均已关闭；Add 增量架构可进入下一 HarnessFlow 阶段。
