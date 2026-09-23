# T-04 实机 OpenClaw version 输出增量代码评审

- 日期: 2026-09-13
- 评审方式: subagent
- 固定点: `HEAD df2ec5958e974debca70b27b977662fd75cb7b87`，含当前未跟踪的 Feature 004 artifact
- 范围: OpenClaw host preflight parser、dist、contract test 与 package
- 结论: 通过
- auto-approved: 2026-09-13

## Standards

未发现严重或一般问题。

- `isSupportedOpenClawVersion` 仍锚定完整字符串，格式分支集中且可读；没有引入宽泛版本解析、重复逻辑或额外依赖。
- 内部分隔使用 `[ \t]+`，不会把换行、回车或其他纵向空白误认为单行版本输出；外层 `trim()` 只负责兼容命令正常附带的首尾空白／尾部换行。
- `src/host-preflight.mjs` 与 `dist/host-preflight.mjs` 逐字一致；package tree 与最终 8-file pack 均不含 `.orig`。

## Spec

未发现严重或一般问题。

- 真实 host 输出 `OpenClaw 2026.7.1 (2d2ddc4) — All your chats, one OpenClaw.` 被接受；原有简洁形式 `2026.7.1` 与 `openclaw 2026.7.1` 保持兼容。
- 版本主体仍只能是 `2026.7.1`；可选构建标识只能是括号内 7～40 位十六进制，可选标语只能由单行 em dash 分隔，不能携带内部 CR/LF。
- `2026.7.1-beta.6`、`2026.7.2`、带 hash/标语的 `2026.7.2`、多行 prefix/hash/tagline 均失败关闭。独立扩展探针还确认非法 hash、额外前缀、ASCII hyphen 标语和过短 hash 被拒绝。
- `scripts/host-preflight.mjs` 的 STOP 行为未改变：只有 Node、精确 OpenClaw 版本输出和 SQLite 三项全真才 `ok: true`；其他情况仍以非零状态退出。

## 验证证据

- 通过：OpenClaw package contracts 10/10。
- 通过：独立 parser 正负样例 12/12。
- 通过：package lint。
- 通过：三个 runtime `src`/`dist` 一致性比对。
- 通过：`npm pack --dry-run --json`，7,105 B archive / 19,102 B unpacked，8 个预期文件且无 `.orig`。
- 通过：最终 package tree `.orig` 扫描与 scoped `git diff --check`。
