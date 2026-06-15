# Directories

- `server/`：Node/Express 后端。
- `server/bin/`：ipatool 压缩包和校验文件。
- `server/config/`：keychain 配置。
- `server/data/`：SQLite/运行数据。
- `server/middleware/`：认证与 Apple 账号中间件。
- `server/static/`：静态前端资源。
- `server/utils/`：数据库、Apple、进度、WebSocket 工具。
- `client/`：React/Vite 前端。
- `client/locales/`：中英文翻译。
- `docs/archive/legacy-docs-20260615/`：旧文档归档目录。

# Services

- `ipa-harbor`：单容器 Web/API/静态服务。
- WebSocket：下载进度推送。

# Containers

- 示例 Compose：`server/docker-compose.example.yml`
- HTTP：`3080`
- HTTPS：`3443`
- 数据卷：`./data:/app/data`
- 证书卷：`./certs:/app/certs`

# Config Files

- `server/package.json`
- `client/package.json`
- `client/vite.config.js`
- `server/Dockerfile`
- `server/docker-compose.example.yml`
- `server/nodemon.json`
- `.github/workflows/publish-ghcr.yml`

# Scripts

- `dl_latest.sh`
- `server/package.json`
  - `npm start`
  - `npm run dev`
  - `npm run docker:build`
  - `npm run docker:run`
  - `npm run health`
- `client/package.json`
  - `pnpm dev`
  - `pnpm build`
  - `pnpm lint`
  - `pnpm preview`

# Scheduled Tasks

- 代码中使用 `node-cron` 依赖；具体任务需在后端代码中继续定位。
- GitHub workflow `publish-ghcr.yml` 用于镜像发布。

# Ports

- `3080`：HTTP。
- `3443`：HTTPS。
- `5173`：前端 Vite dev 默认访问端口。
- 示例本机映射：`3388:3080`。

# Domains

- `ALLOWED_DOMAINS` 控制公网访问白名单。
- README 示例使用 `example.com`。

# Reverse Proxies

公网 nginx 反代必须支持 WebSocket：

- `Upgrade`
- `Connection`
- `Host`
- `X-Real-IP`
- `X-Forwarded-For`
- `X-Forwarded-Proto`

# Databases

- SQLite
- `server/data/users.db`
- 容器运行数据目录 `/app/data`

# Storage Locations

- `/app/data`：IPA、tmp、管理员数据库等持久化数据。
- `/app/certs`：证书。
- `server/static/`：静态前端。
- `server/bin/`：ipatool 资产。

# Backup Locations

- Docker volume `ipa_data`
- Docker volume `ipa_certs`
- `docs/archive/legacy-docs-20260615/`

# Environment Variables

- `ALLOW_LAN_ACCESS`
- `ALLOWED_DOMAINS`
- `ENABLE_MORE_LOGS`
- `HTTPS_PORT`
- `KEYCHAIN_PASSPHRASE`
- `NODE_ENV`
- `PORT`

# External APIs

- Apple App Store / Apple ID auth flow through `ipatool`。
- GitHub release for ipatool assets.

# Integrations

- ipatool
- Docker / GHCR
- nginx reverse proxy
- SQLite
- WebSocket
- React/Vite frontend

# Secrets Inventory

敏感变量：

- `KEYCHAIN_PASSPHRASE`
- 管理员密码
- Apple ID 登录凭据
- JWT/session 相关 secret，如后端配置中存在

敏感文件：

- `server/data/users.db`
- `/app/data`
- `/app/certs/server.key`
