# 004 OpenClaw × Japan Atlas PoC Catalog Intake 增量规格评审（第 2 轮）

- 日期: 2026-09-13
- 评审方式: subagent
- 结论: 通过

## 发现项

- 无。

## 第 1 轮发现闭环

- 强／弱 identity：只有 namespaced provider stable place ID 或 provider contract 保证一店一 URL 的 namespaced canonical source URL 可以确定性复用，并由 D1 唯一约束保护；名称、地址、坐标邻近、跨 provider 及 provider ID 变化只产生疑似重复候选，owner 明确选择使用已有或仍建新档。测试覆盖同楼不同店、同名不同分店、同址多 POI、provider ID 变化和弱键不合并；首轮严重发现已关闭。
- Catalog 原子提交与恢复：`catalog.intake.confirm` 使用稳定 mutation/item ID，在单个 D1 transaction 中完成 needs_review intake、条件 verified 晋升、强键唯一检查和最终 receipt；闭合结果为 `committed_verified | committed_needs_review | conflict | failed_no_write`。事务失败无可见写，响应丢失按 mutation ID 重放事务内 receipt，没有把两次普通 operation 串联为建档；首轮严重发现已关闭。
- verified 证据：同一允许来源必须同时支持稳定分店 identity、规范名称、精确地址和坐标，所有持久字段有 provenance/checkedAt 且关键来源无冲突；否则 abstain 为 needs_review。每次 provider/字段映射版本变更用固定标注集验收 precision ≥90%、Top-3 recall ≥95%、provenance 100%；已关闭。
- preview TOCTOU：预览绑定 immutable evidence snapshot、digest、version 和 catalog revision；确认时现场重读 provider，并在 publish transaction 中原子重查 revision 与强 identity 唯一占用。变化返回 conflict 和新预览，测试覆盖并发双确认、revision/evidence 变化与 response-lost；已关闭。
- 来源合法性与 SSRF：provider egress 限定登记 HTTPS origin，每次 DNS 与逐跳 redirect 重验，拒绝 credentials、非 HTTPS、loopback、link-local、RFC1918、CGNAT、ULA、metadata 和解析后私网；其他 URL 不触发二次抓取。Write gate 保存版本化 allowlist、字段级读取/持久化/展示清单和条款证据，安全测试逐项覆盖；已关闭。
- Catalog→Visit：复用已有、committed_verified、committed_needs_review 三种分支都明确允许启动 Visit；needs_review 只在 owner 完整 Catalog/深链可见并带待核验标记，不进入 verified-only nearby。Visit start 失败保留 Catalog receipt/item/status，仅重试 Visit 且不重新建档；真实 E2E 覆盖该断点；已关闭。
- 窄工具权限：Agent manifest 只暴露 `catalog.intake.discover` 与 `catalog.intake.confirm`，底层 save/update/promotion 不暴露，阶段门和安全测试要求验证底层 Catalog 写工具不可见；首轮建议已关闭。

## 最终核对

- 当前增量仍遵守现有 `catalog.save_discovered` 只能以 `needs_review` 进入的业务不变量；verified 是 confirm transaction 内经证据门的条件晋升，不允许调用方直接提交 verified AtlasItem。
- 外部评分继续只进入带来源 URL、平台、checkedAt 和可选评论数的 snapshot，不写入 `PlaceAssessment.overallRating`、个人摘要或到访状态。
- Catalog 写能力已纳入 APP-02/AGENT-02 的明确子集、第二阶段 Write gate、独立 coordinator seam、负面安全测试、故障注入、真实 E2E、soak 与来源校准；未发现新的严重或一般问题。
