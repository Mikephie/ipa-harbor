const {
    isValidAppleAccountId,
    getAppleAccountHome,
    setAppleAccountCookie,
} = require('../../utils/appleAccount');
const fs = require('fs');
const { fetchAppleAuthInfo, isAuthInfoFailure } = require('../../utils/fetchAppleAuthInfo');

/**
 * 切换到已登录过的账号（仅换 Cookie，不重新输入密码）
 */
async function switchAccountHandler(req, res) {
    try {
        const { accountId } = req.body || {};

        if (!isValidAppleAccountId(accountId)) {
            return res.status(400).json({
                success: false,
                message: '无效的 accountId',
                error: 'Bad Request',
            });
        }

        const home = getAppleAccountHome(accountId);
        if (!fs.existsSync(home)) {
            return res.status(404).json({
                success: false,
                message: '该账号在本机无保存会话',
                error: 'Account not found',
            });
        }

        try {
            const userData = await fetchAppleAuthInfo(accountId);
            setAppleAccountCookie(res, accountId);
            return res.json({
                success: true,
                message: '已切换账号',
                data: userData,
            });
        } catch (execError) {
            if (isAuthInfoFailure(execError)) {
                return res.status(401).json({
                    success: false,
                    message: '该账号会话已失效，请重新登录',
                    error: 'Session expired',
                });
            }
            console.error('切换账号时 auth info 失败:', execError);
            return res.status(500).json({
                success: false,
                message: '切换账号失败',
                error: execError.message || '执行失败',
            });
        }
    } catch (error) {
        console.error('切换账号错误:', error);
        return res.status(500).json({
            success: false,
            message: '服务器内部错误',
            error: error.message,
        });
    }
}

module.exports = switchAccountHandler;
