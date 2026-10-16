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

更新 ipatool 资产（官方 Linux 包，最低 2.5.0，含 sha256 校验）：

```sh
chmod +x dl_latest.sh
./dl_latest.sh
```

不要把 macOS 的 `ipatool-sapfix` 拷进 `server/bin/` 或容器。

构建镜像：

```sh
docker build -t ipaharbor . --load
```

前端构建：

```sh
cd client
pnpm build
```

# 发布检查表

发布或升级正式容器前逐项填写。真实登录未获授权时，`REAL_LOGIN_ACCEPTANCE_CHECK` 必须写 `NOT_TESTED`，不得写成 `PASS`。本地 Keychain 能解密、`/health` 返回 HTTP 200、容器显示 healthy，都不能代替这项验收，也不能用来宣称 Apple 上游会话有效。

未来发布新 Docker 映像时，必须确认 2026-10-16 重新挂上的 `overrides/api/auth/login.js` 和 `overrides/api/auth/revoke.js` 已经完整做进正式映像，或者新 Compose 继续保留这两个挂载。不得再出现「挂载已去掉，功能没有合并」的情况。其余覆盖在去掉之前也要逐项核对。规则见 `AGENTS.md`，事故见 `docs/incidents/2026-10-16-apple-login-regression.md`。

| 检查项 | 要求 | 2026-10-16 状态 |
| --- | --- | --- |
| `APPLE_AUTH_PATCH_CHECK` | 登录与撤销补丁要么在映像内，要么仍由 Compose 挂载，且容器内生效文件与预期一致 | 两个补丁已重新挂载并在容器内看到会话重用逻辑。另外五个覆盖没有重新挂载，也未逐项证明已合并进映像 |
| `SESSION_REUSE_CHECK` | 网页和 App 在本地 Keychain 可解密且账号一致时重用会话，不向 Apple 重新认证 | 挂载后的程序包含该路径。本地解密检查通过。这不是上游会话验收 |
| `REVOKE_BEHAVIOR_CHECK` | App 撤销不删除本地 Keychain；网页撤销仍会删除，执行前必须警告 | 已核对挂载后的撤销程序。没有对正式账号执行撤销 |
| `COMPOSE_MOUNT_CHECK` | 实际容器挂载与 Compose 一致，不能只看模板注释 | 重建后的容器挂有 `login.js`、`revoke.js`、数据目录和证书。七个旧覆盖没有全部挂回 |
| `ACCOUNT_DATA_PRESERVATION_CHECK` | 升级和恢复不得改写无关账号、`users.db` 或 SAP 缓存 | 马来西亚账号按升级前备份恢复。中国账号、`users.db`、SAP 缓存在该次恢复中未改 |
| `REAL_LOGIN_ACCEPTANCE_CHECK` | 经授权后由使用者或指定验收完成真实登录。未授权则为 `NOT_TESTED` | 代理侧 `NOT_TESTED`。使用者确认当时网页已经可以登录 |
| `ROLLBACK_READINESS_CHECK` | 覆盖账号数据或更换登录程序前，已有可执行的回滚，且不覆盖原备份 | 恢复前保留了当时的账号目录副本和升级前备份。原备份没有被覆盖 |

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
- Web 登录显示 `something went wrong` 或 HTTP 403：若容器内 ipatool 仍是 2.3.x，需要官方 2.5.0+ 并重新发布镜像。先执行 `ipatool --version`。2026-10-16 的同类提示是既有错误分类，当时二进制已是 `2.6.2-3411d57-h2`，不要据此判断版本过旧，也不要因此拆除登录补丁。见 `docs/incidents/2026-10-16-apple-login-regression.md`。
- 本机 `ipatool auth login` 成功但网页失败：macOS Keychain 会话不会同步到群晖容器，必须在 Web 里重新登录。
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
