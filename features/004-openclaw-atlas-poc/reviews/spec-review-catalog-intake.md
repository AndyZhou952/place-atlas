# 004 OpenClaw × Japan Atlas PoC Catalog Intake 增量规格评审（第 1 轮）

- 日期: 2026-09-13
- 评审方式: subagent
- 结论: 需修改

## 发现项

- [严重] `spec.md:75,77,83,139,142`: 查重把 provider place ID、来源 URL、名称＋地址和“坐标邻近”依次列为命中键，却没有区分强同一性证据与只能产生疑似重复候选的弱证据，也没有定义 provider namespace、URL 规范化或坐标半径。同一商场／酒店／车站内的不同餐厅可能共享地址和相近坐标，同名品牌也可能在同楼有多店；按当前文字实现可以在没有用户确认的情况下把新分店静默合并到错误 AtlasItem。→ 只有 namespaced provider place ID 或能证明同一实体的 canonical source identity 才允许确定性复用；名称＋地址、坐标邻近及跨 provider 匹配只能返回 duplicate candidates，展示双方分店证据并由 owner 选择“使用已有／仍建新档”。冻结规范化、tie/冲突和禁止合并规则，并增加同楼不同店、同名不同分店、provider ID 变化及相同地址多 POI 的负面 fixture。
- [严重] `spec.md:80-82,122,139,142`: 规格要求新候选先通过现有 `catalog.save_discovered` 保存为 `needs_review`，随后再由验证操作晋升 `verified`，但没有定义这两个持久步骤的单次 mutation 可见性、原子/恢复边界。若 `needs_review` 已保存而 promotion、receipt 或响应失败，调用方可能收到失败却留下一个地点；重试又可能在查重处把它当“已有地点”直接返回，无法判定应继续晋升、重放 receipt 还是永久停在半完成状态。这与测试宣称的 Catalog staging/publish 零丢失、零半可见不闭合。→ 为 Catalog intake 定义与 capture 同等级的 externally observable commit protocol：稳定 item/mutation ID、不可见 staging 或明确可接受的 `needs_review` committed 终态、promotion 的条件写、`recovery_required/abandoned`（如适用）、响应丢失 replay，以及每个失败点的唯一 receipt；不得把两次普通 operation 串联冒充一个原子建档。
- [一般] `spec.md:78-80,139` 与 `docs/decisions.md:D-006`: `verified` 晋升只要求规范地址/坐标、任意一个“允许的事实来源”、digest 和 owner 确认，但没有要求来源实际支持“精确分店身份”，也没有定义冲突证据、字段级 provenance、允许 abstain 或 precision 校准集。一个只支持品牌名或外部评分的来源也会满足当前门槛，却不能证明该地址对应这家分店；“证据完整 verified”因此不可判定，也不足以支撑既有精确分店 precision ≥90% 目标。→ 冻结 verified identity evidence 的最小集合和字段对应关系（至少来源支持的规范名称＋精确地址/稳定 place identity，坐标一致，关键来源无冲突，字段级 checkedAt/provenance 完整），冲突或缺项必须保持 `needs_review/abstain`；用标注校准集验收 precision、Top-3 recall 与 provenance 完整率，而不是只测一条“证据完整”样例。
- [一般] `spec.md:75,77,81,139,142`: candidate ID、preview version 和 evidence digest 已防止把重新搜索后的第 N 项当成原候选，但确认写入没有绑定初次查重的 catalog revision，也没有要求在最终 publish 的同一原子边界重新执行强/弱重复检查。预览之后 Web、重投请求或另一 session 新建同一分店时，两个确认都可能各自成功，形成重复地点；provider 变化使 preview 失效也没有说明通过 snapshot version 比较还是确认时重新抓取来判定。→ 将 preview 绑定 immutable evidence snapshot、有效期和 catalog revision；确认时以 candidate/evidence/preview version 做条件写，并在 publish 内原子重查唯一强 identity。revision/evidence 已变化返回 `conflict` 和新预览，不得自动套用旧确认；补并发双确认、过期预览、来源撤回/字段变化和 response-lost 测试。
- [一般] `spec.md:76,78-79,83,140,161`: 规格说 provider 由服务端控制、测试“任意 URL 注入”，但没有给出 URL/redirect/egress 的可判定拒绝规则，也没有要求 Write gate 保存供应商使用条款与可持久化字段的合规证据。恶意 provider 字段、重定向、DNS rebinding、私网/metadata 地址或带凭证 URL 仍可能被 fetch、持久化或作为深链交给用户。→ 明确只允许登记 provider adapter 主动访问 allowlisted HTTPS origin；逐跳校验 redirect，拒绝 credential、非 HTTPS、loopback、link-local、RFC1918/ULA、metadata 和解析后私网地址，用户/模型/provider 返回的任意 URL 只能作为经规范化验证的数据且不得触发二次抓取；把域名 allowlist、字段许可/留存条款和 SSRF fixture 纳入 discovery adapter contract 与 Write gate。
- [一般] `spec.md:82,124,139,142,144-146`: Catalog 与 Visit 被声明为两个独立 mutation，但没有定义 Catalog 成功后 VisitCaptureSession 创建失败时的用户回执和安全重试，也没有说明 `needs_review` item 是否允许承载 Visit、能否通过地图深链读取，或必须等到 verified 才能继续。用户可能看到“建档失败”但地点其实已存在，或成功记录 Visit 后却在默认地图找不到其 `needs_review` 地点。→ 明确三种分支的外部行为：复用已有 item、创建并 verified、创建但保持 needs_review；对每种规定是否允许启动 Visit。若 Catalog committed 而 Visit start 失败，必须保留并展示 Catalog receipt/item ID，返回可重试的 Visit-only 动作，重试不得再次建档；若 needs_review 不可用于 Visit，则明确阻断原因和后续审核动作。补两个 mutation 间断线/重启及 needs_review 可见性 E2E。
- [建议] `spec.md:54,80-82,122`: “Catalog write scope”仍较宽，容易让 Agent credential 获得现有通用 `catalog.update_item` 或绕开 preview 的保存/晋升能力。→ 将 tool manifest 和服务端 scope 收窄为 discovery read、intake confirm-create、verify-promotion 等独立能力；`catalog.save_discovered`、通用 update 和 verification operation 不直接暴露给模型，只由 coordinator 在版本/证据/确认检查后调用。

## 已满足项

- 现有代码事实已核对：`catalog.save_discovered` 的核心校验明确拒绝 `verificationStatus !== needs_review`；增量规格没有要求直接以该 operation 写入 verified，而是提出独立验证晋升，方向与既有入口不变量一致。
- 外部评分已明确写入带平台来源 URL、`checkedAt` 和可选评论数的 snapshot，禁止写入 `PlaceAssessment.overallRating`、个人摘要或到访状态；个人/外部评分隔离要求充分。
- 新增范围已进入第二阶段 write credential、APP-02 Catalog 子集、AGENT-02 服务子集、独立 coordinator seam、Catalog intake/安全/幂等/真实 E2E/soak 测试清单；门和测试位置完整，但须先补齐上述可判定行为才能通过。
