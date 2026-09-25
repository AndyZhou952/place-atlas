# 地点自动补全与 Nearby 诊断代码评审（第 3 轮）

- 日期: 2026-09-25
- 评审方式: subagent
- 固定点: `749be52f00938e2ef4090afa7244cce14a566cfe`
- 评审范围: 固定点至当前未提交 worktree（排除三个用户 `.orig` 文件）；重点复核第 2 轮唯一 finding 与第 1 轮回归
- 结论: 通过

## Standards

- 无严重、一般或建议项。
- `evidence/t04-local-integration-2026-09-24.md` 已保留最初无可用浏览器的真实历史，同时明确标为 `superseded`，并链接到后续 11 张真实 production React/CSS 截图、机器可读 accessibility／overflow 报告和独立视觉评审；旧 blocker JSON 也明确说明不再是当前证据。因此第 2 轮提出的证据冲突已闭合。

## Spec

- 无严重、一般或建议项。
- confirm identity refresh 的双入口 outcome matrix 现已分别覆盖 provider unavailable、rate limited、malformed response、obsolete/not-found identity。每个子变体都穿过 production Browser HTTP adapter 和 HMAC-signed Agent HTTP handler，而非只调用 Product Core。
- 四个子变体均逐例断言 Browser／Agent 等价为 `failed_no_write, reason=dependency`，HTTP 200、外部不可重试、Catalog publish 次数为零、confirm 前后 session 深比较不变，并验证各自私有 provider marker 不出现在任一外部 exchange。malformed fixture 走成功 envelope 内的候选校验失败分支；not-found fixture 走闭合 provider error 分支，未用泛化 dependency fixture 代替。

## Round-1 回归复核

- ambiguous durable-location select 的 Browser 首次／重放和 signed Agent response-loss 重放仍返回完全相同的 `ambiguous_location` clarification；旧的重复输入 prompt 与 `missing_area_or_address` 不会出现在这些生产外部路径。
- stable `no_match` 仍保持 evidence digest，一次 confirm 只生成一个 Review Candidate／receipt；replay 不重复 publish，真实 identity／evidence change 仍 conflict/no-write。
- expiry／CAS 仍通过 Browser 与 signed Agent 外部缝闭合；`expired` 的 router/gateway union 维持 HTTP 410，既有 gateway、D1 dual-adapter 与类型检查均未回归。
- Sidecar 与 Owner 两层仍覆盖 quota reserved、geocoding／walking-matrix success、普通 upstream 4xx、transport／redirect、malformed 与 zero-result；production Owner composition 注入 allowlisted operational recorder。诊断负测继续禁止 key、query、坐标、provider body、Owner／Catalog facts越过隐私边界。
- request-only transient presentation、固定 provider endpoint、manual redirect、Owner／Sidecar secret 分界、显式 quota reservation 与无自动 provider retry 均保持成立。

## 评审者运行证据

- Feature 007 focused contracts（Browser／signed Agent matrix、Catalog、router/gateway、D1 dual-adapter、diagnostics/metering、Nearby、architecture fitness、React/CSS/ViewModel/browser harness）：16/16 suites PASS。
- `npm run typecheck`：PASS。
- `npm run lint`：PASS。
- `npm run format:check`：PASS。
- `git diff --check`：PASS。
- 按本轮范围未长跑全量 suite；本结论不把作者记录的全量结果替代为评审者自跑结果。
