# 架构评审（第 2 轮）

- 日期: 2026-09-21
- 评审方式: subagent
- 结论: 需修改

## 发现项

- [严重] `architecture.md:29,37,63`、`docs/decisions.md:D-022`、`product/assumptions.md:A-39`：架构把个人评论、Visit 与媒体公开作为已接受架构事实，但特性仍处于“待用户确认”，且第 1 轮之后没有取得对这些类别的新增明确公开确认。`PublicReadManifest` 的技术隔离不能代替产品隐私授权。→ 在用户确认前让个人记忆读取走 `OwnerCredential`，Public manifest 仅含 Catalog；或将匿名公开清单逐类提交用户确认后再把 D-022/A-39 标为 Accepted/已确认，并记录这是 D-018 的时限明确例外。
- [一般] `architecture.md:16,29,37`：`PublicReadManifest.project(operation, result)` 只有事后投影接口，却承担“未知 operation 默认拒绝”的事前授权；流程图又把 manifest 放在 `AtlasApplication` 前。该接口既拿不到 result 来 project，也不能表示授权后再执行、执行后再按精确 DTO 投影的两阶段顺序，尤其 `media.open` 可能在拒绝前已读取 R2。→ 拆成 `authorize(operation, principal)` 与 `project(operation, domainResult)`（或返回闭合 projector 的 `resolve(operation)`）；未知读取必须在 Application/R2 调用前拒绝，允许结果再经版本化 public DTO projector。字段 schema 应闭合，禁止直接序列化领域对象。
- [一般] `architecture.md:18,30-31`：`InvocationCoordinator` 声称隐藏 canonical digest，但 mutation envelope 又把 `payloadDigest` 作为输入，未定义 authoritative canonicalizer 和 transport/application digest 边界。这样 Web 与 Agent 仍可产生不同 receipt key，或让调用方选择 digest。→ Coordinator 接收 `{operation,input,mutationId,invocation}`，在 schema normalization 后用单一版本化 canonicalizer计算 digest；Agent HMAC 的 body digest 在 gateway 验证后仅作为 transport 证据，并与核心重算值比对而非成为事实。claim、conflict 与 receipt 全部使用核心值。
- [建议] `architecture.md:22,40-44,48-49`：D-P05 的信任区已经合理，但“无公开 route”仍需落为不可误配的部署适应度条件。→ Sidecar 配置明确禁止 `workers.dev`/public route，仅允许 service binding entrypoint；预检解析构建产物和远端配置，负测直接公网 URL 不可达、未绑定 Worker 不能调用。该证据可作为 D-P05 独立安全评审输入。
- [建议] `architecture.md:17,57`：Session signing secret 的生成强度和轮换版本未进入 `OwnerCredential` 不变量。→ 要求至少 256-bit 随机 secret，并让 `version`/secret 轮换使旧 Cookie 确定失效。

## 第 1 轮闭合情况

- 独立 Google Route Sidecar 已消除 D-P04 被写 Worker 静默继承的问题，且 D-P05 保持 Proposed/上线前独立评审。
- OwnerCredential 的 raw Secret contract、接口、同源与失败关闭已闭合。
- InvocationContext、统一 coordinator/receipt、分 SKU cap、attribution/request-only、seed manifest及双入口灰度/回退均已有架构落点；当前只剩上列 public manifest 两阶段接口与 authoritative digest 边界需收口。
