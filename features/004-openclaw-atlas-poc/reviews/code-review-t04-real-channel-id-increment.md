# T-04 真实微信 adapter channel ID 增量代码评审

- 日期: 2026-09-13
- 评审方式: subagent
- 固定点: `HEAD df2ec5958e974debca70b27b977662fd75cb7b87`，含当前未跟踪的 Feature 004 artifact
- 范围: OpenClaw client/test/README、Worker fixture key store 及其 contract test
- 结论: 通过
- auto-approved: 2026-09-13

## Standards

未发现严重或一般问题。

- `src/jpmap-client.mjs` 与 `dist/jpmap-client.mjs` 已逐字一致；其余两个 runtime source/dist 对也一致。
- OpenClaw package 的 `npm pack --dry-run --json` 只列出 8 个预期文件，没有 `.orig`、测试源码、secret、真实账号 ID、实例 IP 或私钥材料。
- 新增的 cross-boundary contract 直接把 OpenClaw client 的真实 request envelope 送入 isolated Worker handler，验证部署接缝而非复制实现判断；没有引入生产 runtime 反向依赖。
- 未发现本增量引入的神秘命名、重复分支、无关抽象或越界能力。

## Spec

未发现严重或一般问题。

- `openclaw-poc/src/jpmap-client.mjs:86-107` 同时要求 trusted `messageChannel` 与 `deliveryContext.channel` 精确等于已核实 adapter ID `openclaw-weixin`；旧抽象 `wechat`、其他 channel、缺失 owner、第二 sender、不同 conversation 或 thread 均失败关闭。独立探针确认旧 channel 出现在任一位置时固定返回配置不可用且 Worker egress 为 0。
- client 签名 actor 使用 `channel: openclaw-weixin`、`conversationType: direct`；Worker `createFixtureAgentKeyStore` 使用完全相同的四字段 owner identity 与只读 `atlas:nearby:read` scope。网关通过 `sameActor` 逐字段比较，调用方不能自行提升 channel、conversation 或 scope。
- `isolated-readonly-agent-service.contract.test.mjs:177-210` 将真实 OpenClaw client、HMAC canonical bytes、HTTP mapping、Worker key store 和 isolated D1 fixture 串成一个契约：请求成功、fixture 只读一次、审计 channel 为 `openclaw-weixin`。这也关闭了单独 client/Worker fixture 各自通过但字段互不兼容的风险。
- client 固定签名向量已随完整 actor body 重算：body digest `bafb80a5…d162`、HMAC `0f5284a5…1a05`；10/10 client contracts 通过，且 cross-boundary test 由产品侧 HMAC verifier 实际验签成功。
- README 的 Worker key 配置说明与实现一致，明确 channel `openclaw-weixin`、conversation type `direct` 和唯一 read scope；先前关于 optional tool、普通模型隔离与真实宿主 STOP gate 的限制仍原样有效。

## 验证证据

- 通过：OpenClaw package contract tests 10/10。
- 通过：isolated Worker fixture／OpenClaw-to-Worker cross-boundary tests 5/5。
- 通过：OpenClaw package lint。
- 通过：三个 runtime `src`/`dist` 一致性比对。
- 通过：`npm pack --dry-run --json`，7,062 B archive / 19,033 B unpacked，8 个预期文件且无 `.orig`。
- 通过：旧 `wechat` message/delivery channel 零 egress 独立探针、敏感值扫描与 scoped `git diff --check`。
