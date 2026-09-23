# T-15 演示验收

- 日期: 2026-09-23
- 模式: interactive
- 结论: 接受
- 用户确认: `continue`

## 已验收范围

- 本次验收对象是 T-15 的本地 contract/security slice：D1 在 research egress 前原子消费分阶段 allowance，签名请求与签名闭合 scalar result 绑定 session、phase、权威 digest、期限、request ID 和 usage。
- Relay contract 具备跨进程 replay defense、response-loss 不重试，以及 HTTPS:443、A+AAAA 公网地址校验、IP pin、原 hostname SNI/Host、逐跳 redirect 和 DNS rebinding 防护。
- raw HTML 只作为 Relay 内 extractor 的瞬时输入；D1、replay store、Core DTO 和签名结果不保存 raw、snippet、review text、错误细节或模型记忆。
- initial 与 confirm research 预算不可互借；provider failure、benign no-evidence、expired、conflict 和 already-spent 均保持闭合结果，Owner assertion 不被 Agent unknown 降级。

## 证据

- 最终独立 code/security review PASS：严重 0、一般 0、建议 0；记录见 `t15-code-security-review-2026-09-23.md`。
- T-15 focused contracts `92/92`、完整测试 `601/601` 通过。
- TypeScript、lint、format、migration、diff 与 owner-poc production build 全部通过。

## 保留边界

- **D-P06 仍为 Proposed。** 本次验收不接受该生产决策，也不授权启用 Research Relay、Tunnel 或 OpenClaw research。
- Production composition 继续默认关闭 Relay；Tabelog／预约事实保持 Owner 手填或 `unknown`，不得用 fixture 或 mock 宣称真实 research 已上线。
- 真实 Node/OpenClaw/Tunnel adapter、双端 Secret/binding、Tunnel identity、host replay-store 权限与重启恢复、无公网／browser-fetch 旁路及真实负向 probes 属于 T-18 preflight。只有这些证据和独立威胁复审通过后，D-P06 才可转为 Accepted；否则以 `relay_disabled_manual_unknown` 发布基础 Add。
- T-17 只在上述安全关闭状态下开放 Web confirm 与确定性 `/jpmap add` 双 adapter，并完成权限、nonce、scope、receipt、read-after-write 与 Web/Agent 等价 E2E。
- 本次不修改 OpenClaw endpoint，不部署 Cloudflare，不开放 Agent intake manifest，也不执行生产迁移或回退。
