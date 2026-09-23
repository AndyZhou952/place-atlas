# Owner Login UI 代码评审（第 1 轮）

- 日期: 2026-09-21
- 评审方式: subagent
- 固定点: `e7b4e06f36dc829edce0456869ae866acae076f3`
- 范围: `apps/web/features/atlas/owner-*`、`atlas-api-client*`、`atlas-screen.tsx` 与 `app/globals.css` 本轮 UI diff
- 结论: 需修改

## Standards

- [一般] `apps/web/features/atlas/owner-session-state.ts:65`: 使用页头 trigger 折叠面板时只清除 `success`，保留了 `passwordVisible` 与 `error`；用户在显示密码或登录失败后用同一个 trigger 关闭，再次打开会得到默认明文输入框和过期错误，而专用 Close 路径又表现不同，形成两套关闭语义，也延长了敏感 UI 状态生命周期 → 把所有关闭入口收敛到同一个 reducer 转移，关闭时统一清除 `passwordVisible/error/success`，并补充“显示密码/失败 → trigger 关闭 → 重开”的行为测试。
- [一般] `apps/web/features/atlas/owner-access-ui.contract.test.mjs:5`: 三个所谓 UI contract 都只用正则检查源码；它们不能证明控件真实渲染、焦点实际移动、ARIA 关系指向存在节点、响应式布局或触控尺寸。例如第 41–43 行只找到父容器的 `min-height` 就宣称所有表单控件均为 44px，在移动端两行 grid 中并不成立 → 用真实 React/browser 交互测试覆盖 login-required 事件、提交 loading/error/success、关闭/重开、焦点与实际 computed size；源码边界检查可保留，但不能代替行为和视觉测试。
- [建议] `apps/web/features/atlas/owner-session-client.ts:81`: 客户端把任意非 2xx 响应正文直接变成可见错误；当前 auth route 的正文是稳定文案，但代理/平台错误页或未来未脱敏正文也会被原样展示 → 按已知 status/error code 映射稳定公开文案，把未知响应收敛为通用错误，并测试响应正文含内部细节时不会显示。

## Spec

- [一般] `apps/web/features/atlas/owner-session-state.ts:106`: `login.succeeded` 将 `focusTarget` 设为 `null`，同时 `owner-access.tsx:87-118` 会用 authenticated session 区域替换仍持有焦点的登录表单；因此成功后焦点会随提交按钮卸载而丢失，没有按 Acceptance Criterion 7 回到 trigger 或首个可操作控件 → 成功转移显式请求 `trigger` 或 `logout/close` 焦点，并用真实 DOM 断言 active element。
- [一般] `apps/web/app/globals.css:257`、`apps/web/app/globals.css:2135`: 桌面双列时父行的 2.75rem 高度可拉伸输入框和 Show 按钮，但 600px 以下改成单列、两个 auto row；子控件只有 `height: 100%`，复用 primitive 的固有高度仍是 2rem，父容器 `min-height: 2.75rem` 不能证明每个交互控件都达到规格要求的 44×44px → 在子 input/button 上直接设置 `min-height: 2.75rem`，并用移动视口 computed box 断言，而不是检查父容器文本。
- [一般] T-10 / `spec.md` Testing Decisions: 未提供桌面与移动端的真实渲染截图，也没有 default、focus、loading、error、success、登录后保存/刷新及登出场景的浏览器证据；当前环境也没有可用浏览器或既有截图。按照 `hf-ui-design`，单元测试不能替代 UI 冒烟与截图评审 → 修复以上问题后，以真实浏览器补齐两种视口与全部状态截图，并运行可访问性自动检查；在证据进入评审前保持 ship gate 关闭。

## 评审证据

- `git rev-parse --verify e7b4e06`：固定点有效，目标 UI diff 非空。
- `node --experimental-strip-types --test features/atlas/*.test.mjs`：45/45 通过（任务描述中的 44 项在当前工作树新增一项 401 回归后为 45 项）。
- Owner UI 定向测试：16/16 通过。
- `npx oxlint <本轮 UI 文件>`：通过。
- `npm run build`：通过。
- `npm run lint`：全仓失败；本轮 UI 文件的 scoped lint 通过，失败来自同一共享工作树中的其他未汇合改动与既有 test lint，不能据此宣称全仓门通过。
- 真实渲染/截图：缺失，因此未执行方向一致性、排版、空间、色彩、状态和移动端 computed-size 的视觉放行。

## 正向观察

- 非 modal inline 区域保持了现有 warm editorial atlas，没有复制或移动既有业务控件。
- 401 写请求会发布单一 Owner-login-required 事件；订阅在 effect cleanup 中解除，未发现 listener 泄漏。
- 密码未进入 React state、日志或持久化；登录成功后表单 reset，错误关联、live region、loading disabled 与图标可访问名称已有基础实现。
