# 2026-10-16 Apple 登录回归

正式环境从带登录补丁的运行状态升级到 2.6.3 后，网页登录改为向 Apple 重新认证，并出现误导性的 ipatool 版本提示。马来西亚账号的本地会话被撤销流程清掉，后来又在一次失败登录中被改写。恢复备份并重新挂上 `login.js`、`revoke.js` 后，使用者确认可以登录。

本文只记录事故结论。不记录 Apple ID、密码、Cookie、Token、Keychain 明文或 SAP 秘密。

## 已确认事实

1. 2.6.2 正式环境靠部署目录里的源码覆盖维持登录和相关行为，而不是只靠镜像内的程序。2026-10-02 升级前的 Compose 备份挂有五个覆盖：`overrides/api/auth/login.js`、`overrides/api/auth/revoke.js`、`overrides/utils/appleAccount.js`、`overrides/app.js`、`overrides/taskManager.js`。其后又使用 `overrides/api/app/search.js` 和 `overrides/api/app/details.js`。2.6.3 发布范本写明移除这七个源码覆盖挂载。
2. 升级到 2.6.3 并重建容器后，正式容器只挂数据目录和两份证书。上述七个覆盖都没有挂上。新镜像没有完整保留旧的登录补丁行为：网页登录会执行 `ipatool` 登录，网页撤销会删除本地会话。
3. 新版网页登录向 Apple 重新认证。失败响应被既有逻辑归成 HTTP 403 / SAP 一类，页面显示认证失败。容器日志只留下「执行 ipatool 登录命令失败」，没有留下上游响应正文。
4. 页面提示「需要官方 ipatool 2.5.0 或更新版本」来自既有错误分类，不能用来判断二进制版本。事故当时容器内的 `ipatool` 是 `2.6.2-3411d57-h2`。
5. 马来西亚账号在网页撤销后失去 `account` 文件，`cookies` 不再是有效会话文件，只剩 5 字节。这次撤销走的是镜像里的撤销程序，不是「保留现有商店会话」的补丁。
6. 已从 2.6.3 升级前的 NAS 备份恢复该账号的 `account`（898 字节）和 `cookies`（5675 字节）。备份校验和与预期一致。中国账号、`users.db` 和 SAP 缓存未纳入这次恢复，恢复后核对它们未被改写。
7. 恢复之后的一次网页登录仍然向 Apple 重新认证并失败。这次失败把 `cookies` 改成 3596 字节，`account` 仍是 898 字节。随后再次用同一份升级前备份把 `cookies` 放回 5675 字节。
8. 最终只重新挂载两个补丁：`overrides/api/auth/login.js`、`overrides/api/auth/revoke.js`。另外五个覆盖没有重新挂载。
9. 重新挂载后的登录程序在本地 Keychain 能解密、且账号一致时，网页和手机 App 都重用已有会话，不再向 Apple 做全新认证。没有验证码要提交时才走这条路径。
10. 手机 App 的撤销请求不删除本地 Keychain。网页撤销仍然删除本地凭据。
11. 处理结束后的正式容器仍是 2.6.3（`mikephie/ipa-harbor@sha256:5b38439e6b3ff3ab2e4ca0a48f348833413bed25101bbb63e935e6d0a1fa29b1`）。状态为 running、healthy，`/health` 返回 HTTP 200。
12. 使用者确认，到本文编写时网页已经可以登录。

本地 Keychain 可读只说明当时的解密和字段检查通过：账号与目录一致，商店字段齐全，cookie 条目为 15。这不等于 Apple 上游会话有效。

## 推测

- 403 / SAP 分类对应的是登录程序里的固定提示，触发条件包括认证失败、空响应或签名相关错误。日志没有保存 `ipatool` 原始输出，所以上游究竟返回了哪一种正文，没有单独核实。
- 失败登录会改写 `cookies`，说明当时的登录程序在认证失败时仍写了账号目录。本文没有把这一点推广成所有失败路径都会清空 Keychain。

## 尚未验证

- 代理没有获得授权去执行真实的 Apple 登录、撤销或清除会话。代理侧的真实登录验收是 `NOT_TESTED`。第 12 条是使用者确认，不是代理代做的上游登录测试。
- 本地解密成功没有被用来宣称 Apple 上游会话有效。
- `search.js`、`details.js`、`appleAccount.js`、`app.js`、`taskManager.js` 这五个覆盖是否已经完整做进 2.6.3 镜像，本次没有逐项对照。
- 中国账号的文件在恢复马来西亚会话时保持未改。本次没有对中国账号做登录验收。
- Docker healthy 和 `/health` HTTP 200 只说明进程与健康检查通过，没有被当作登录功能验收。
