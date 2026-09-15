# Technical Decisions

本文件记录项目的重要设计决策。

新增决策时直接追加。

不要覆盖历史内容。

---

# 为什么选择 ipatool

Decision:

使用 ipatool 作为核心下载引擎。

Reason:

* 成熟稳定
* 长期维护
* 社区活跃
* 支持历史版本
* 支持 Apple ID 登录

Benefits:

* 不重复造轮子
* 降低维护成本
* 跟随 ipatool 更新

---

# 为什么使用 Docker

Decision:

默认使用 Docker 部署。

Reason:

* 跨平台
* 易迁移
* 易备份
* 易升级

Benefits:

* 一条命令启动
* 快速恢复
* 环境一致

---

# 为什么使用 SQLite

Decision:

使用 SQLite。

Reason:

* 数据量小
* 部署简单
* 无需额外数据库

Benefits:

* 零配置
* 易备份
* 易迁移

---

# 为什么需要 KEYCHAIN_PASSPHRASE

Decision:

所有 Apple 凭据必须受保护。

Reason:

Apple ID 访问权限属于敏感数据。

Benefits:

* 降低凭据泄露风险
* 提高本地存储安全性

Rules:

* 不输出
* 不记录
* 不写入文档

---

# 为什么支持 HTTPS

Decision:

支持 HTTPS 原生部署。

Reason:

Apple 登录流程涉及敏感数据。

Benefits:

* 更安全
* 更适合公网部署

---

# 为什么增加 ALLOWED_DOMAINS

Decision:

增加访问白名单。

Reason:

避免任意来源访问后台。

Benefits:

* 降低暴露面
* 降低误配置风险

---

# 为什么保留 WebSocket

Decision:

使用 WebSocket 推送进度。

Reason:

下载任务持续时间较长。

Benefits:

* 实时进度
* 更好的用户体验

Alternative:

轮询 API。

Rejected:

效率更低。

---

# 为什么推荐单容器单 Apple ID

Decision:

一个容器对应一个 Apple ID。

Reason:

* 风险隔离
* 区域隔离
* 故障隔离

Benefits:

* 更容易排查问题
* 更容易迁移

---

# 为什么不记录真实凭据

Decision:

文档中永远不记录：

* Apple ID
* 密码
* KEYCHAIN_PASSPHRASE
* JWT Secret
* 证书私钥

Reason:

文档未来可能：

* 上传 Git
* 分享给他人
* 提供给 AI

Benefits:

* 降低泄露风险

---

# AI Working Rules

AI 修改前：

1. 阅读 PROJECT_CONTEXT.md
2. 阅读 PROJECT_INVENTORY.md
3. 阅读 ARCHITECTURE.md
4. 阅读 DECISIONS.md
5. 阅读 TODO.md

AI 修改后：

1. 更新 TODO.md
2. 更新 CHANGELOG.md
3. 提供测试步骤
4. 列出修改文件

---

# 为什么生产镜像改用 Debian 而不是 Alpine

Decision:

`server/Dockerfile` 使用 `node:lts-bookworm-slim`。

Reason:

官方 `ipatool` 2.3.x 是静态 Go 二进制，Alpine 能跑。2.5.0 改为 glibc 动态链接（`/lib/ld-linux-*.so.1`），在 musl 上会出现 `no such file or directory` / `error relocating`，Web 登录会失败。

Benefits:

* 官方 Linux 资产可直接运行
* 构建时用 `ipatool --version` 做冒烟检查

---

# 为什么容器用官方 ipatool 2.5.0，而不是 sapfix

Decision:

Docker / 群晖镜像只使用官方 `majd/ipatool` 2.5.0 或更新版本。

Reason:

* Apple 已改为 SAP 签名认证；官方 2.3.x 会返回 HTTP 403 / `something went wrong`。
* `ipatool-sapfix` 是 macOS 过渡版，依赖 CommerceKit，不能在 Linux 容器里运行。
* 官方 2.4.0+ 已提供跨平台 SAP 实现；2.5.0 是当前稳定线。

Benefits:

* Web 登录与 CLI 能力一致
* 镜像可同时支持 amd64 / arm64
* 不再依赖已停止功能开发的 fork

---

# Future Decisions

未来新增：

* 多用户支持
* 多 Apple ID 支持
* 集群部署
* 自动备份
* 监控系统

时，应记录到本文件。
