# 规格评审（第 2 轮）

- 日期: 2026-09-21
- 评审方式: subagent
- 结论: 需修改

## 发现项

- [严重] `spec.md:39-41,96,129`、`product/assumptions.md:A-39`、`docs/decisions.md:D-022`：第 1 轮要求“逐类公开确认”后，修订稿直接把 PlaceAssessment 评论、Visit 展示笔记及 VisitMedia 二进制全部列入匿名投影，并把 A-39 标成“已确认”、D-022 标成 `Accepted`；但本轮之前没有新的用户确认，规格自身仍写“待用户确认”。用户先前的“只阻止未登录写入”与“现阶段一般没有敏感信息”不足以证明其已逐类理解并接受评论、到访记录和原图可被任何持 URL 者读取。→ 在用户确认前把 A-39/D-022 改为待确认/Proposed，并保持这些个人读取 Owner-only；或向用户清楚列出将匿名公开的三类内容并取得明确确认后再恢复状态。不能用作者重标台账代替隐私确认。
- [一般] `spec.md:39-41,96,112`：Public Read Projection 虽从“所有 GET”收窄到分类 allowlist，但 `Catalog 展示字段`、`Visit 展示笔记`、`VisitMedia 展示元数据`仍不是闭合字段 schema；例如媒体的 object key、原文件名、SHA-256、内部 Visit/item ID 是否公开无法判定，测试也无法证明新增字段不会随 DTO 序列化泄漏。→ 在规格中列出 v1 public DTO 的确切字段，或引用一个版本化 schema/manifest artifact；媒体二进制单独给出公开 operation，明确响应头与禁止公开的 object key、原文件名、hash、内部审计字段。契约测试对每个允许字段正测，并对领域对象新增哨兵字段做负测。
- [一般] `spec.md:60-62,92,111-113`：mutation envelope 同时包含调用方提供的 `payloadDigest`，而 Implementation/Testing 没有规定谁对规范化 payload 计算 digest、Agent transport digest 与应用 receipt digest 如何对应、核心是否重新计算。两个 adapter 各算一遍会重新引入不同 canonicalization，信任客户端 digest 也不能可靠检测“同 ID 异 payload”。→ 规定 `InvocationCoordinator` 对 schema 校验后的 `{operation,input}` 使用唯一版本化 canonicalizer 计算 authoritative digest；Web 不提交 digest，Agent 外层签名 digest 只用于 transport，进入核心后必须重算/比对。receipt 只返回核心计算值，并测试字段顺序、缺省值和 Unicode 等价输入。
- [建议] `spec.md:46-47,95`：`ATLAS_OWNER_SESSION_SECRET` 已有唯一命名和失败关闭，但没有最低熵/长度、session 版本轮换后的旧 Cookie 失效规则。→ 在部署验收中要求随机生成至少 256-bit signing secret，并让 session version/secret 轮换可明确使旧 Cookie 失效。

## 第 1 轮闭合情况

- D-P04 已不再扩张到写 Worker；D-P05 把 Google egress 放入独立无公开 route、无业务存储/Owner 凭证的 Sidecar，并保留上线前独立安全门。
- raw encrypted Secret 名称、常量时间比较和失败关闭已经统一。
- Geocoding request 与 Matrix element 的两个 8,000/月 hard cap、失败不退款和 Transit 关闭已经可测。
- seed v1 的源、5 条记录、真实 SHA-256，以及 Web/OpenClaw 两个独立切换/回退面已经闭合。
- Login 已明确为 non-modal，相关可访问状态和真实渲染证据已进入验收。
