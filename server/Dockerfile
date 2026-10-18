# syntax=docker/dockerfile:1.4

# 官方 ipatool 是 glibc 动态链接，Alpine/musl 无法执行。
# 2.5.0 起就依赖 glibc；正式环境实际跑的是 2.6.x。
# 下面按 TARGETARCH 取 bin 里对应架构的最新归档，不按版本文字挑选。
FROM node:lts-bookworm-slim

RUN apt-get update && \
    apt-get install -y --no-install-recommends curl tar ca-certificates && \
    rm -rf /var/lib/apt/lists/*

WORKDIR /app
ARG TARGETARCH

# 复制 package 文件并安装依赖
COPY package*.json ./
RUN npm ci --omit=dev && npm cache clean --force

COPY . .

RUN set -ex && \
    case "$TARGETARCH" in \
    "amd64") TAR_FILE=$(ls bin/ipatool-*-linux-amd64.tar.gz | sort -V | tail -n 1) ;; \
    "arm64") TAR_FILE=$(ls bin/ipatool-*-linux-arm64.tar.gz | sort -V | tail -n 1) ;; \
    *) echo "Unsupported arch: $TARGETARCH" && exit 1 ;; \
    esac && \
    echo "Detected architecture: $TARGETARCH" && \
    echo "Using ipatool archive: $TAR_FILE" && \
    mkdir -p /tmp/ipatool && \
    tar -xzf "$TAR_FILE" -C /tmp/ipatool && \
    IPATOOL_BIN=$(find /tmp/ipatool -type f -name '*ipatool*' | head -n 1) && \
    if [ -z "$IPATOOL_BIN" ]; then \
    echo "ipatool binary not found after extraction" && exit 1; \
    fi && \
    cp "$IPATOOL_BIN" /app/bin/ipatool && \
    chmod +x /app/bin/ipatool && \
    /app/bin/ipatool --version && \
    rm -rf /tmp/ipatool && \
    find /app/bin ! -name "ipatool" ! -name "LICENSE.txt" -type f -exec rm -f {} + && \
    rm -f /app/Dockerfile /app/.dockerignore && \
    echo "ipatool installed successfully for $TARGETARCH"

# 设置环境变量
ENV NODE_ENV=production
ENV KEYCHAIN_PASSPHRASE=""
ENV PORT=3080
ENV ALLOWED_DOMAINS=""
ENV ENABLE_MORE_LOGS=false
ENV ALLOW_LAN_ACCESS=true
# Linux 容器没有图形钥匙串，避免 dbus 把 ipatool 登录卡住
ENV DBUS_SESSION_BUS_ADDRESS=unix:path=/nonexistent

# 创建非 root 用户和数据目录
RUN groupadd --gid 1001 nodejs && \
    useradd --uid 1001 --gid nodejs --system --no-create-home ij369 && \
    chown -R ij369:nodejs /app

USER ij369

# 声明数据持久化卷
VOLUME ["/app/data"]

EXPOSE 3080

HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
    CMD curl -f http://localhost:$PORT/health || exit 1

CMD ["node", "app.js"]
