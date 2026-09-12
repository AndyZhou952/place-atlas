# T-01 托管证明硬门探针

- 日期：2026-09-12
- 方式：fail-closed hosting-capability audit（未创建或部署临时 Site）
- 结论：阻塞；T-01 保持未完成

## 范围与安全边界

本次只审查可用托管契约、当前 Site 配置形状和已确认的 T-01 要求。没有读取或记录生产 D1/R2 内容、私密证据、凭证、confirmation 或访问者身份值；没有修改 Site audience、创建临时 Site、部署任何版本、执行 migration 或 reset。

## 可审计的证据类别

| 所需事实 | 可得到的安全证据类别 | 结论 |
| --- | --- | --- |
| trusted owner | 托管说明称私有 Site 的已登录访问者会收到平台认证 header | 不足：当前可用契约没有可由应用独立验证的 owner authorization/allowlist attestation，也没有可在隔离 Site 中证明伪造 header 被丢弃的受信测试入口。 |
| source / deployment / generation | 本地 hosting manifest 只声明逻辑 bindings；部署工具可管理保存版本 | 不足：没有 server-derived、不可由调用者替换的 source revision、deployment 或 active generation identity 输入。 |
| atomic activation / old-request quiescence | 部署工具提供版本保存与发布生命周期 | 不足：没有原子切换回执、旧 generation 在途请求清单/终止证明或可验证的最大请求期。 |
| request-body / memory bounds | 已安装托管与鉴权说明 | 不足：未给出可绑定到运行时 generation 的 request-body 或 memory 上限。有限次上传样本不能证明全局上限，不能作为 restore chunking 的依据。 |

## Fail-closed decision

`DeploymentAttestor` 是已确认的 TDD seam，但尚没有可信 hosting adapter input。现在编写测试或实现只能用 caller-supplied header、构建时常量或时间猜测伪造这些输入，违反 AC-4、AC-7、T-01 和架构的 fail-closed 约束。因此没有创建会错误通过的本地测试，也没有写入 production maintenance route。

未创建 disposable Site：它至多能证明某个请求样本，无法补足上述未暴露的 generation、quiescence 或 runtime-limit attestation；创建它会产生一次真实部署却不能满足 T-01 的全部证明义务。这个决定也避免任何意外 migration/reset 执行。

## 解除条件

在继续 T-03、T-05、T-11 或 T-18 前，托管平台必须提供并允许在 owner-only、disposable D1/R2 Site 上独立验收的受信 inputs：

1. 服务端可验证的 owner authorization，以及对伪造 caller identity 的拒绝证明；
2. 绑定到已发布 artifact 的 server-derived source revision、deployment ID 与 active generation；
3. 原子激活回执和可验证的旧 generation quiescence/最大请求期；
4. 绑定同一运行时的明确 request-body 与 memory limits。

取得这些能力后，按 TDD seam 先写一项隔离 Site 行为验收：可信 context 通过、伪造 identity 被拒绝、generation 切换中的旧写入无法越过 drain，并且由 attested bounds 驱动分块。通过独立 Standards + Spec review 后，才可勾选 T-01 并解锁其下游票。
