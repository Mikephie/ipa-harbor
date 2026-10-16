# AGENTS.md

本文件于 2026-10-16 建立。建立前，仓库根目录没有 `AGENTS.md`。

## Apple Authentication Regression Guard

2026-10-16 的正式环境把登录覆盖从 Compose 拿掉，但 2.6.3 镜像没有完整接过这些行为。网页因此向 Apple 重新认证，本地会话也被清掉或改写。以后改登录、撤销或发布镜像时遵守下面的规则。事故记录见 `docs/incidents/2026-10-16-apple-login-regression.md`。

- 不得在 Docker 升级时直接移除登录或撤销补丁。
- 移除 overrides 前，必须逐一核对功能已合并到映像。
- 必须保留既有网页及 App 会话重用行为，除非经明确授权修改。
- 不得把本地 Keychain 可解密误称为 Apple 上游会话有效。
- 不得在登录失败时自动删除 Keychain 或 Cookies。
- 不得将网页退出和 Apple 会话撤销混为一谈。
- 目前网页撤销会删除本地凭据，操作前必须警告。
- 不得只根据 HTTP 200 或 Docker healthy 判定登录功能正常。
- 正式发布前必须验证 Compose 挂载与映像内的实际生效程序。
- 涉及 Apple 登录或撤销的改动，必须有针对性回归测试及可执行的回滚方案。
- 不得未经授权执行真实 Apple 登录、撤销、清除会话或覆盖正式账号资料。
