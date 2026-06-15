# Architecture

## Overview

IPA-Harbor 是一个基于 ipatool 的 Web 管理系统。

主要功能：

* App 搜索
* 历史版本查询
* IPA 下载
* Apple ID 管理
* 下载进度展示
* Docker 部署
* HTTPS 支持

系统采用：

```text
React/Vite
+
Node.js/Express
+
SQLite
+
ipatool
```

---

# High Level Architecture

```text
Browser
    │
    ▼
React / Vite Frontend
    │
    ▼
Express API Server
    │
    ├── Auth Middleware
    │
    ├── Apple Account Middleware
    │
    ├── WebSocket Server
    │
    ├── Database Layer
    │
    ▼
ipatool
    │
    ▼
Apple App Store
```

---

# Frontend

Location:

```text
client/
```

Technology:

```text
React
Vite
JavaScript
```

Responsibilities:

* 登录页面
* 管理后台
* 搜索界面
* 下载管理
* 下载进度显示

---

# Backend

Location:

```text
server/
```

Technology:

```text
Node.js
Express
```

Responsibilities:

* API
* 用户认证
* Apple ID 管理
* 下载任务管理
* WebSocket 推送
* 数据库访问

Entry:

```text
server/app.js
```

---

# Authentication Layer

Key Files:

```text
server/middleware/auth.js
```

Responsibilities:

* 管理员认证
* Session/JWT 验证
* 权限控制

---

# Apple Account Layer

Key Files:

```text
server/middleware/appleAccount.js

server/utils/appleAccount.js
```

Responsibilities:

* Apple ID 登录
* Keychain 管理
* App Store 认证

---

# Database Layer

Database:

```text
SQLite
```

Location:

```text
server/data/users.db
```

Responsibilities:

* 用户配置
* 管理员数据
* 系统配置

---

# Download Engine

Core:

```text
ipatool
```

Location:

```text
server/bin/
```

Responsibilities:

* 搜索 App
* 查询历史版本
* 下载 IPA

---

# WebSocket Layer

Key File:

```text
server/utils/websocketServer.js
```

Purpose:

实时推送：

* 下载状态
* 下载进度
* 任务完成通知

Requirements:

反向代理必须支持：

```text
Upgrade
Connection
```

否则进度显示失效。

---

# Storage

Persistent Data:

```text
/app/data
```

Contains:

* IPA 文件
* SQLite 数据库
* 缓存数据
* 下载记录

Certificates:

```text
/app/certs
```

Contains:

* server.crt
* server.key

````

---

# Deployment Architecture

Docker:

```text
Container
    │
    ├── /app/data
    │
    ├── /app/certs
    │
    └── ipatool
````

Ports:

```text
3080 HTTP
3443 HTTPS
```

---

# Security Architecture

Protected Assets:

```text
Apple ID Credentials

KEYCHAIN_PASSPHRASE

Admin Password

Certificates

Session Secrets
```

Rules:

* 不记录真实值
* 不输出到日志
* 不写入文档

---

# Future Architecture Goals

* 增加健康检查
* 增加自动备份
* 增加多节点支持
* 增加任务监控
* 增加系统监控面板
