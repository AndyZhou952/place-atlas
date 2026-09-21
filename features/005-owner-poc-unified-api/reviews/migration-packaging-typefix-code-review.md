# Migration Packaging 类型修复代码评审（第 1 轮）

- 日期: 2026-09-21
- 评审方式: subagent
- 固定点: `e7b4e06f36dc829edce0456869ae866acae076f3`
- 被评快照: 固定点加当前未提交工作区；`HEAD` 仍等于固定点，本轮仅评审 `apps/web/scripts/migration-packaging.ts`
- 结论: 通过

## Standards

未发现严重、一般或建议问题。

- `migration-packaging.ts:49-62,113-160` 只把二进制读取与比较的静态类型从 `Buffer` 收窄为运行时同样可接受的 `Uint8Array`，并以长度加逐索引值比较替代 `Buffer.equals`；hash 仍把相同字节序列交给 Node `createHash`。
- `migration-packaging.ts:81-90,136-149` 将 manifest 的文本读取与 pending reset 的二进制读取分开。manifest 仍按 UTF-8 解码后交给 `JSON.parse`，缺失文件的稳定错误保持不变；pending SQL 没有经过文本解码。
- 改动局限在单一 migration packaging module，没有新增依赖、重复规则、投机抽象或跨模块耦合；格式化差异符合当前 `oxfmt` 输出。
- 评审者用空输入、共享底层 buffer 的切片、任意二进制、非 ASCII 与无效 UTF-8 执行旧/新逻辑差分；4,016 组 byte equality/hash 比较及 4 组 JSON 解码结果完全一致。

## Spec

Feature 005 的 `spec.md` 没有这项类型兼容修复的直接行为要求，因此本轴不把它计作 Feature 005 ticket 或验收项完成。可适用的既有规格是 `features/003-production-snapshot/spec.md` 的 migration bootstrap 约束：pending reset 必须保持原始字节与已审核 SHA-256，reset-stage active 0004 必须与 pending artifact 逐字节相同，snapshot-only membership 与 retired Site version gate 必须继续失败关闭。

本轮实现忠实保持上述既有行为：

- 相关四个测试文件共 5 个测试全部通过，覆盖 snapshot-only 精确 membership、reset-stage 未就绪拒绝、retired version 拒绝、相同 reset bytes 接受及任一字节差异拒绝。
- `npm run migration:check` 通过；pending reset 的实际 SHA-256 与 manifest 均为 `c79819304252399ae9d4e5c74c46bca33f3c0b259655173749b812e4e4ad8e16`。
- 本轮没有修改 migration、manifest、checksum、Site version denylist 或任何部署行为，未发现规格范围蔓延。

## 验证证据

- `git rev-parse e7b4e06` 与 `git rev-parse HEAD`：均为 `e7b4e06f36dc829edce0456869ae866acae076f3`；完整读取 `git diff e7b4e06 -- apps/web/scripts/migration-packaging.ts`。
- `node --experimental-strip-types --test scripts/migration-packaging.test.mjs scripts/migration-packaging-site-version.test.mjs scripts/migration-packaging-reset-stage.test.mjs scripts/migration-packaging-reset-stage-mismatch.test.mjs`：5/5 通过，0 failure。
- `npm run typecheck`：通过。
- `npx oxlint scripts/migration-packaging.ts`：通过。
- `npx oxfmt --check scripts/migration-packaging.ts`：通过。
- `git diff --check e7b4e06 -- apps/web/scripts/migration-packaging.ts`：通过。
- `npm run migration:check` 与独立 `sha256sum`/manifest digest 比对：通过。
- 运行时差分探针：4,016 组 byte equality/hash 与 4 组 JSON decoding 边界全部等价。
