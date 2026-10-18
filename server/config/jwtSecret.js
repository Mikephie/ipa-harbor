// 只供本機開發。正式環境不得使用，也不得寫入日誌。
const DEVELOPMENT_JWT_SECRET = 'development-only-jwt';

function resolveJwtSecret(env = process.env) {
    const configured = typeof env.JWT_SECRET === 'string' ? env.JWT_SECRET.trim() : '';
    if (env.NODE_ENV === 'production') {
        if (!configured) {
            return {
                ok: false,
                message: '生产环境必须显式设置 JWT_SECRET。请沿用当前正在签发登录令牌的值，不要在本次启动时新生成密钥。',
            };
        }
        return { ok: true, secret: configured };
    }
    return { ok: true, secret: configured || DEVELOPMENT_JWT_SECRET };
}

function enforceJwtSecret(env = process.env, exit = process.exit) {
    const result = resolveJwtSecret(env);
    if (!result.ok) {
        console.error(result.message);
        exit(1);
    }
    return result.secret;
}

module.exports = {
    resolveJwtSecret,
    enforceJwtSecret,
};
