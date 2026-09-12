# Japan Atlas 数据维护手册

最后更新：2026-09-12

本手册定义 PlaceAssessment 测试状态 reset 的 dry-run、验证、本地副本演练和回退流程。当前 T-12 **只生成并测试工具，不执行生产变更**；生产维护必须等 T-14 独立代码门通过、写入冻结窗口确定并再次取得用户批准。

包含 `0003_reset_test_place_assessments` 的构建产物在 T-14 之前不得部署到生产；本地 build／CI 不会执行 migration，但任何会自动应用 D1 migration 的发布流程都属于生产维护。

当前代码收缩状态：所有生产 HTTP 读写已切换到唯一 `AtlasApplication` composition，旧 `atlas-store`、`media-store` 及其重复 SQL／媒体规则 helper 已删除；架构适应度测试会阻止 route 重新直连存储或恢复第二 writer。这个状态只表示代码切换已准备好，不表示 `0003` 已执行、生产数据已 reset 或 T-14 已获批准。

## 1. Reset 边界

唯一允许变化的是 `place_assessments` 的四个测试状态字段：

| 字段 | Reset 后值 |
|---|---|
| `overall_rating` | `NULL` |
| `is_favorite` | `0` |
| `has_visited`（adapter 中解释为 `manualVisited`） | `0` |
| `summary` | `NULL` |

以下内容必须逐项保持：所有表与记录集合、`created_at`／`updated_at`、AtlasItem 与 override、Visit、VisitMedia metadata、ImportJob、tombstone、旧 `journal_entries`，以及完整 R2 object-key manifest。已有 Visit 的地点在 reset 后仍由 `存在 Visit OR manualVisited` 推导为 `行った`。

Migration [`0003_reset_test_place_assessments.sql`](../apps/web/drizzle/0003_reset_test_place_assessments.sql) 不可修改；未来变化必须新增 migration。

## 2. 工具安全约束

维护命令只接受严格白名单中的本地参数，没有远端或生产模式，也不读取 Cloudflare credential。未知参数、重复参数、缺值、多余位置参数，以及包含 `remote`、`production` 或 `cloudflare` 的任何参数都会在打开文件之前被拒绝。无参数时默认拒绝执行：

```bash
cd apps/web
npm run maintenance:assessment-reset
```

`dry-run` 以只读方式打开本地文件。真正执行 migration 的 `rehearse` 要求两份不同的本地 D1 文件和两份不同的 R2 manifest：before 必须是只读来源，after 必须是尚不存在的新目标；两个 D1 文件都必须以 `.snapshot.sqlite` 结尾。所有证据来源均须为普通文件，符号链接与仍存在其他文件系统别名的 hard link 都会被拒绝。工具先创建普通 copy 作为 after，绝不在 before 上执行 migration。

证据读取采用失败关闭的一致性检查。R2 manifest 与 evidence JSON 通过禁止跟随符号链接的同一已打开文件描述符执行 `fstat → read → fstat`，文件身份来自该描述符；D1 则在同一个只读 SQLite 连接和读事务中生成完整快照，同时用已打开文件描述符及原路径在读取前后复核身份。device、inode、link count、mode、size、ctime 或 mtime 任一变化，或原路径不再指向同一普通文件，都会中止操作。因而读取期间发生的原子替换、截断、追加或新增 hard-link alias 都不能生成证据。

完整 D1 snapshot 除所有表、字段和记录外，还规范化保存 `sqlite_schema` 中每个非内部 table、index、trigger、view 的类型、名称、归属表和 SQL。任一对象新增、删除或修改都会使验证失败。

## 3. Dry-run

先复制已导出的 D1 snapshot，再只读检查将受影响的 PlaceAssessment 数量和完整 D1 快照：

```bash
cd apps/web
npm run maintenance:assessment-reset -- dry-run \
  --database-copy /tmp/japan-atlas-before.sqlite
```

此命令不得改变文件。保存输出作为维护证据，但不要把私人行程、评分或笔记提交到 Git。

## 4. 生成可审计证据

R2 manifest 是排序无关的 JSON 字符串数组，例如：

```json
["visits/...", "sources/..."]
```

每个证据包同时包含 D1 snapshot 与 R2 manifest，并保存以下最小关联信息：同一维护批次 ID、单次捕获 ID、`before`／`after` 阶段、来源范围、捕获时间、可序列化的文件身份（device + inode，并附不泄露绝对路径的 path hash、size、ctime 供诊断）、内容哈希和证据哈希。验证以 device + inode 识别真实文件，不能用不同路径或 hard-link alias 冒充独立来源；普通 copy 具有独立 inode，可以作为 after。哈希用于离线发现篡改或误配，不是远端认证或数字签名；证据文件仍应按敏感备份保护。

序列化证据只保存 path hash，不保存 D1、R2 manifest 或 evidence 文件的绝对路径。`capture`、`rehearse` 的来源复制与捕获，以及 `verify` 对证据文件的读取，共用上述稳定文件检查；发现来源在操作过程中变化时不得重试并继续使用该次结果，应重新导出普通文件后从头捕获。

