const { exec } = require('child_process');
const path = require('path');
const IPATOOL_PATH = path.join(__dirname, '../bin/ipatool');
const { KEYCHAIN_PASSPHRASE } = require('../config/keychain');
const { ipatoolEnvForAccount } = require('./appleAccount');

/**
 * 读取指定账号目录下 ipatool 会话信息，并合并内存中的地区偏好
 * @returns {Promise<Object>} userData 含 accountId
 */
function fetchAppleAuthInfo(accountId) {
    return new Promise((resolve, reject) => {
        const command = `"${IPATOOL_PATH}" auth info --keychain-passphrase "${KEYCHAIN_PASSPHRASE}" --non-interactive --format "json"`;
        exec(command, { timeout: 15000, env: ipatoolEnvForAccount(accountId) }, (error, stdout, stderr) => {
            if (error) {
                reject({ error, stderr, stdout });
                return;
            }
            try {
                const userData = JSON.parse(stdout);
                if (userData && userData.email) {
                    const userRegion = global.userRegions?.get(userData.email);
                    if (userRegion) {
                        userData.region = userRegion;
                    }
                }
                resolve({ ...userData, accountId });
            } catch (parseErr) {
                reject({ parseErr, stdout });
            }
        });
    });
}

function isAuthInfoFailure(err) {
    const s = `${err?.stderr || ''}${err?.stdout || ''}${err?.error?.message || ''}`;
    return (
        s.includes('not logged in') ||
        s.includes('未登录') ||
        s.includes('authentication') ||
        s.includes('keychain') ||
        s.includes('The specified item could not be found in the keyring')
    );
}

module.exports = { fetchAppleAuthInfo, isAuthInfoFailure };
