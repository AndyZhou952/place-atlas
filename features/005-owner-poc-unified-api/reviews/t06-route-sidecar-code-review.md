# T-06 Google Route Sidecar 代码／安全评审（第 1 轮）

- 日期: 2026-09-21
- 评审方式: subagent
- 固定点: `b201a3c5887bdda8d2a71be732f511b035a8998a`
- 评审范围: `apps/web/route-sidecar/**`、`apps/web/wrangler.route-sidecar.jsonc`、`apps/web/scripts/route-sidecar-*`、`apps/web/package.json` 的 Sidecar scripts、`features/005-owner-poc-unified-api/deployment/cloudflare-route-sidecar/README.md`
- 明确排除: T-05 Nearby operation/browser/composition 变更、全部 `.orig` 文件、真实 provider 调用、远端部署与远端 service-binding 证据
- 结论: 需修改

## Standards

### 发现项

- [一般] `apps/web/package.json:21-23` 与 `apps/web/route-sidecar/**`：仓库的 `lint` 和 `format:check` 脚本没有包含新建的 `route-sidecar` 目录，所以两个标准门虽然返回成功，却没有检查 Sidecar 主实现。评审者显式执行 `npx oxfmt --check route-sidecar ...` 后，`d1-metered-route-sidecar-client.sqlite.contract.test.mjs`、`google-route-sidecar-transport.ts`、`metered-route-sidecar-client.ts`、`route-sidecar-contract.ts`、`route-sidecar-service.contract.test.mjs`、`route-sidecar-service.ts`、`worker.contract.test.mjs` 共 7 个文件失败。→ 将 `route-sidecar` 纳入仓库 lint/format scripts，格式化上述文件并重跑主门，避免 CI 假绿。

### 已核对证据

- `npm run test:route-sidecar`: 14/14 通过。
- `npm run build:route-sidecar`: Wrangler `--dry-run` 成功，明确显示 `No bindings found` 与 `--dry-run: exiting now`；bundle preflight 通过，没有上传或真实 provider 调用。
- bundle metafile 只包含 Worker、Sidecar contract/service/transport 与两个纯 response mapper；唯一运行时外部 import 是 `cloudflare:workers`。
- bundle 中仅有 Geocoding、walking Route Matrix 与 Google attribution 三个 HTTPS 字面量；没有 Transit、Foursquare、Compute Routes、Owner/Agent secret、D1/R2/KV/Queue/Durable Object/service binding 或日志能力。
- `npm run typecheck`、`npm run lint`、`npm run format:check`、scoped `git diff --check`: 均返回 0；但主 lint/format 的漏检由上述发现项单独处理。
- 显式 `npx oxlint route-sidecar ...`: 通过。
- 复跑既有 `d1-provider-usage` contract：3/3 通过，包括 provider+SKU+UTC 月、并发不越过 SKU cap。

## Spec

### 发现项

- [一般] `apps/web/scripts/route-sidecar-deployment-preflight.ts:56-73,136-140`：secret evidence 先过滤掉所有 `name` 非字符串的项，再判断允许项；因此“一个合法 Google secret + 一个格式异常／不可识别 secret 项”会错误返回 `ready: true`。评审者以 `{name:'GOOGLE_MAPS_API_KEY',type:'secret_text'}` 加 `{name:123,type:'secret_text'}` 实测复现。它没有兑现 runbook 的“malformed evidence 必须停止”与 T-06 的“只有 Google secret”失败关闭门。→ 对 evidence 数组逐项做闭合 schema 校验，要求恰好一个 `GOOGLE_MAPS_API_KEY: secret_text`，任何格式异常、重复、额外 name/type 均阻断，并补负测。
- [一般] `apps/web/route-sidecar/route-sidecar-service.contract.test.mjs:6-184`、`apps/web/scripts/route-sidecar-bundle-preflight.ts:16-32`：实现当前确实使用两个固定 endpoint、`GET`/`POST` 和 `redirect:'manual'`，且 3xx 会被非 2xx 分支拒绝；但 contract 没有证明缺 Google secret 时零 fetch、3xx 不跟随且映射为 `dependency_failure`，也没有覆盖 D-P04 接受条件要求的 method 漂移负测。bundle gate 能发现额外 HTTPS 字面量，却无法发现把既有 Geocoding tuple 改成 POST 或 Matrix tuple 改成 GET。→ 为缺 secret、全部 redirect、Geocoding GET/Matrix POST method tuple 增加行为负测；若继续以静态 bundle gate 作为发布保证，让 gate 或集中 tuple guard 同时约束 method，而不只约束 URL 字面量。

### 已满足项

- Feature 005 对 D-P04 的有意收窄成立：只保留 Geocoding 与 walking Route Matrix；Compute Routes/Transit/Foursquare 明确被 bundle gate 禁止。
- typed request 使用闭合 key、坐标边界、非空 512 字符 location hint 与最多 25 个 destinations；调用方不能提交 URL、method、travel mode 或 provider。
- Sidecar config 为 `workers_dev=false`、`preview_urls=false`、空 `routes`，没有 Owner、Agent、D1、R2 或其他 runtime binding；Worker HTTP handler 固定返回 404。
- transport 使用构建时固定 Google endpoints、manual redirect、no-store 与 header secret；响应先由 allowlist mapper 收窄，输出只含候选／路线、attribution、source 与 `checkedAt`，provider debug/raw 字段不会离开 Sidecar。
- D1 client 在 RPC 前按 `google-maps-platform + SKU + UTC month` 原子预留；Geocoding 为 1 request/unit，walking Matrix 为 `1 origin × destinations` elements，两个 hard cap 都是 8,000；quota failure 零 RPC，provider failure 不退款。
- service binding 缛失时返回 `not_configured` 且零 reservation；public probe 只接受精确 workers.dev URL 上的 404 或明确 DNS-not-found，其他网络错误作为 inconclusive 失败关闭。
- 公开 ToS/Privacy、真实 secret、远端不可达性、Owner service binding 与真实 Google smoke 属于后续远端/T-07 证据，本轮没有执行，也没有据此宣称 T-06 已可部署。
