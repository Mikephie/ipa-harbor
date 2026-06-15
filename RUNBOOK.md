# Overview

`ipa-harbor` 是单容器 Web 管理工具，后端 Node/Express，前端 React/Vite，核心下载能力来自 `ipatool`。

# Start

Docker 快速启动：

```sh
docker run -d \
  -p 3388:3080 \
  -e KEYCHAIN_PASSPHRASE=$(openssl rand -base64 15 | tr -dc 'A-Za-z0-9' | head -c10) \
  -e PORT=3080 \
  -v ipa_data:/app/data \
  --name ipa-harbor \
  uuphy/ipa-harbor:latest
```

后端本地开发：

```sh
cd server
npm install
npm run dev
```

前端本地开发：

```sh
cd client
pnpm install
pnpm dev
```

# Stop

```sh
docker stop ipa-harbor
```

# Restart

```sh
docker restart ipa-harbor
```

# Status Check

```sh
docker ps --filter name=ipa-harbor
docker logs --tail 100 ipa-harbor
```

本地后端：

```sh
cd server
npm run health
```

# Logs

```sh
docker logs -f ipa-harbor
```

开发模式日志在对应终端。

# Health Check

```sh
curl -f http://localhost:3080/health
```

如果使用示例映射：

```sh
curl -f http://localhost:3388/health
```

# Update Procedure

更新 ipatool 资产：

```sh
chmod +x dl_latest.sh
./dl_latest.sh
```

构建镜像：

```sh
docker build -t ipaharbor . --load
```

前端构建：

```sh
cd client
pnpm build
```

# Backup Procedure

必须备份：

- Docker volume `ipa_data`
- Docker volume `ipa_certs`
- `server/data/users.db`，如使用本地开发数据
- `/app/certs/server.key`，如使用自备证书

# Restore Procedure

恢复容器时挂回原数据卷：

```sh
docker run -d \
  -p 3388:3080 \
  -e KEYCHAIN_PASSPHRASE=<existing-passphrase> \
  -e PORT=3080 \
  -v ipa_data:/app/data \
  -v ipa_certs:/app/certs \
  --name ipa-harbor \
  uuphy/ipa-harbor:latest
```

不要在文档或聊天里写出真实 passphrase。

# Common Problems

- 首次启动失败：检查 `KEYCHAIN_PASSPHRASE` 是否设置。
- 公网访问被拒：检查 `ALLOWED_DOMAINS` 和 `ALLOW_LAN_ACCESS`。
- 下载进度不更新：检查反代 WebSocket header。
- Apple 登录异常：确认每个容器建议使用独立 Apple ID，且 region 与主机 IP 合理。
- 数据丢失：检查 `/app/data` 是否持久化挂载。

# Troubleshooting

```sh
docker logs --tail 200 ipa-harbor
docker exec -it ipa-harbor ls -la /app/data
docker exec -it ipa-harbor ls -la /app/certs
```

# Useful Commands

```sh
cd server && npm start
cd server && npm run dev
cd server && npm run health
cd client && pnpm dev
cd client && pnpm build
docker build -t ipaharbor . --load
```
