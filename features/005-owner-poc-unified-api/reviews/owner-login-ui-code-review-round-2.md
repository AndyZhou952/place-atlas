# Owner Login UI 代码评审（第 2 轮）

- 日期: 2026-09-21
- 评审方式: subagent
- 固定点: `e7b4e06f36dc829edce0456869ae866acae076f3`
- 范围: `apps/web/features/atlas/owner-*`、`atlas-api-client*`、`atlas-screen.tsx` 与 `app/globals.css` 本轮 UI diff
- 结论: 需修改

## Standards

- [一般] `apps/web/features/atlas/owner-session-state.ts:139`、`apps/web/features/atlas/owner-access.tsx:188`: `closePanel` 在网络请求仍进行时把 `pending` 无条件清为 `null`，而 login loading 期间 Close 与页头 trigger 都仍可用。用户可在一次 login 未完成时关闭并重开面板，第二次提交会被重新启用；第一请求随后还可能以 `login.succeeded` 再次打开面板。这破坏了规格要求的“提交中避免重复提交”，也是修复关闭清理时引入的新竞态 → pending 请求期间禁用关闭入口，或给请求增加 abort/generation 并只让当前 generation 结算；至少补充 deferred-promise 行为测试证明 close/reopen 不能产生两个 login。
- [建议] `apps/web/features/atlas/owner-access-ui.contract.test.mjs:5`: 测试仍以源码正则为主；本轮虽然把 44px 断言收窄到了目标 input/button，仍不能证明真实 computed box、实际焦点和 ARIA 引用关系 → 保留静态边界测试，但将 T-10 的通过证据建立在浏览器交互与 computed-style/axe 断言上。

## Spec

- [一般] T-10 / `spec.md` Testing Decisions: 仍没有桌面与移动端的真实渲染截图，也没有 default、focus、loading、error、success、登录后保存/刷新与登出的浏览器证据。`hf-ui-design` 明确规定真实渲染与截图评审是 UI code-review 的组成部分，单元测试不构成 UI 冒烟测试；因此这里不能写成“代码通过、仅 ship gate 未闭合”，本轮完整 UI 代码门仍为“需修改” → 修复 pending 竞态后，在真实浏览器中完成两种视口、各交互状态、保存刷新和 axe/焦点检查，再提交第 3 轮独立复审。

## 第 1 轮发现项复核

- 登录成功焦点：已修复。`login.succeeded` 通过 `focus(..., 'trigger')` 增加 revision，`OwnerAccessButton` effect 将焦点送回仍存在的 trigger。
- Close 清理：敏感/陈旧展示状态已修复。header trigger 与 Close 均复用 `closePanel`，会清除 `passwordVisible/error/success`；但见 Standards 中新的 pending 竞态。
- 目标元素 44px：静态实现已修复。input 与 Show/Hide button 直接获得 `min-height: 2.75rem`，移动单列不再依赖父容器高度推断；真实 computed-size 仍待浏览器证据。
- 稳定错误文案：已修复。client 按 action/status 映射固定公开文案，不再读取或展示任意响应正文；负测覆盖带内部 request-id 的响应。

## 评审证据

- `node --experimental-strip-types --test features/atlas/*.test.mjs`：46/46 通过。
- `npx oxlint <本轮 UI 文件>`：通过。
- `npm run build`：通过。
- `npm run lint`：全仓失败；错误来自共享工作树中 `scripts/migration-packaging.ts` 的 Buffer 类型问题及大量既有/并行测试的 `no-floating-promises`，本轮 Owner UI scoped lint 无错误。全仓门未通过，不能声称 repository lint 为绿。
- 真实浏览器/截图：仍缺失；未完成方向一致性、排版、空间、色彩、响应式、computed target size 与自动可访问性放行。
