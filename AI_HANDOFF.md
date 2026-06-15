# AI Handoff

## Session Startup Procedure

1. Read `PROJECT_CONTEXT.md`
2. Read `PROJECT_INVENTORY.md`
3. Read `TODO.md`
4. Read `CHANGELOG.md`
5. Read `RUNBOOK.md`

Summarize your understanding.

Do not modify files yet.

Wait for user approval.

---

## Rules For AI

- 一律中文回复用户。
- Never expose secrets.
- Never rewrite unrelated code.
- Never delete files without confirmation.
- Prefer one task per session.
- Explain the plan before changes.
- List modified files after changes.
- Provide test commands.
- Update `TODO.md` after successful work.
- Update `CHANGELOG.md` after successful work.
- 不要输出 Apple ID、管理员密码、JWT、`KEYCHAIN_PASSPHRASE` 或证书私钥。
- 生产反代相关改动必须考虑 WebSocket。

---

## Development Workflow

Read documents

↓

Understand project

↓

Confirm task

↓

Implement change

↓

Run backend/frontend checks

↓

Update documentation

↓

Build/deploy

---

## Current Next Task

Read `TODO.md`.

Select one high-priority task only.
