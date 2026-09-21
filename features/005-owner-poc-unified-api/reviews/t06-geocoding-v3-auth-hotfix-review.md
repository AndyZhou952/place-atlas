# T-06 Geocoding v3 鉴权热修独立代码评审

- 日期: 2026-09-21
- 评审方式: 独立 subagent 冷读；评审者未修改被评代码
- 首轮结论: 需修改
- 最终结论: PASS

## Standards

首轮发现：provider mapper 没有严格执行 v3 status/result 一致性，会接受缺失或非字符串 status、`OK + 空结果`、`ZERO_RESULTS + 非空结果`。这可能继续产生 false `not_found` 或接受矛盾响应。

修复后只接受：

- `OK` 且至少一条结果；
- `ZERO_RESULTS` 且结果为空。

其他显式错误、缺失/错误类型 status 或矛盾 payload 均 fail closed。独立复审未发现新的阻断项。

## Spec

- Geocoding v3 key 只在最终固定 endpoint fetch 中进入 query，未进入应用日志、返回、持久化或构建产物。
- Routes 继续使用 `x-goog-api-key` header。
- 固定 origin/path/method、`redirect: manual`、`cache: no-store` 均保留。
- `REQUEST_DENIED` 关闭为 `dependency_failure`，provider `error_message` 不外泄。

## 独立验证

- Mapper/legacy contracts: 7/7。
- Route Sidecar: 23/23。
- Dry-run build 与 bundle preflight: 通过。
- 格式与 diff integrity: 通过。
- Bundle secret-pattern scan: 无命中。

本结论批准热修进入私有 Sidecar 部署，不替代修复后的真实 Owner smoke。
