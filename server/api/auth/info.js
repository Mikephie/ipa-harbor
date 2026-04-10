const { readAppleAccountIdFromRequest } = require('../../utils/appleAccount');
const { fetchAppleAuthInfo, isAuthInfoFailure } = require('../../utils/fetchAppleAuthInfo');

/**
 * 获取认证信息
 */
async function infoHandler(req, res) {
    try {
        const accountId = readAppleAccountIdFromRequest(req);
        if (!accountId) {
            return res.status(401).json({
                success: false,
                message: '用户未登录或认证信息已过期',
                error: '请先登录 Apple 账号',
            });
        }

        try {
            const userData = await fetchAppleAuthInfo(accountId);
            return res.json({
                success: true,
                message: '获取认证信息成功',
                data: userData,
            });
        } catch (execError) {
            if (isAuthInfoFailure(execError)) {
                return res.status(401).json({
                    success: false,
                    message: '用户未登录或认证信息已过期',
                    error: '请先登录',
                });
            }

            return res.status(500).json({
                success: false,
                message: '获取认证信息时发生错误',
                error: execError.message || '执行命令失败',
            });
        }

    } catch (error) {
        // console.error('认证信息错误:', error);
        return res.status(500).json({
            success: false,
            message: '服务器内部错误',
            error: error.message
        });
    }
}

module.exports = infoHandler;
