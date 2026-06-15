# ipa-harbor

# Purpose

`ipa-harbor` 是一个基于 `ipatool` 的 IPA 可视化 Web 管理工具，支持 App 搜索、历史版本下载、进度展示、管理员面板和 Docker 容器化部署。

# Current Status

- 后端是 Node.js/Express，入口 `server/app.js`。
- 前端是 React/Vite，位于 `client/`。
- 生产容器使用 `server/Dockerfile`。
- 数据和 IPA 文件持久化在 `/app/data`。
- `ipatool` 二进制通过 `server/bin/` 资产进入镜像。

# Deployment Location

- 本地仓库：`/Users/mikephie/Documents/GitHub/ipa-harbor`
- 默认容器 HTTP 端口：`3080`
- 默认容器 HTTPS 端口：`3443`
- 默认本机体验端口：`3388:3080`
- 持久化数据卷：`/app/data`
- 持久化证书卷：`/app/certs`

# Runtime Architecture

- Express 后端提供 API、认证、Apple 账号中间件、WebSocket 进度、静态前端。
- SQLite 数据库存放在 `server/data/users.db` 或容器数据目录。
- 前端构建产物可放入 `server/static/` 由后端服务。
- `ipatool` 负责 Apple App 搜索和 IPA 下载。
- `KEYCHAIN_PASSPHRASE` 用于保护 Apple ID 访问凭据。

# Main Components

- `server/app.js`：后端入口。
- `server/middleware/auth.js`：管理面板认证。
- `server/middleware/appleAccount.js`：Apple 账号上下文。
- `server/utils/appleAccount.js`：Apple 账号工具。
- `server/utils/database.js`：SQLite 数据库访问。
- `server/utils/fetchAppleAuthInfo.js`：Apple auth 信息获取。
- `server/utils/progressParser.js`：下载进度解析。
- `server/utils/websocketServer.js`：WebSocket 进度推送。
- `client/src/`：React 前端。
- `server/Dockerfile`：生产镜像。
- `dl_latest.sh`：下载最新 ipatool 资产。

# Important Files

- `README.md`
- `server/package.json`
- `client/package.json`
- `server/Dockerfile`
- `server/docker-compose.example.yml`
- `server/app.js`
- `server/config/keychain.js`
- `server/data/users.db`
- `client/vite.config.js`
- `.github/workflows/publish-ghcr.yml`

# Environment Variables

重要变量：

- `KEYCHAIN_PASSPHRASE`
- `PORT`
- `HTTPS_PORT`
- `ALLOW_LAN_ACCESS`
- `ALLOWED_DOMAINS`
- `ENABLE_MORE_LOGS`
- `NODE_ENV`

# External Dependencies

- `ipatool`
- Docker
- Node.js
- npm / pnpm
- SQLite
- Apple ID / App Store 服务
- WebSocket-capable reverse proxy

# Known Issues

- `KEYCHAIN_PASSPHRASE` 泄露会影响 Apple ID 访问凭据安全，不能写入文档或日志。
- 公网部署必须设置 `ALLOWED_DOMAINS` 并建议关闭 `ALLOW_LAN_ACCESS`。
- WebSocket 进度展示要求反代保留 `Upgrade` / `Connection`。
- `client/node_modules` 和 `server/node_modules` 已存在于本地，分析和提交时不要纳入文档变更。
- `server/data/users.db` 是运行数据，不能随意删除或公开。

# Technical Debt

- 明确运行数据、下载 IPA、临时文件和数据库的备份策略。
- 给 Docker 环境变量补充 required/optional 表。
- 增加后端 health/API smoke test。
- 明确 `server/bin/ipatool-*` 资产更新流程。

# Do Not Change Without Care

- `KEYCHAIN_PASSPHRASE` 和 Apple ID 账号数据。
- `/app/data` 与 `server/data/users.db`。
- `server/bin/` 中 ipatool 资产。
- 反代 WebSocket 配置。
- 管理员登录初始化逻辑。

# Current Development Direction

- 保持 Docker 一键部署体验。
- 保持前后端和 ipatool 二进制更新流程清晰。
- 统一根目录文档入口。

# Notes For Future AI Sessions

- 一律中文。
- 不要输出 Apple ID、管理员密码、JWT、keychain passphrase。
- 改前端后要运行 `pnpm build`。
- 改后端后要运行 `npm start` 或 health 检查。
