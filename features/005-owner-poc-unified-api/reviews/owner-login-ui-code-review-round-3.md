# Owner Login UI 代码评审（第 3 轮）

- 日期: 2026-09-21
- 评审方式: subagent
- 固定点: `e7b4e06f36dc829edce0456869ae866acae076f3`
- 被评快照: 固定点加 2026-09-21 当前未提交 Owner Login UI 工作区与 `features/005-owner-poc-unified-api/evidence/ui/` Chromium 证据
- 范围: `apps/web/features/atlas/owner-*`、`atlas-api-client*`、`atlas-screen.tsx`、`app/globals.css` 本轮 UI diff；本结论不替代真实 owner-poc D1 的保存/刷新发布冒烟
- 结论: 通过

## Standards

第 2 轮发现已闭合：

- pending race 已由两层门关闭。`createOwnerSessionRequestGate` 在网络调用前同步 claim，只允许一个 login/logout request；reducer 另以 `pending + activeRequestId` 拒绝重复 start 与过期 completion。即使 React state 尚未重渲染，同一时刻的第二次调用也会被 request gate 拒绝。
- UI 在 login/logout pending 时禁用页头 trigger、Close、密码显示切换与提交；reducer 对 `panel.toggled/panel.closed/password.toggled/login.required` 也在 auth request pending 时保持原 state，不再靠按钮禁用单点防护。
- 请求完成后只有匹配当前 request ID 的 success/failure 能结算状态；过期响应不能写入 authenticated/error/pending。关闭后的密码可见状态与陈旧错误继续由共享 `closePanel` 清理。
- 稳定错误文案、listener cleanup、密码不进入 React state/日志/持久化及目标控件直接 44px 约束均保持不变；本轮范围的 scoped lint 与 diff whitespace 检查无异常，未发现新增 Fowler 异味。

建议：

- [建议] `apps/web/features/atlas/owner-access-ui.contract.test.mjs:5`: 静态源码断言适合守住非 modal、ARIA 属性和 CSS 最低尺寸，但仍不能替代浏览器行为。当前已有真实 Chromium 证据与 reducer/request-gate tests 支撑本轮通过；后续可把本次手工 probe 固化为浏览器测试，直接断言 activeElement、computed height 与 pending 中重复点击。

## Spec

- 登录成功焦点满足 Acceptance Criterion 7：`login.succeeded` 生成新的 trigger focus revision；真实 Chromium success probe 的 active element 为 `.owner-access-trigger`，可见文案为 `Owner active`。
- mobile viewport 打开 panel 后，真实 active element 为 `#owner-password`；input 与 Show 控件 computed height 均为 44px，结合 CSS 对目标元素直接设置 `min-height: 2.75rem`，关闭第 1 轮的响应式触控尺寸问题。
- error 图显示密码字段可见 focus ring、就地错误与操作按钮；success 图显示非 modal Owner 状态区、live success 文案、Sign out/Close，并保持原地图、导航和地点列表。未发现 focus 被遮挡、横向溢出或模板化视觉漂移。
- default/loading、error/focus、success 在代码状态机、49 项 Atlas tests 和真实截图间可互相核对。提交 pending 明确使用 `aria-busy`、禁用全部竞争入口并显示 `Signing in…`；真实默认图还覆盖初始 status loading，不存在装饰动画。
- 本切片没有隐藏、移动或复制原有业务控件；401 unsafe write 只发布 Owner-login-required 事件并让原 mutation 失败，不会把未认证操作误报为成功。

## 视觉评审

- `owner-login-desktop-default.png`（1440×1000）：主页面网格、暖色纸面、编辑式标题和地图/列表层次保持既有方向；初始 Checking 状态清楚且不干扰公开浏览。
- `owner-login-mobile-default.png`（390×884）：页头压缩为可访问图标入口，导航、状态条和地点抽屉无横向溢出，触控布局保持可用。
- `owner-login-desktop-error.png`（1440×204）：inline panel 与现有 palette/字体/分隔线一致；错误靠近字段、focus ring 清晰，不使用 modal、渐变、emoji 或装饰动画。
- `owner-login-mobile-success.png`（390×1140）：success 区在窄屏按单列自然扩展，Sign out/Close 明确，原地图与地点浏览仍在同一页面，没有回到通用 SaaS 登录页。
- 截图文件均已由评审者直接读取；PNG 尺寸、非零内容和 SHA-256 已核验。未见方向漂移、模板脸或视觉硬伤。

## 评审证据

- `node --experimental-strip-types --test features/atlas/*.test.mjs`：49/49 通过，包含 pending close/repeat、过期 completion 与 request gate 负面测试。
- `npx oxlint <本轮 UI 文件>`：通过，0 error。
- `git diff --check e7b4e06 -- <本轮 UI 文件>`：通过。
- Chromium screenshots：桌面 default、移动 default、桌面 error/focus、移动 success 均已独立查看；移动 live probe 记录了 password focus、两个 44px computed heights 与 success 后 trigger focus。
- 本结论只通过 Owner Login UI 代码切片。真实 Cloudflare Secret、Owner Cookie、D1 写入、刷新恢复与登出后的远端拒写，仍必须在 T-10/T-11 的部署 smoke 中使用新 owner-poc 环境验证，不能由 mock success 截图替代。
