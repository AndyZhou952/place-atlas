# T-14 code/UI 评审

- 日期: 2026-09-22
- 评审方式: subagent
- 固定点: `481cbccc16de7f754685e06aac898d30fcd88633`
- 范围: 当前未提交工作树相对固定点的全部 T-14 变更；三个既有未跟踪 `.orig` 文件只确认状态，未读取为实现证据、未修改
- 结论: PASS（第 2 轮）

## 发现项总览

- 严重: 0
- 一般: 0
- 建议: 0

第 1 轮的两项一般发现已修复并经第 2 轮独立冷读与复验关闭，Standards 与 Spec 双轴通过。生产 `owner-poc` composition 尚未注入 `catalogIntakeModule`、真实 route 仍稳定 503，经规格、架构与任务票交叉核对后判定为 T-18 的 production provider/composition/preflight 边界，不计为 T-14 缺口；这不等于 Add 已可在线使用。

## Standards

### 已关闭发现项

- [已关闭] Places collection 的外层 `aside` 现在同时使用 `aria-hidden={!listOpen}` 与 `inert={!listOpen}`，一次性把关闭态全部后代移出交互与焦点顺序；新增 contract 已从 RED 转为 GREEN。第 2 轮未发现新的 Standards 问题。

### 已核对

- `CatalogIntakeModule` 仍是唯一 intake 编排模块；T-14 在既有 module/port seam 上增加 `DurableGeocoderPort`，未建立平行 coordinator，也未把 provider/D1 逻辑塞进 route 或 React。
- Nominatim adapter 固定官方 `https://nominatim.openstreetmap.org/search`，只接受 direct Owner/public-place classification，查询前先读共享 cache、cache miss 后使用 D1 原子 gate 预留全应用 1 request/second；请求携带识别性 User-Agent 与 HTTPS Referer，输出闭合到 OSM source URL、license、checkedAt。任意 endpoint、expanded/private input、损坏 cache、非法坐标/时间/URL 均 fail closed；真正 transport、生产 identity 与 provider switch 仍受 T-18 preflight 约束。
- D1 gate 的条件 upsert 在同一 provider row 上原子竞争；并发 contract 得到 `[true,false]`，999ms 拒绝、1000ms 接受。cache 只跨越经 `validateDurableGeocoderProposal` 闭合验证的 resolved/ambiguous/no_match union。
- 四条 API route 都由 `withOwnerWriteAuth` 包裹，route 只构造 Web invocation 并执行共享 `AtlasApplication catalog.intake.*`；错误响应按闭合 `AddError` 投影且 `Cache-Control: no-store`。匿名请求在 application 前失败，既有 `/api/items` direct POST 仍 fail closed。
- browser adapter 使用 `sessionStorage` 保存 conversation，不发送 owner identity；401 发布既有 Owner-login event，输入状态保留。Agent capabilities 与 WebMCP 没有 intake 暴露。
- Confirm 在 T-16 前保持 disabled，并有 `aria-describedby` 的具体原因；没有提前接入 Catalog publish。
- UI 沿用现有 paper/vermilion/moss/font/radius tokens，无新增紫色渐变、emoji 图标、发光、玻璃拟态或装饰性动效；使用原生 radio、label、fieldset、live region、inline error、44px 控件与阶段标题焦点。
- 未发现 Fowler 基线中的新增重复 coordinator、重复 switch、神秘命名、数据泥团、基本类型旁路或 speculative production abstraction。三个 `.orig` 文件在评审前后均保持未跟踪，评审未触碰。
- T-14 变更中未发现真实 password、session secret、Google/Nominatim key、私钥或可用 token；仓库既有 auth 测试中的 `dummy-*` fixture 不是 secret。

## Spec

### 已关闭发现项

- [已关闭] Web conversation 现在从已验证的签名 HttpOnly Owner session 以域分隔 HMAC 在服务端派生并截断为 128-bit opaque ID。discover 总是以服务端权威 ID 覆盖伪造的合法 header；select/confirm/cancel 拒绝任何不匹配 ID；四条 route 均显式传入 `serverConversationId`。forged-valid、retry 与 tampered-session contracts 均通过。第 2 轮未发现新的 Spec 问题。

### 已核对

