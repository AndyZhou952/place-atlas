# Agent Add 精简呈现与使用手册规格评审 (第 2 轮)
- 日期: 2026-09-24
- 评审方式: subagent
- 结论: 需修改
## 发现项
- [一般] `Acceptance Criteria` 1–3 与 `Testing Decisions` 的 presenter 精确断言: 候选回复被定义为“以下稳定结构”，但范例中没有 AC2 强制的 Google attribution，因此无法同时精确断言行序和来源呈现。超长时“安全截断可选 presentation”也未指明可被截断的字段、顺序和截断标记，实现可能在不同 adapter 中得到不同候选文本。 → 把 attribution 放入唯一标准范例（每项或全局 footer 二选一），并定义超长时仅可裁减哪些行、裁减优先级、标记与候选/命令完整性规则。
- [一般] `Acceptance Criteria` 8: 1,200 code-point 上限下要“保留最高严重度警告”，但 suspected duplicate、stale evidence 和 provider warning 之间没有闭合优先级或 tie-break；这会让第三方无法判定超长场景是否通过，也可能丢掉比 stale 更影响确认决策的重复项警告。 → 固定警告优先序、同级稳定 tie-break 和被折叠时的 summary 规则，并用四条以上警告的 fixture 验证。
- [一般] `Message Design` 117 与 `Testing Decisions`: 规格声明五态必须在窄屏聊天截图中可扫描，但验证只列了字符串/contract tests，没有要求真实渲染或截图评审。这是用户可感知的手机呈现改动，仅测换行字符不能证明窄屏密度和分组问题已解决。 → 在验收/测试决策中加入真实微信或等价窄屏聊天容器截图评审，至少覆盖三候选、完整 preview、多警告/conflict 和一个 success/failed-no-write 场景，并将评审证据作为可感知改动的交付门。
