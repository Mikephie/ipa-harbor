const { ipatoolEnvForAccount, resolveAccountRegion } = require('./appleAccount');
const { runIpatool, buildAuthInfoArgs } = require('./ipatoolExec');

/**
 * 读取指定账号目录下 ipatool 会话信息，并合并内存中的地区偏好
 * @returns {Promise<Object>} userData 含 accountId
 */
function fetchAppleAuthInfo(accountId) {
    return new Promise((resolve, reject) => {
        runIpatool(buildAuthInfoArgs(), {
            timeout: 15000,
            env: ipatoolEnvForAccount(accountId),
        }).then(({ stdout }) => {
            try {
                const userData = JSON.parse(stdout);
                if (userData && userData.email) {
                    const userRegion = resolveAccountRegion(userData.email, accountId);
                    if (userRegion) {
                        userData.region = userRegion;
                        global.userRegions = global.userRegions || new Map();
                        global.userRegions.set(userData.email, userRegion);
                    }
                }
                resolve({ ...userData, accountId });
            } catch (parseErr) {
                reject({ parseErr, stdout });
            }
        }).catch((failure) => {
            reject({ error: failure, stderr: failure.stderr || '', stdout: failure.stdout || '' });
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
