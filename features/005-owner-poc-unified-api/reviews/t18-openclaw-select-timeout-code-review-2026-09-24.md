# T-18 OpenClaw Add select timeout code review（第 1 轮）

- 日期: 2026-09-24
- 评审方式: subagent
- 固定点: `origin/main`（当前 `HEAD` 与该固定点相同；评审对象为未提交的插件差异）
- 结论: 通过

## Standards

- 独立冷读了完整未提交差异、T-18 任务票、相关 feature 规格与架构，以及既有 T-18 代码／安全评审。
- 超时策略集中在 `defaultAddTimeoutMsByTool`，名称表达清晰；没有引入跨层耦合、动态 endpoint、凭证明文或额外模型／网络能力。
- `src/jpmap-client.mjs` 和 `dist/jpmap-client.mjs` 内容一致；构建后 SHA-256 相同。`package.json` 与 `openclaw.plugin.json` 均为 `0.3.1`，且 `npm pack --dry-run` 仅包含声明的八个发布文件，未包含 source、tests、`.orig` 或凭证。
- 检查了当前补丁范围和 `git diff --check`；补丁只涉及 OpenClaw 插件的超时、固定回复、版本、README 和对应契约测试，没有泄露 secret 或不相关的已跟踪变更。
- 当前 worktree 另有三个未跟踪 `.orig` 文件（`apps/web/scripts/migration-packaging.ts.orig`、`features/004-openclaw-atlas-poc/progress.md.orig`、`features/004-openclaw-atlas-poc/spec.md.orig`）；它们在本轮评审前已存在，且不属于本补丁或发布包。

### 验证

- `node --test test/jpmap-plugin.contract.test.mjs`：通过。
- `npm run lint`：通过。
- `npm run build`：通过。
- `npm pack --dry-run`：通过（使用 `/tmp` npm cache；发布清单为八个预期文件）。
- 未将 package-wide `npm test` 作为本轮绿色门。尝试该命令时，未变更的 `jpmap-hardening.contract.test.mjs` 在本 sandbox 的嵌套 spawn staging 子进程中取得空 stdout，继而 JSON parse 失败；直接运行显示仅其 shipped-preflight staging 子测试受影响。手工 staged invocation 正常输出有效 JSON。这是已知 sandbox-only nested-spawn gap，而非本补丁回归。

## Spec

- `nearby` 默认保留 4 秒读操作上限。
- `jpmap_add_discover`、`jpmap_add_confirm` 和 `jpmap_add_cancel` 各为 30 秒；`jpmap_add_select` 为 45 秒，覆盖有界 35 秒 initial provider phase 与协调余量。
- 显式 `timeoutMs` 以 nullish override 保留，未被操作默认值覆盖。
- Add 的 HTTP、畸形回复及 timeout 失败均使用固定的 Add-specific unavailable 回复；Nearby 仍使用原有 Nearby 固定回复。
- mock-timer 测试在 fetch 开始后推进至 35,001ms 并断言 signal 未 abort；旧的全局 4 秒实现会在该断言前 abort，故该测试确实能捕获原微信 `/jpmap add select` timeout 回归。

## 发现项

- 严重: 0
- 一般: 0
- 建议: 0
