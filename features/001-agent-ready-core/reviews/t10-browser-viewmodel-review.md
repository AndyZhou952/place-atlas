# T-10 Browser Adapter 与 ViewModel 收缩代码评审 (第 3 轮)

- 日期: 2026-09-12
- 评审方式: subagent
- 固定点: `3cca673` + working-tree fixed snapshot, no checkpoint commit
- 结论: 通过
- 范围: 按 T-10 所有权评审 `atlas-api-client`、`model`、`use-atlas-view-model`、ViewModel state/reducer 及其测试；固定快照中的 server/application 变更归属已完成的 T-02–T-09，仅核对 T-10 接入，未算作本票改动。
- 验证: T-10 定向测试 28/28、全量测试 152/152、typecheck、lint、format check、build 与 `git diff --check` 均通过。沿用首轮主会话真实渲染证据：localhost Map 与 Journal empty 正常，AX 控件有名称，Ask nearby 有清晰可见 focus ring；本轮无视觉／组件改动。

## Standards

- [建议] `apps/web/components/ui/button.tsx:23-33`、`apps/web/app/globals.css:171-179,1734-1737,2006-2010`: 顶部导航／Ask nearby 等既有控件约 32–33 px、Clear filter 约 36 px，低于 `hf-ui-design` 的 44×44 px 触控底线；这些组件、样式与 `atlas-screen.tsx` 相对 `3cca673` 均无差异，T-10 明确不改视觉／地图，因此仍判为既有非阻塞债务，而非本票回归。→ 另立 UI/accessibility 票统一扩大交互命中区并在桌面、手机断点复验。

- 无其他 Standards 问题。四类 active load token、独立 `loadId`、typed Browser adapter、fake transport、HTTP 映射、24→4 分批上传、ViewModel 边界及既有 optimistic 并发／rollback 均保持局部、可测试且无新依赖；T-10 仍未修改 server 生产实现。

## Spec

- 无。第 2 轮 finding 已关闭：`item.removed` 现在同时失效 `items`、`visits`、`media` 三个旧 load token，同时保留无关 `importJobs` token；删除前启动的旧 items/visits/media response 均不能复活级联删除数据。新增测试还证明 ImportJob response 正常落地，以及删除后显式启动的新 visits/media load 仍可接受 server truth，不形成永久遮蔽。

- AtlasItem delete 仍是非 optimistic 流程：ViewModel 等待 `catalog.delete_item` 成功后才派发 `item.removed`；失败时本地集合从未被删除，因此无需新 rollback，既有错误提示与 pending 清理未退化。首轮其余验收继续成立：全部持久读写／nearby 经 Browser adapter，ViewModel 不复制服务端有效到访或距离规则，Visit 删除回滚、item 并发 overlay、晚到读取隔离和媒体分批即时可见行为均通过。