- only-name：Owner query 形成 `owner_query` title proposal；resolved durable geocoder 形成 address proposal 与 known location evidence，字段携带 sourceUrl/license/checkedAt。
- ambiguous：返回 `ambiguous_location` clarification，要求补 area/address，不把 Google transient name/address 改标为 durable facts。
- unavailable：保留 Owner query，location unknown，输出 provider_unavailable + needs_review warnings；provider 原始错误不会越过 closed result。
- Google discovery 的 transient presentation 仍只存在于当次响应；session/digest 只保存 provider namespace、Place ID、ordinal 与服务端状态。相关 negative contract 证明 transient 文本不能影响 preview digest，也不进入 Leaflet。
- Nominatim policy：官方 endpoint、直接用户触发、D1 原子 1rps、cache、UA/Referer、OSM attribution/license、禁止 expanded/private/autocomplete/systematic/details 路径与替换 port seam 均有实现/contract；生产 transport 与配置切换证据明确留给 T-18。
- Owner auth：四条 POST route 都受 Owner cookie 门保护；server 固定 `ownerId='owner'`、`channel='web'`，browser 不提交 owner identity。128-bit server-authoritative conversation 与 sessionStorage 往返成立，客户端自选 ID 不再越过边界。
- Confirm/publish 五路原子事务属于 T-16，当前 UI 禁用 confirm、核心 confirm fail closed，未提前写 Catalog。
- Agent manifest/WebMCP intake 暴露属于 T-17 门后；当前均未暴露。
- `0007_nominatim_policy_state.sql` 位于 `wrangler.owner-poc*.jsonc` 指定的实际 migrations directory；空库/replay migration suite 与 D1 sqlite contract 通过。migration 未部署，符合 T-14/T-18 蓝绿边界。
- `owner-poc-composition.ts` 相对固定点未变化且不返回 `catalogIntakeModule`，`server-atlas-application.ts` 因而使用 unavailable module，真实 `/api/catalog-intake/*` 为 503。T-14 票明确写“production provider/composition wiring 留到 T-18”；T-18 又明确要求 DurableGeocoder production identity、rate/cache/attribution、provider switch、provenance 与 fail-closed preflight。因此这是有意的阶段门，不是本轮严重缺口；在 T-18 完成前不得把线上 Add 描述为可用。

## UI 截图评审

### `t14-add-desktop.png`（1440×1107）

- 真实目视通过视觉层：Add panel 位于 collection heading 后、普通搜索前；warm editorial paper/vermilion/moss 方向稳定，没有漂回通用 SaaS wizard。
- 标题、eyebrow、正文与表单层级清楚，栅格/留白与既有 sidebar 一致；地图、detail card 与 Add panel 无覆盖或横向溢出。
- query input 与 CTA 高度、边界和强调色一致；初始 empty/default shell 有明确下一步文案。

### `t14-add-mobile.png`（390×1038）

- 真实目视通过视觉层：collection drawer 在窄屏保持单列，query 与 Find matches 上下排列，未溢出视口；触控目标视觉尺寸达到 44px。
- 地图仍作为背景上下文，drawer、页脚与 attribution 没有相互遮挡；输入、帮助文案和 Nearby 下一区域的层次可辨。
- 截图本身不能证明关闭态 Tab 顺序；该边界已由 `inert` 源码与 focused contract 独立复验关闭，且修复不改变可见布局，因此无需重拍三张截图。

### `t14-add-401.png`（1440×1311）

- 真实 browser route interception 产生 closed 401；目视可见 Add 错误、Retry 与展开的 Owner login，Owner password field 进入可操作状态。
- 原输入“鮨青空”保留，错误就地呈现，没有假成功或状态丢失；页面主体和地图仍可见，符合 non-modal Owner login 方向。
- 色彩、错误层级与既有 Owner shell 一致，无布局跳坏或遮挡。

## 证据

- 固定点解析：`git rev-parse --verify 481cbcc^{commit}` → `481cbccc16de7f754685e06aac898d30fcd88633`。
- 范围：评审者自行读取 `git diff 481cbcc`、`git status --short` 及全部 T-14 新文件；未采信作者摘要。仓库未找到适用的 `AGENTS.md`，已完整读取根 `CONTEXT.md`。
- 第 2 轮 focused：14/14 通过，覆盖第一轮两项发现、Owner session 与 route surface；原 focused contracts 亦保持通过。
- 完整测试：`npm test` → 515/515 通过，0 failed/skipped/todo（评审者独立运行 343.7s；作者侧另一次完整运行 205.8s）。
- 静态门：`npm run typecheck`、`npm run lint`、`npm run format:check` 全部通过。
- diff 门：`git diff --check 481cbcc` 无输出；所有未跟踪 T-14 新文件另以 `git diff --no-index --check /dev/null <file>` 检查，无 whitespace error。
- 构建门：`npm run build:owner-poc` 通过，构建产物列出四条 `/api/catalog-intake/{discover,select,confirm,cancel}` route。
- migration 门：`npm run migration:check` 通过。
- 截图：评审者通过只读临时缩略图真实查看指定 desktop/mobile/401 三张原始 PNG；原图未修改。
