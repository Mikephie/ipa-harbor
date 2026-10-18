const { ipatoolEnvForAccount } = require('../../utils/appleAccount');
const { runIpatool, withKeychain } = require('../../utils/ipatoolExec');

function executeIpatool(args, accountId) {
    return runIpatool(args, {
        timeout: 60000,
        env: ipatoolEnvForAccount(accountId),
    }).then(({ stdout }) => {
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
 * 购买App
 */
async function purchaseHandler(req, res) {
    try {
        const { bundleId } = req.params;

        // 参数验证
        if (!bundleId) {
            return res.status(400).json({
                success: false,
                message: 'Bundle ID是必需的参数',
                error: '请在URL路径中提供bundleId'
            });
        }

        // 构建ipatool purchase命令
        const purchaseArgs = withKeychain(['purchase', '-b', String(bundleId)]);

        try {
            const result = await executeIpatool(purchaseArgs, req.appleAccountId);

            if (result.success) {
                return res.json({
                    success: true,
                    message: '购买/领取成功',
                    bundleId: bundleId,
                    data: result.data || result.rawOutput
                });
            } else {
                return res.status(500).json({
                    success: false,
                    message: '购买/领取失败',
                    error: result.error
                });
            }
        } catch (execError) {
            // console.error('执行ipatool purchase命令时出错:', execError);

            // 检查是否是认证相关错误
            if (execError.stdout && (
                execError.stdout.includes('failed to get account')
            )) {
                return res.status(401).json({
                    success: false,
                    message: '用户未登录或认证信息已过期',
                    error: '请先登录'
                });
            }

            // 检查是否是已经拥有的错误
            if (execError.stderr && (
                execError.stderr.includes('already purchased') ||
                execError.stderr.includes('已购买') ||
                execError.stderr.includes('already own')
            )) {
                return res.status(409).json({
                    success: false,
                    message: '该应用已经购买过了',
                    error: '无需重复购买'
                });
            }

            return res.status(500).json({
                success: false,
                message: '购买/领取时发生错误',
                error: execError.message || '执行命令失败'
            });
        }

    } catch (error) {
        // console.error('购买处理错误:', error);
        return res.status(500).json({
            success: false,
            message: '服务器内部错误',
            error: error.message
        });
    }
}

module.exports = purchaseHandler;
