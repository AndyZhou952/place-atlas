# T-12 Reset migration 与维护工具代码评审（第 4 轮）

- 日期: 2026-09-12
- 评审方式: 独立 subagent
- 固定快照: baseline `3cca6732a3ad4d5d96d44ef76ccffa1a8f789331` + 当前完整 working-tree fixed snapshot（含 untracked 文件）
- 结论: 通过

## 验证证据

- 已重新冷读 T-12 safe-file primitive、verifier/evidence v2、维护 CLI、migration、测试与 runbook；未修改实现、任务票或进度，也未连接或执行任何远程/生产资源。
- 第 3 轮 TOCTOU finding 已关闭。R2 manifest 与 evidence JSON 均经同一 `O_NOFOLLOW` descriptor 执行 preflight `fstat/path` 复核、descriptor read、post-read `fstat/path` 复核；device、inode、link count、mode、size、ctime 或 mtime 任一改变都会失败。`captureResetEvidence` 和 `readResetEvidence` 共用该 primitive。
- D1 经一个 read-only `DatabaseSync` 连接执行 `BEGIN`，以首次 `sqlite_schema` 查询固定 read snapshot，再在同一事务生成完整快照；守护 descriptor 与原路径在读取前、读取后、`COMMIT` 后均比对完整 signature。`captureResetEvidence` 与 `dryRunAssessmentReset` 共用该 D1 primitive；rehearse 的 before copy 经稳定来源检查，前后 evidence 也走相同安全读取。
- 作者真实负例确定性覆盖 R2/D1 在读取期间的 atomic replace、truncate、append 与新增 hard-link alias，并覆盖 capture/rehearse 的 `nlink != 1`、symlink 及普通文件正例。独立并发探针在 R2 descriptor 已打开后由另一进程执行原子 rename replace，capture 失败关闭且未生成 evidence；第 3 轮旧的“旧 inode + 新内容仍获接受”路径不可复现。
- evidence v2 仍以 device + inode 拒绝不同路径的同物理 D1/R2 文件；普通 copy 的独立 inode 正常通过。序列化 evidence 只含 path hash，不含绝对路径明文。runbook 明确内容/evidence hash 只用于离线发现篡改或误配，不宣称远端认证或数字签名。
- 完整 `sqlite_schema` table/index（含 `sqlite_autoindex_*` identity）/trigger/view、所有表/列/行、R2 full-key manifest、raw snapshot 拒绝、phase/maintenance/capture/source/pairing/content hash 关系、严格 CLI 与无远端模式均保持通过。
- `0003_reset_test_place_assessments.sql` 仍只重置 `overall_rating/is_favorite/has_visited/summary`，`WHERE` 精确且不改时间戳或其他 D1/R2 内容；真实 fixture 证明二次幂等，既有 Visit 仍推导有效到访。Drizzle snapshot/journal 与 T-14 前禁部署、冻结/备份/回退 runbook 无回归。
- 定向测试：21/21 通过。完整门禁：`format:check`、`lint`、`typecheck`、全量测试 175/175、`build` 与 `git diff --check 3cca673` 全部通过；build 仅出现既有 Leaflet 图片解析警告。

## Standards

- 无发现项。高风险本地维护的路径、真实文件身份、稳定读取、事务快照、证据配对与参数拒绝集中在共享 primitive，失败路径关闭且未引入远端/生产能力；未发现未关闭的重复实现、消息链或范围外抽象。

## Spec

- 无发现项。完整 D1/R2 封闭白名单、四字段 reset、时间戳与其余数据保持、幂等、Visit 推导、证据独立性与防误配、TOCTOU fail-closed、严格本地 rehearsal 及 runbook 均符合已确认规格、架构与 T-12 验收。
