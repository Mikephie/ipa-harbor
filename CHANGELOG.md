# CHANGELOG

## 2026-09-13

### Added

- `/v1/ota/genPlist`：给手机 itms-services 提供 HTTPS 安装清单。`api.palera.in` 已 500，本机 HTTP 清单会被系统拒。

- 管理员登录 JSON 现在返回 `data.token`，`/v1/auth` 同时接受 `Authorization: Bearer`。
- Apple 登录在请求头 `X-Export-Store-Session: 1` 时导出 DSID / passwordToken / StoreFront / cookies，给 APP 在 5G 上远程登录用。
- `/health` 增加 `sessionExport: true`，方便客户端识别新镜像。

### Fixed

- 生产镜像从 Alpine 换成 Debian slim。官方 ipatool 2.5.0 是 glibc 动态链接，Alpine 里无法执行，Web 登录会失败。
- 搜索结果点开会错到 Apple Music：详情/图标在美区 iTunes 查询，国区 App 查不到时只剩全球应用。现已按国区回退，并禁止打开点错的 App。
- 商店地区写入账号目录，容器重启后不再丢失。

### Fixed

- Apple ID Web 登录不再把 ipatool 的原始 JSON（例如 `something went wrong`）直接显示给用户。
- 识别 HTTP 403 / SAP 认证失败，并提示容器需要官方 ipatool 2.5.0+。
- 登录等待时间延长到 4 分钟，避免官方 ipatool 首次 SAP 握手被 30 秒超时打断。

### Changed

- `dl_latest.sh` 只拉取官方 `majd/ipatool` 的 Linux amd64/arm64 资产，校验 sha256，并要求不低于 2.5.0。
- 登录页补充 SAP / 版本过旧说明；首次登录会提示可能需要一两分钟。

### Notes

- Linux 容器必须使用官方 ipatool。macOS 过渡版 `ipatool-sapfix` 依赖 CommerceKit，不能放进群晖/Docker 镜像。
- 已用 OrbStack 构建并推送 `mikephie/ipa-harbor:latest` 与 `mikephie/ipa-harbor:2.5.0-sap`（linux/amd64 + linux/arm64，内置官方 ipatool 2.5.0）。
- 群晖 compose 应从 `ghcr.io/mikephie/ipa-harbor:latest` 改为 `mikephie/ipa-harbor:latest` 后再 pull。

## 2026-06-15

### Documentation

- Rebuilt documentation from local project analysis.
- Added project context, inventory, runbook, TODO, changelog, and AI handoff.
