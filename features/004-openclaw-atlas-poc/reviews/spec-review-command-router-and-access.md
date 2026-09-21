# 004 OpenClaw × Japan Atlas PoC 命令路由与到店可用性增量规格评审（第 1 轮）

- 日期: 2026-09-13
- 评审方式: subagent
- 结论: 需修改（fail）

## 发现项

- [严重] `feature.md:25`、`progress.md:22`、`spec.md:66-67,153,162,169`: 规格把 AWS OpenClaw `2026.7.1` 的 `before_agent_reply` 普通用户回合 claim 写成“已验证保证”，但仓库没有保存版本/配置/微信入站路径/零模型调用的复验工件；更关键的是 OpenClaw 官方仓库针对 **2026.7.1** 的已复现缺陷明确记录：ordinary user-triggered embedded/CLI turns 可能跳过该 hook，消息随后进入模型。此时 hook 根本没有运行，插件无法执行规格所称的“hook 不可用时失败关闭”，bare `jpmap` 别名可能把写命令交给模型，直接破坏模型前授权与状态选择的安全前提。官方当前文档只证明 `before_agent_reply` 的目标 contract，不证明已安装 2026.7.1 的腾讯微信执行路径没有该缺陷。→ `/jpmap` direct tool dispatch 可保留为规范路径；无斜杠别名必须降为 capability-gated 可选路径：架构阶段在实际 AWS 版本＋腾讯微信 gateway 上用 provider-call counter 证明匹配、歧义、非匹配、普通文本、重启后每种路径的 hook 次数与模型调用为零，并保存版本/commit/config/trace 证据。探针失败或证据缺失时不得注册别名，必须只提示使用 `/jpmap`；或者升级/固定到包含已验证修复的版本后重新验收。删除“2026.7.1 已保证”的事实性措辞。依据：[OpenClaw 2026.7.1 hook 缺陷记录](https://github.com/openclaw/openclaw/issues/108349)、[当前 hook contract](https://github.com/openclaw/openclaw/blob/main/docs/concepts/agent-loop.md)。
- [一般] `spec.md:67,69-70,162` 与 `feature.md:54`: 非严格前缀的外部结果不闭合。第 67 行说“消息并非严格前缀”时 native plugin 失败关闭并提示 `/jpmap`，按字面会认领所有普通聊天和 active-capture 内容；第 70 行又要求普通文字/图片进入 Atlas 草稿。另一方面，只规定“已登记项目命令”优先，未说明 `/gymm`、`jpmapx`、未知 slash 命令或相似前缀在 active capture 时是否被当作评价正文，而 feature 验收要求它们不得触发 Atlas 写入。→ 冻结模型前分流优先级表：规范项目命令、严格 alias、已登记其他项目命令、疑似/未知命令、active-capture 普通内容、普通助手消息；明确 native plugin 只 claim 严格 alias，不匹配时不 claim，但疑似项目命令由独立命令防火墙返回固定帮助且绝不进 Atlas 草稿。为 active/paused/ready/无 capture 分别断言模型调用和状态变化。
- [一般] `spec.md:68-69,162`: 闭合语法仍无法确定性解析 `add <餐厅名> [位置提示]`：餐厅名和可选位置都是可含空格的自由文本，仅做连续空白规范化时没有分隔点，因此 `add 银座 八五 银座` 无法唯一判断名称与位置；“多余控制参数”也没有可判定定义。大小写策略只列在测试主题中，正文没有规定 `/JPMAP`、`JpMap` 是否接受。→ 给出供应商无关的形式语法，例如 `add <name>` 与 `add <name> --near <location>`，定义引号/转义、Unicode、大小写、参数结束符和空值；未知 flag、重复 flag、尾随参数必须有唯一 `invalid_input` 结果。测试使用明确输入→输出表，而非只写“大小写／空白策略”。
- [一般] `spec.md:70` 与既有 `spec.md:117,133`: router 新规则要求 `record end` 后普通内容不再追加，必须先 `record resume`；既有 capture 状态规则却规定 `ready_to_commit` 收到新文字/图片时直接写入草稿、使 preview 失效并自动回到 `capturing`。同一输入因此同时应“拒绝追加”与“追加并恢复”，第三方无法判断通过结果。→ 选择一个用户行为并统一两处状态机、命令文案和测试。若坚持显式 resume，`ready_to_commit` 普通内容应返回 `resume_required` 且不入草稿；若允许自动补充，则删除 router 的显式 resume 前置要求并返回更新后的 draft/preview version。
- [一般] `spec.md:84-85,155,163`: `EntryAccessSnapshot.queue` 只有 `live_reported | unknown`，却没有字段表达来源明确报告“当前无需排队”和“当前正在排队但等待分钟未知”的区别；`live_reported` 加可选分钟数无法让用户或测试唯一判断它代表零队列还是未知时长队列。此外 snapshot 只有一个来源 URL/`checkedAt`，而 walk-in 和 queue 很可能由不同来源、不同时间支持，无法证明每个结论的 provenance。→ 将 walk-in 与 queue 建模为各自的 source assertion；queue 至少闭合区分 `none_reported | waiting_reported | unknown`（waiting 可选分钟数），每项各带 source URL、checkedAt、状态与 warning。明确来源说“营业中／可预约”仍不能推导 no queue 或 walk-in，并增加明确无队、排队但时长未知、两字段不同来源及一项失败另一项成功的测试。
- [一般] `spec.md:84,155,163,165` 与 `spec.md:93-95`: 新 `EntryAccessProvider` 会在每次推荐现场取得动态外部事实，但 Catalog discovery 已有的 HTTPS origin、逐跳 redirect、DNS/private/metadata 防护、字段条款 allowlist 只明确约束 `PlaceDiscoveryProvider`；阶段门和安全测试也没有明确证明 EntryAccess egress/字段保留遵守同一控制。→ 将 EntryAccessProvider 明确纳入统一 provider egress 与字段级读取/展示/持久化条款 gate；若 snapshot 仅瞬时展示也要规定可持久化的审计最小值与禁止留存字段。对该 adapter 独立运行 credential、redirect、DNS rebinding、私网/metadata、未登记域名/字段和供应商正文脱敏测试。
- [建议] `spec.md:82,163,188`、`product/assumptions.md:A-21`: 无需换乘电车的门到门总行程 `≤20 分钟` 已明确为包含边界的硬条件，且用户确认、测试和进度记录一致；未发现该修改与 fresh route 证据或首层无结果才扩展的规则冲突。→ 架构阶段只需确保 RouteProvider 的“门到门”明确包含起终点步行、等车和乘车时间，并以恰好 20:00 通过、20:01 拒绝的 fixture 固定边界。

## 已满足项

- `/jpmap` 规范入口使用 user-invocable skill 的 direct tool dispatch、raw arguments 和禁用模型调用，能力形状与 OpenClaw 官方技能文档一致；但仍须在实际腾讯微信路径做版本化验收，不能仅凭最新文档外推到已安装版本。[OpenClaw skill direct-dispatch 文档](https://docs.openclaw.ai/tools/creating-skills)
- registry 已要求 project ID、schema、adapter、独立凭证、tool allowlist、状态前缀和审计标签，并要求模型只在项目与权限收窄后参与字段抽取；服务端 Atlas credential/scope 仍是最终安全边界，方向正确。
- walk-in 不允许由“可预约”、营业中或模型判断推导，来源失败映射 unknown 且不删除候选；动态事实带核验时间，基本 unknown/fail-closed 语义正确。
