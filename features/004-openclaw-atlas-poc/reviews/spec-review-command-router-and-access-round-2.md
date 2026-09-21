# 004 OpenClaw × Japan Atlas PoC 命令路由与到店可用性增量规格评审（第 2 轮）

- 日期: 2026-09-13
- 评审方式: subagent
- 结论: 需修改（fail）

## 发现项

- [一般] `spec.md:67,70-71,155,164` 与 `feature.md:44,54`：capability gate 关闭时，bare alias 与命令防火墙的外部结果仍未闭合。第 67 行规定探针失败就不注册 `before_agent_reply` alias plugin；此时规格没有另一个已定义的模型前机制来拦截裸 `jpmap ...` 或 `jpmapx ...`。即使探针通过，第 71 行又规定 native plugin “只 claim”严格匹配的 alias，而第 70 行要求命令防火墙 claim `jpmapx` 一类相似前缀并固定回复、绝不进入模型。因而第三方仍无法同时满足“plugin 不注册／只 claim 精确 alias”和“相似裸前缀模型调用为零”；`feature.md:54` 的零模型验收也没有按 gate 状态区分。→ 增加 capability gate × 输入类别的闭合矩阵。若在 gate 关闭时仍要求裸命令及相似前缀零模型，必须保留一个独立于该 alias hook、且经真实 AWS＋微信证据验证的前置 command firewall；若做不到，则应明确 gate 关闭时这些输入只按普通助手文本处理但不获得任何项目凭证／工具，并同步收窄零模型验收。gate 开启时也要明确 plugin 可以 claim 严格 alias **和**疑似命令防火墙结果，而普通聊天不 claim。不能在 hook 未注册时承诺由它“只提示使用 `/jpmap`”。
- [建议] `spec.md:70`：命令防火墙写成拦截“所有未知 slash 命令”，但没有说明 OpenClaw 自带／保留的 slash 命令是在进入 `ProjectCommandRouter` 前已被平台消费，还是作为已登记非项目命令优先处理。架构阶段应冻结这一边界并加一项平台保留命令测试，避免 `/help`、`/status` 等合法运行时命令被误映射成项目帮助；这不影响本轮其余项目隔离结论。

## 已关闭的首轮发现

- 首轮严重项已关闭：无斜杠 alias 已降为 capability-gated 便利功能；版本变化、证据缺失或探针失败均不启用。规范 `/jpmap` 也没有仅凭 OpenClaw 接口存在就宣称可用，而是要求在实际 AWS 版本＋腾讯微信 gateway 保存版本、commit、配置及零模型调用 trace 后才通过 Read-only gate。`feature.md:25` 与 `progress.md:22` 只陈述已安装接口，不再把 2026.7.1 的 ordinary-turn hook 行为当作已保证。
- 分流顺序与 capture 主状态已基本闭合：规范项目命令、已启用 alias、其他项目命令、命令防火墙、capture 内容和普通助手的优先级明确；其他项目命令不会改变 Atlas capture 状态或计时。剩余问题仅是上述 gate 关闭时裸输入／相似前缀缺少可实现的前模型路径。
- `add` 语法已拆成“全部剩余文字作为名称”和带双引号的 `--name`／`--near` 形式；大小写、Unicode、允许的转义、未知／重复 flag、空值、未闭合引号、缺参和控制命令尾随参数都有确定的 `invalid_input` 结果，且测试要求输入→结果表。
- `ready_to_commit` 已与 router 统一为显式恢复：普通文字／图片返回 `resume_required` 且不入草稿，只有 `record resume` 成功后才恢复并使旧 preview version 失效。
- `EntryAccessSnapshot` 已拆成独立的 walk-in assertion 与 queue assertion；queue 明确区分 `none_reported | waiting_reported | unknown`，等待时间可缺失且语义明确，每个 assertion 各有 source URL、`checkedAt` 和 warning，一项失败不会覆盖另一项。
- `EntryAccessProvider` 已与 PlaceDiscoveryProvider 共用 HTTPS origin、逐次 DNS／逐跳 redirect、私网／metadata 拒绝、credential scope、字段 allowlist 与条款证据门；长期留存也收窄到 assertion 状态、来源、时间、warning 和可选等待分钟数，供应商正文及其他动态字段禁止持久化。
- 电车扩展层继续以无需换乘、门到门总行程 `≤20 分钟` 为包含式硬边界；测试已明确固定“20:00 通过、20:01 拒绝”，并与 `A-21` 及 feature 目标一致。

## 结论说明

本轮七个重点中的语法、capture、EntryAccess、安全门和 20 分钟边界均已达到可验收程度，OpenClaw 2026.7.1 也已正确降级为“接口存在但真实渠道行为待验证”。由于 capability gate 关闭／开启两种情况下，bare 相似前缀的 claim 机制与零模型验收仍互相矛盾，规格暂不能通过；关闭上述一项一般 finding 后可再次复审。
