# Owner Auth 代码评审（第 1 轮）

- 日期: 2026-09-21
- 评审方式: subagent
- 固定点: `e7b4e06f36dc829edce0456869ae866acae076f3`
- 被评快照: 固定点加 2026-09-21 当前未提交工作区；`HEAD` 仍等于固定点，因此本轮同时冷读了未跟踪的 auth 文件和已修改的 browser route，后续须在形成不可变提交后复审精确 diff
- 规格基线: `features/005-owner-poc-unified-api/spec.md` 与 `architecture.md` 的 2026-09-21 draft；两份第 1 轮独立评审均为“需修改”，`progress.md` 仍处于 `to-architecture`，所以本轮只能按当前草案指出偏差，不能视为对最终规格的确认
- 结论: 需修改

## Standards

- [严重] `apps/web/lib/server/auth/owner-auth.ts:23-27`、本轮各 browser mutation `route.ts`：鉴权是每个 route 作者自觉调用 `withOwnerWriteAuth` 的 opt-in wrapper；当前已存在的写路由虽全部包裹，但未来新增一个未包裹的 `POST/PUT/PATCH/DELETE` 会直接公开，未知写路由不是 fail-closed。现有测试只测 wrapper 自身，未枚举 route surface，也无法阻止这种回归。→ 在统一 HTTP 边界建立 deny-by-default 的 unsafe-method policy，并把 login/logout 与 Agent gateway 作为闭合例外；若框架限制必须保留逐路由 wrapper，至少增加会枚举所有 `app/api/**/route.ts`、核对每个 unsafe export 及明确例外的适应度测试，使新增未保护 route 直接令 CI 失败。
- [一般] `apps/web/lib/server/auth/owner-session.test.mjs:11-133`、`apps/web/lib/server/auth/owner-write-guard.test.mjs:6-50`：新测试在仓库正式 `npm run lint` 中新增 7 个 `typescript(no-floating-promises)` 错误；虽然测试运行通过、目标生产源码的定向 oxlint 通过，但本次改动本身没有通过仓库 lint gate。→ 按仓库 lint 约定显式消费顶层 `test(...)` 返回值，并重跑正式 lint；仓库其余既有 lint/typecheck 基线问题可单独记录，但不能用其掩盖本轮新增错误。
- [一般] `apps/web/lib/server/auth/owner-write-guard.test.mjs:6-50`：零写入证据只由一个人工计数器模拟通用 handler，未导入任何真实 route，也没有证明请求体解析、`getServerAtlasApplication()`、D1/R2 或 audit/receipt 均在拒绝后未触达；这使“auth 必须最先执行”的集成性质没有受到回归保护。→ 为至少 assessment、Visit、media 三类真实 route/HTTP adapter 增加匿名请求 contract test，并以可观察 fake ports 断言 application/storage/audit 调用均为零；再用上述 route-surface 适应度测试覆盖其余 unsafe routes。

已核对且无发现：Cookie 使用 `__Host-`、`Path=/`、`HttpOnly`、`Secure`、`SameSite=Strict` 与有限 TTL；签名在解析 payload 前验证，过期与篡改 fail closed；login/logout/write 均执行精确 same-origin 检查；缺少 Secret 返回 503；Agent `/api/agent/v1/tools` 未套用 browser Cookie guard，仍由既有 HMAC gateway 独立认证。

## Spec

- [严重] `apps/web/lib/server/auth/owner-auth.ts:23-27` 对照 `spec.md:40,106`：草案要求所有 browser unsafe methods **默认** 需要 Owner Cookie，并覆盖“所有 unsafe method”；实现是分散 opt-in，测试只构造 PATCH，未覆盖 POST、PUT、PATCH、DELETE，也未证明 auth endpoint 与 Agent gateway 是唯一闭合例外。→ 采用默认拒绝的中央 policy/闭合 manifest，并增加全 route × method 的正负契约；Web Cookie 不得成为 Agent scope 凭证，Agent HMAC route 也不得因中央 policy 被误包裹。
- [一般] `apps/web/lib/server/auth/owner-session.ts:7-10,131-146,223-230` 对照 `spec.md:44,90` 与 A-33：实现绑定 `ATLAS_OWNER_PASSWORD` 并在运行时读取原始密码，用 session secret 对候选和原密码做 HMAC 常量时间比较；这不是规格声明的“只存不可逆 verifier”，也与 spec review 第 1 轮已经指出的未决 raw-secret/verifier 选择相冲突。→ 先修订并通过上游规格，明确唯一方案与唯一 Secret schema：若采用 raw password in Cloudflare encrypted Secret，就修正 spec/A-33 并保留常量时间、禁止日志/回显和上线前轮换门；若采用 verifier，就定义版本化 KDF、salt/work factor、离线生成/轮换流程及 Worker 验证契约，然后按该契约实现。不得同时保留两种含混命名。
- [一般] `apps/web/lib/server/auth/owner-session.test.mjs:41-133`、`apps/web/lib/server/auth/owner-write-guard.test.mjs:6-50` 对照 `spec.md:41,45,106`：草案要求对 Cookie 缺失、错误、过期、篡改、登出、重复提交和所有 unsafe methods逐项验证“零业务写入”。当前过期/篡改只查询 status，登出只检查清 Cookie，重复提交未测，只有 generic rejection 测了一次 handler 计数。→ 把每种无效 session 都送入受保护的真实写切片，逐项断言稳定状态码与所有业务端口零调用；补登出后的写拒绝、重复 login/submit、四种 unsafe method 和 route 例外测试。
- [建议] `apps/web/lib/server/auth/owner-session.ts:39-50`：公开 login endpoint 没有尝试频率门，而计划中的临时口令强度很低；当前 draft architecture review 已要求无滥用控制时仅允许假数据，`spec.md:77` 也要求真实私人数据前轮换已暴露凭证。→ 在部署门明确：本版本只能承载假数据；上真实数据前轮换口令/签名 key，并选择 Cloudflare rate limiting、Access 前置或最小登录节流与告警之一，再重跑负面测试。

## 验证证据

- `node --experimental-strip-types --test lib/server/auth/owner-session.test.mjs lib/server/auth/owner-write-guard.test.mjs`：7/7 通过。
- `npx oxlint` 对 auth 生产源码、auth route 与本轮 mutation routes：通过。
- `npm run typecheck`：失败；错误位于未被本轮 auth 修改的 `scripts/migration-packaging.ts:81,124`，不能据此判定 auth 类型失败，但仓库总门仍未绿。
- `npm run lint`：失败；除大量既有基线外，两个新增 auth test 文件各自贡献 `no-floating-promises` 错误，已列为本轮 Standards 发现项。
- `npm test`：观察到 167 个测试（含本轮 7 个）连续通过，但进程未自行退出，评审者在无新增输出后终止；因此不将全量 suite 记为正式通过，只采信上面的定向 7/7。
- 静态 route inventory：所有当前 browser mutation routes 已调用 `withOwnerWriteAuth`；Owner auth endpoint 与 Agent tools endpoint是唯二未套该 wrapper 的 unsafe routes，且 Agent tools route仍组合原 HMAC gateway。
