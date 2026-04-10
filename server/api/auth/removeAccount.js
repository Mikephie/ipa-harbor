const { exec } = require('child_process');
const path = require('path');
const fs = require('fs');
const IPATOOL_PATH = path.join(__dirname, '../../bin/ipatool');
const { KEYCHAIN_PASSPHRASE } = require('../../config/keychain');
const {
    isValidAppleAccountId,
    getAppleAccountHome,
    readAppleAccountIdFromRequest,
    clearAppleAccountCookie,
    ipatoolEnvForAccount,
} = require('../../utils/appleAccount');

function revokeInAccountHome(accountId) {
    return new Promise((resolve) => {
        const command = `"${IPATOOL_PATH}" auth revoke --keychain-passphrase "${KEYCHAIN_PASSPHRASE}" --non-interactive --format "json"`;
        exec(command, { timeout: 20000, env: ipatoolEnvForAccount(accountId) }, () => {
            resolve();
        });
    });
}

/**
 * 撤销并删除本机某账号目录（IPA 与凭据一并删除）
 */
async function removeAccountHandler(req, res) {
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
                message: '该账号目录不存在',
                error: 'Not found',
            });
        }

        await revokeInAccountHome(accountId);

        try {
            fs.rmSync(home, { recursive: true, force: true });
        } catch (rmErr) {
            console.error('删除账号目录失败:', rmErr);
            return res.status(500).json({
                success: false,
                message: '删除账号数据失败',
                error: rmErr.message,
            });
        }

        const current = readAppleAccountIdFromRequest(req);
        if (current === accountId) {
            clearAppleAccountCookie(res);
        }

        return res.json({
            success: true,
            message: '已从本机移除该账号及数据',
            data: { removedAccountId: accountId, wasCurrent: current === accountId },
        });
    } catch (error) {
        console.error('移除账号错误:', error);
        return res.status(500).json({
            success: false,
            message: '服务器内部错误',
            error: error.message,
        });
    }
}

module.exports = removeAccountHandler;
