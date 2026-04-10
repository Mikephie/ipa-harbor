const { readAppleAccountIdFromRequest, listStoredAccounts } = require('../../utils/appleAccount');

/**
 * GET 已保存的 Apple 账号列表（本机 data/accounts 下有效会话）
 */
async function accountsListHandler(req, res) {
    try {
        const currentAccountId = readAppleAccountIdFromRequest(req);
        const accounts = listStoredAccounts(currentAccountId);

        return res.json({
            success: true,
            message: '获取账号列表成功',
            data: {
                accounts,
                currentAccountId: currentAccountId || null,
            },
        });
    } catch (error) {
        console.error('获取账号列表失败:', error);
        return res.status(500).json({
            success: false,
            message: '服务器内部错误',
            error: error.message,
        });
    }
}

module.exports = accountsListHandler;
