# Owner Auth 代码评审（第 2 轮）

- 日期: 2026-09-21
- 评审方式: subagent
- 固定点: `e7b4e06f36dc829edce0456869ae866acae076f3`
- 被评快照: 固定点加 2026-09-21 当前未提交工作区；`HEAD` 仍等于固定点，已完整读取未跟踪 auth 文件、tracked browser route diff 与第 2 版规格/架构
- 规格基线: `spec.md` / `architecture.md` 的第 1 轮后修订稿及其第 2 轮独立评审；本结论只覆盖 Owner auth 切片，feature 005 整体仍受 Public Read Projection 与 mutation digest 的未闭合发现约束
- 结论: 通过

## Standards

第 1 轮发现已闭合：

- unsafe route 不再只依赖人工约定。`owner-route-surface-fitness.test.mjs` 递归扫描全部 `app/api/**/route.ts`，用 TypeScript AST 收集 `POST/PUT/PATCH/DELETE`，再与闭合 manifest 精确比较；任何新增/删除 unsafe route 或 method 都会令测试失败。当前全部 browser mutation export 都是直接 `withOwnerWriteAuth(...)`，Owner auth 与 Agent HMAC 是仅有的显式例外。
- 新增测试均以 `void test(...)` 显式消费 Promise；对 `lib/server/auth` 与全部相关 route 目录执行定向 oxlint 为零错误，第 1 轮新增的 7 个 `no-floating-promises` 已全部消失。
- `owner-write-rejection.contract.test.mjs` 在四种 unsafe method、四类无效 session、assessment/Visit/media 三个代表切片及重复请求中，均证明 guard 在 body、application、storage、audit、receipt 之前返回；与 AST 对所有真实 route export 的 wrapper 证明组合后，当前写面不存在未认证业务管线调用。
- auth 生产代码仍保持小接口与单一职责；Cookie、HMAC 验签、同源检查、过期检查和失败响应未复制进各 route，未发现本轮范围内的新增代码异味。

建议：

- [建议] `apps/web/lib/server/auth/owner-route-surface-fitness.test.mjs:34-70,162-169`：manifest 已闭合真实 route surface，但 `isOwnerGuardCall` 只按 identifier 文本识别 `withOwnerWriteAuth`，两个例外也主要以源码正则确认标志符存在；若未来有人在 route 内声明同名 no-op 或保留标志符却绕开实际 handler，适应度测试可能误通过。当前所有 route 已人工核对为从 `@/lib/server/auth/owner-auth` 导入可信 wrapper，Agent POST 也实际调用 HMAC handler，因此不是当前漏洞。→ 后续让 AST 同时解析 import binding 与 initializer call，并把 Owner POST/DELETE、Agent POST 分别绑定到唯一允许的 responder/handler，进一步加固未来回归门。

## Spec

第 1 轮 Owner auth 规格偏差已闭合：

- `spec.md:42-47,95,112`、A-33/A-38 已统一选择 v2 raw Secret 契约：原始口令只进入 Cloudflare encrypted Secret `ATLAS_OWNER_PASSWORD`，session key 只进入 `ATLAS_OWNER_SESSION_SECRET`；不再声称使用不可逆 verifier。实现只从 Worker env 读取这两个 binding，使用 WebCrypto HMAC/verify 做常量时间比较，不记录、回显或持久化口令；缺少任一 Secret 时 login/write 均 503 fail closed。
- 12/12 定向测试覆盖正确/错误登录、Cookie 缺失/篡改/过期/登出、精确 same-origin、Secret 缺失、POST/PUT/PATCH/DELETE、重复登录/拒绝提交、授权 happy path 与 route context 保留。拒绝路径均在代表 pipeline 的任何业务副作用之前停止。
- Web Cookie 与 Agent HMAC 边界仍分离：闭合 manifest 把 `/api/agent/v1/tools` 标为独立 `agent_hmac` 例外，实际 route 未套 browser Cookie guard，继续组合既有 HMAC gateway；browser unsafe routes 则不能借 Agent exception 绕过 Owner Cookie。
- 当前临时弱口令只允许非敏感 PoC，真实数据前轮换并重审滥用防护，已进入 `spec.md:47,81` 与 A-38，而不是由当前代码假装提供账户锁定或多用户能力。

建议：

- [建议] `apps/web/lib/server/auth/owner-session.ts:223-230`：运行时只验证 session Secret 至少 32 个字符，不能证明随机熵；第 2 轮规格/架构评审也已提出至少 256-bit 随机 key 与轮换使旧 Cookie 失效。→ 在部署 preflight/secret provision 门生成并核验高熵 key，记录轮换后旧 Cookie 的负面 smoke；不应尝试仅靠运行时字符统计推断熵。

## 验证证据

- `node --experimental-strip-types --test` 加四个 Owner auth test 文件：12/12 通过，0 failure。
- `npx oxlint lib/server/auth app/api/auth/owner app/api/inbox app/api/items app/api/journal app/api/media`：通过，0 error。
- `git diff --check e7b4e06`（Owner auth 相关 tracked scope）：通过。
- 人工读取 `git diff e7b4e06`：九个 browser route 文件只增加可信 wrapper 并保持原 handler 位于 wrapper 内；auth/Agent 两个 unsafe 例外与 manifest 一致。
- `npm run typecheck`：仍因未被 Owner auth 修改的 `scripts/migration-packaging.ts:81,124` 失败；定向 auth 测试与 lint 无类型/语法失败。
- `npm run lint`：仍因仓库既有 migration 类型错误与其他旧测试的 `no-floating-promises` 失败；输出中没有本轮四个 Owner auth test 文件，定向 auth lint 已通过。因此不把全仓门记为绿色，但第 1 轮归属于本切片的 lint 发现已闭合。