before 与 after 必须使用不同 capture ID、不同 device + inode 的 D1 文件及 R2 manifest 文件；同一阶段的 D1/R2 必须共享相同关联信息。若文件仍有多个 hard-link 名称，须先重新制作普通 copy，不要仅重命名 alias。以下示例分别捕获两份已经导出的独立来源：

```bash
cd apps/web
npm run maintenance:assessment-reset -- capture \
  --phase before \
  --maintenance-id reset-2026-09-12-a \
  --capture-id capture-before-a \
  --source-scope japan-atlas-reset-a \
  --captured-at 2026-09-12T01:00:00.000Z \
  --database-copy /tmp/japan-atlas-before.snapshot.sqlite \
  --r2-manifest /tmp/japan-atlas-r2-before.json \
  --output /tmp/japan-atlas-before-evidence.json

npm run maintenance:assessment-reset -- capture \
  --phase after \
  --maintenance-id reset-2026-09-12-a \
  --capture-id capture-after-a \
  --source-scope japan-atlas-reset-a \
  --captured-at 2026-09-12T01:05:00.000Z \
  --database-copy /tmp/japan-atlas-after.snapshot.sqlite \
  --r2-manifest /tmp/japan-atlas-r2-after.json \
  --output /tmp/japan-atlas-after-evidence.json
```

输出文件必须尚不存在，避免覆盖既有审计证据。不要把私人行程、评分、笔记、对象 key 或证据包提交到 Git。

## 5. 本地 snapshot 副本演练

演练从 before 原件创建新的 after 副本及 after manifest，只在新副本上运行：

```bash
cd apps/web
npm run maintenance:assessment-reset -- rehearse \
  --before-d1 /tmp/japan-atlas-before.snapshot.sqlite \
  --after-d1 /tmp/japan-atlas-after.snapshot.sqlite \
  --before-r2 /tmp/japan-atlas-r2-before.json \
  --after-r2 /tmp/japan-atlas-r2-after.json \
  --maintenance-id reset-2026-09-12-a \
  --before-capture-id capture-before-a \
  --after-capture-id capture-after-a \
  --source-scope japan-atlas-reset-a \
  --captured-at 2026-09-12T01:00:00.000Z \
  --before-evidence /tmp/japan-atlas-before-evidence.json \
  --after-evidence /tmp/japan-atlas-after-evidence.json
```

所有 after 与 evidence 输出文件在运行前都必须不存在。演练会在新副本上执行 migration、对比完整 sqlite schema、所有 D1 表和 R2 manifest，并重复执行一次证明幂等。任何非白名单字段变化、记录增删、schema object 变化、R2 key 变化、相同 inode／hard-link alias、证据错配／复用／篡改或第二次结果不同都会失败关闭。

## 6. 独立验证

独立验证只接受上述不可覆盖的证据包，不再接受四个可任意误配的原始路径：

```bash
cd apps/web
npm run maintenance:assessment-reset -- verify \
  --before-evidence /tmp/japan-atlas-before-evidence.json \
  --after-evidence /tmp/japan-atlas-after-evidence.json
```

退出码 `0` 且 `ok: true` 才表示封闭白名单验证通过。退出码非零时保持写入冻结，不得继续切换或开放 writer。

## 7. T-14 生产维护顺序

仅在独立代码评审通过并由用户批准具体窗口后执行：

1. 冻结所有个人状态、Visit、媒体、地点、Inbox 与 WebMCP 写入并排空旧请求。
2. 导出完整 D1 snapshot，校验备份可读；导出完整 R2 object-key manifest。
3. 以同一 maintenance ID/source scope、不同 capture ID 与不同 D1/R2 来源生成前后证据；在新建的本地 `.snapshot.sqlite` 副本上重新运行 dry-run、rehearse 和 verify。
4. 保留旧部署版本，才可对生产 D1 应用已审核的不可变 migration；migration 本身不访问 R2。
5. 再次导出 D1 与 R2 manifest并验证，只读 smoke 通过后才切换新 writer。
6. 完成用户批准的写入 smoke 后恢复写入。

维护窗口前必须先确认默认 CI 中的架构适应度、operation catalog 类型负例、全量测试与 build 均通过。不要为了“验证 migration”运行部署命令；日常本地 build 只验证产物，`0003` 只能在本节批准的副本演练或生产维护窗口中应用。

## 8. 回退

如果 migration、验证、只读 smoke 或 writer 切换任一步失败：

1. 保持全部写入冻结，不继续尝试局部修补。
2. 恢复维护前的完整 D1 snapshot 和旧部署版本；R2 未被本 migration 修改，不执行对象删除。
3. 重新导出 D1/R2，确认与维护前快照和 manifest 一致。
4. 只有复验通过才恢复旧 writer；记录失败原因，修正后重新走独立评审和演练。

写入重新开放后不得再恢复旧 D1 snapshot，否则会覆盖窗口之后产生的新个人数据。
