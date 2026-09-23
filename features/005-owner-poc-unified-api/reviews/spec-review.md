# 规格评审（第 1 轮）

- 日期: 2026-09-21
- 评审方式: subagent
- 结论: 需修改

## 发现项

- [严重] `spec.md:39-45,91,114-118`：规格把所有业务 `GET/HEAD/OPTIONS` 一概公开，并称这是用户已明确接受的隐私选择，但没有列出实际公开的数据面；按当前 operation 集合，这可能让个人评论、Visit、VisitMedia 及媒体读取也匿名可见。它与 `CONTEXT.md` 对“私有图片”的定义、`product/architecture.md` 的“私密且最小授权”质量属性及 `docs/decisions.md` D-018 的“私人 Journal 笔记与媒体”直接冲突。用户确认的是“未登录不能写、朋友可看前端”，不能据此推导其已逐项同意公开私人笔记和原图。→ 明确匿名读取 allowlist 与字段投影：至少逐项决定 Catalog、PlaceAssessment、Visit、评论、媒体元数据和媒体二进制是否公开；私有项默认要求 Owner session。若确要公开个人内容，先把每类暴露及风险交由用户明确确认并更新 CONTEXT/ADR，再写可判定的授权负面测试。
- [严重] `spec.md:18,67-68,92`：规格把 feature 004 的 Google fixed-endpoint 方案描述成 owner-poc 可直接使用的“已经批准”能力，但 `docs/decisions.md` D-P04 明确把例外限制在“隔离的只读 Nearby PoC”，并把“超出隔离只读 PoC”列为必须关闭 transport、重新比较方案的重审条件。本特性把 Web 写入、Owner session、私人 D1/R2 与 Google egress 合在同一 Worker，已经命中该条件。→ 在规格中把 Google 上线列为新安全决策门：要么继续把 Google egress 保持在独立只读信任区并只返回闭合路线结果，要么对写能力同部署的 owner-poc 重新完成威胁模型、独立评审和 ADR 接受；完成前真实 Google composition 必须 fail closed，不能沿用 D-P04 的“已批准”措辞。
- [一般] `spec.md:44,90` 与 `product/assumptions.md:A-33`：用户只要求简单单密码登录并由项目配置密码；“只以不可逆 verifier 存于 Secret”是新增安全实现选择，却被台账标成用户已确认。规格也没有定义 verifier 的格式、算法版本、salt/work factor、生成/轮换流程和 Worker 验证兼容性，无法验收；当前实现方向使用的是 Cloudflare encrypted Secret 中的原始密码，二者不兼容。→ 在两种闭合方案中明确选一：若使用 encrypted Secret 原始密码，修正 A-33/规格并要求常量时间比较、永不记录/回显和上线前轮换；若坚持 verifier，定义版本化 KDF 契约、离线生成与 Secret 注入步骤、参数升级和测试 fixture。Secret 名称也必须成为唯一部署契约。
- [一般] `spec.md:30,68,75,108`：Google “月度 hard cap”没有可判定的数值、计量单位或 SKU 边界。Geocoding 以请求计费，Route Matrix 以 origin×destination element 计费；只数 HTTP 请求会把一个多 destination matrix 严重低计。规格也没有定义应用门与 Google Cloud quota 哪个值、如何证明均已生效。→ 为 Geocoding、Route Matrix elements 和 Transit Routes 分别写明 owner-poc 的配置上限（或统一的保守 micro-USD 上限及换算表），规定调用前原子预留实际 billable units、失败不退款、达到任一门后零 egress，并把 Cloud quota 的读取证据纳入部署 gate。
- [一般] `spec.md:57-60,87,105-110`：稳定 mutation ID、payload digest 与可重放 receipt 只约束未来 Agent mutation；Web 写入仅靠 Cookie，未规定同样的稳定操作标识、冲突或 response-lost 重试行为。这与 `product/architecture.md:76` 和 D-008 的“所有写入”幂等/审计要求冲突，也削弱“两个入口执行同一 Application Operation”的目标。→ 为 Web 和 Agent 定义共同的 mutation envelope/receipt 语义；凭证可停留在 adapter，但经过验证的 actor、稳定 operation ID 与 canonical digest 必须进入统一写入用例。增加浏览器重复提交、丢失响应后重试及同 ID 异 payload 冲突测试。
- [一般] `spec.md:74-76,92,107`：蓝绿验收只说“完整 migration”“seed 通过 migration”和“切换用户入口”，未定义 seed 的规范 artifact/count/digest，也没有区分网页 URL/route 与 Lightsail OpenClaw endpoint/HMAC 两个独立切换面。因此第三方无法判断何时已完成等价 seed、何时可切换、失败时哪一个入口应回退。→ 明确空库基线 migration 的固定点与 seed manifest/checksum，分别列出 Web 与 Agent 的 preflight、切换顺序、凭证轮换和 rollback probe；说明回退旧只读 URL 是功能降级且新库写入不会被反向迁移。
- [建议] `spec.md:95-101,109`：Login 被描述为“Owner 区域/对话层”，但没有明确它是否为 modal；若是 modal，当前 UI 条款遗漏 focus trap、Escape 关闭、关闭后回焦、表单错误 `aria-describedby/aria-invalid` 等 hf-ui-design 基线。→ 在 UI 规格中选定非 modal 区域或 modal 对话框；若为 modal，将上述键盘与辅助技术行为加入验收和真实截图/交互证据。
