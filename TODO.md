# TODO

## High Priority

- [ ] 确认部署环境已设置随机 `KEYCHAIN_PASSPHRASE`，且未使用示例值。
- [ ] 确认公网部署时 `ALLOWED_DOMAINS` 和 `ALLOW_LAN_ACCESS=false`。
- [ ] 明确 `server/data/users.db` 与 `/app/data` 的备份策略。

## Medium Priority

- [ ] 给后端增加 health/API smoke test 文档。
- [ ] 给 nginx/WebSocket 反代配置补充生产检查清单。
- [ ] 将本机已改的 ipatool 2.5.0 / SAP 登录修复发布到 GHCR，并在群晖 `docker compose pull && up -d`。

## Low Priority

- [ ] 清理本地 `node_modules` 相关提交风险。
- [ ] 将 README 中中英文长说明拆分或归档。

## Investigation Required

- [ ] 确认 `node-cron` 当前是否有启用任务。
- [ ] 确认 GHCR 发布 workflow 当前目标镜像名和 token 来源。

## Done

- [x] 2026-09-13 官方 ipatool 最低 2.5.0，`dl_latest.sh` 增加 sha256 校验，登录页不再回显原始 JSON。
- [x] 2026-06-15 重建统一维护文档。
