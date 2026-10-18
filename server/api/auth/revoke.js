const {
    readAppleAccountIdFromRequest,
    ipatoolEnvForAccount,
    clearAppleAccountCookie,
    wipeIpatoolSession,
} = require('../../utils/appleAccount');
const { runIpatool, buildAuthRevokeArgs } = require('../../utils/ipatoolExec');

function executeIpatool(args, execOptions = {}) {
    return runIpatool(args, { timeout: 15000, ...execOptions }).then(({ stdout }) => {
        try {
            return { success: true, data: JSON.parse(stdout) };
        } catch (_) {
            return { success: true, rawOutput: stdout };
        }
    }).catch((failure) => Promise.reject({
        success: false,
        error: 'ipatool exited',
        stderr: failure.stderr || '',
        stdout: failure.stdout || '',
    }));
}

/**
 * 撤销认证
 */
async function revokeHandler(req, res) {
    try {
        const accountId = readAppleAccountIdFromRequest(req);
        if (!accountId) {
            clearAppleAccountCookie(res);
            return res.status(401).json({
                success: false,
                message: '用户未登录或认证信息已过期',
                error: '没有可撤销的认证信息',
            });
        }

        const userAgent = String(req.headers['user-agent'] || '');
        if (userAgent.includes('CFNetwork') || userAgent.includes('APP/')) {
            return res.json({
                success: true,
                message: '已保留现有商店会话',
            });
        }

        const execEnv = { env: ipatoolEnvForAccount(accountId) };

        // 网页撤销仍调用 ipatool，并清掉该账号钥匙串。App 在上面已经返回。
        try {
            const result = await executeIpatool(buildAuthRevokeArgs(), execEnv);

            if (result.success) {
                try {
                    wipeIpatoolSession(accountId);
                } catch (_) {
                    /* 撤销接口已成功，文件清不掉也不阻断 */
                }
                clearAppleAccountCookie(res);
                return res.json({
                    success: true,
                    message: '撤销认证成功',
                    data: result.data || result.rawOutput
                });
            } else {
                return res.status(500).json({
                    success: false,
                    message: '撤销认证失败',
                    error: result.error
                });
            }
        } catch (execError) {
            // console.error('执行ipatool revoke命令时出错:', execError);

            // 检查是否是未登录的错误
            if (execError.stderr && (
                execError.stderr.includes('not logged in') ||
                execError.stderr.includes('未登录') ||
                execError.stderr.includes('authentication') ||
                execError.stderr.includes('keychain')
            )) {
                try {
                    wipeIpatoolSession(accountId);
                } catch (_) {
                    /* ignore */
                }
                clearAppleAccountCookie(res);
                return res.status(401).json({
                    success: false,
                    message: '用户未登录或认证信息已过期',
                    error: '没有可撤销的认证信息'
                });
            }

            return res.status(500).json({
                success: false,
                message: '撤销认证时发生错误',
                error: execError.message || '执行命令失败'
            });
        }

    } catch (error) {
        // console.error('撤销认证错误:', error);
        return res.status(500).json({
            success: false,
            message: '服务器内部错误',
            error: error.message
        });
    }
}

module.exports = revokeHandler;
