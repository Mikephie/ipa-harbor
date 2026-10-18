const https = require('https');
const { ipatoolEnvForAccount } = require('../../utils/appleAccount');
const { runIpatool, withKeychain } = require('../../utils/ipatoolExec');

function listVersionArgs(appId) {
    return withKeychain(['list-versions', '-i', String(appId)]);
}

/**
 * 执行ipatool命令的通用函数（带重试机制）
 * @param {string} command - 要执行的命令
 * @param {string} accountId - Apple 账号目录 ID
 * @param {number} maxRetries - 最大重试次数，默认为2
 * @param {number} currentAttempt - 当前尝试次数，默认为1
 * @returns {Promise} 返回Promise对象
 */
function executeIpatool(args, accountId, maxRetries = 2, currentAttempt = 1) {
    return runIpatool(args, {
        timeout: 30000,
        env: ipatoolEnvForAccount(accountId),
    }).then(({ stdout }) => {
        try {
            return { success: true, data: JSON.parse(stdout) };
        } catch (_) {
            return { success: true, rawOutput: stdout };
        }
    }).catch((failure) => {
        const stdout = failure.stdout || '';
        const stderr = failure.stderr || '';
        const allOutput = stdout + stderr;

        if (allOutput.includes('password token is expired') || allOutput.includes('"error":"password token is expired"')) {
            return Promise.reject({
                success: false,
                error: '密码令牌已过期，请重新登录',
                errorType: 'TOKEN_EXPIRED',
                stderr,
                stdout,
            });
        }

        if (allOutput.includes('license is required') || allOutput.includes('"error":"license is required"')) {
            return Promise.reject({
                success: false,
                error: '需要先领取该应用的许可证',
                errorType: 'LICENSE_REQUIRED',
                stderr,
                stdout,
            });
        }

        const shouldRetry = (stderr.includes('An unknown error has occurred') ||
            stdout.includes('An unknown error has occurred')) &&
            currentAttempt <= maxRetries;

        if (shouldRetry) {
            return new Promise((resolve, reject) => {
                setTimeout(() => {
                    executeIpatool(args, accountId, maxRetries, currentAttempt + 1)
                        .then(resolve)
                        .catch(reject);
                }, 1000);
            });
        }

        return Promise.reject({
            success: false,
            error: 'ipatool exited',
            stderr,
            stdout,
        });
    });
}

/**
 * 请求第三方版本历史API
 * @param {string} appId - 应用ID
 * @returns {Promise} 返回Promise对象
 */
function fetchVersionHistory(appId) {
    return new Promise((resolve, reject) => {
        const url = `https://apis.bilin.eu.org/history/${appId}`;

        const request = https.get(url, { timeout: 10000 }, (response) => {
            let data = '';

            response.on('data', (chunk) => {
                data += chunk;
            });

            response.on('end', () => {
                try {
                    if (response.statusCode === 200) {
                        const result = JSON.parse(data);
                        if (result.code === 200 && result.data) {
                            resolve(result.data);
                        } else {
                            resolve([]);
                        }
                    } else {
                        resolve([]);
                    }
                } catch (parseError) {
                    // console.error('解析第三方API响应失败:', parseError);
                    resolve([]);
                }
            });
        });

        request.on('error', (error) => {
            // console.error('第三方API请求失败:', error);
            resolve([]);
        });

        request.on('timeout', () => {
            // console.error('第三方API请求超时');
            request.destroy();
            resolve([]);
        });

        request.setTimeout(10000);
    });
}

/**
 * 获取App版本列表
 */
async function versionsHandler(req, res) {
    try {
        const { appId } = req.params;
        const { useThirdPartyApi } = req.query;
        // 参数验证
        if (!appId) {
            return res.status(400).json({
                success: false,
                message: 'App ID是必需的参数',
                error: '请在URL路径中提供appId'
            });
        }

        // 构建ipatool list-versions命令
        const versionArgs = listVersionArgs(appId);

        try {
            // 根据参数决定使用哪种数据源
            if (useThirdPartyApi === 'true') {
                // console.log(`[DEBUG] 使用第三方API获取应用 ${appId} 的版本列表`);

                // 只请求第三方API
                const versionHistory = await fetchVersionHistory(appId);

                if (versionHistory && versionHistory.length > 0) {
                    // 将第三方API数据转换为标准格式
                    const versionObjects = versionHistory.map(item => ({
                        versionId: item.external_identifier.toString(),
                        bundleVersion: item.bundle_version || '未知',
                        releaseDate: item.created_at || null
                    }));

                    // 构建响应数据结构
                    const responseData = {
                        externalVersionIdentifiers: versionObjects
                    };

                    return res.json({
                        success: true,
                        message: '获取版本列表成功（第三方API）',
                        appId: appId,
                        data: responseData,
                        source: 'third-party'
                    });
                } else {
                    return res.status(404).json({
                        success: false,
                        message: '第三方API未找到该应用的版本信息',
                        error: '未找到版本数据'
                    });
                }
            } else {
                // console.log(`[DEBUG] 使用ipatool获取应用 ${appId} 的版本列表`);

                // 同时请求ipatool和第三方API（原有逻辑）
                const [ipatoolResult, versionHistory] = await Promise.all([
                    executeIpatool(command, req.appleAccountId),
                    fetchVersionHistory(appId)
                ]);

                if (ipatoolResult.success) {
                    // 获取版本ID数组 然好反转数组
                    const externalVersionIdentifiers = ipatoolResult.data.externalVersionIdentifiers?.reverse() || [];

                    // 创建版本历史映射表
                    const historyMap = new Map();
                    versionHistory.forEach(item => {
                        historyMap.set(item.external_identifier, {
                            bundleVersion: item.bundle_version,
                            releaseDate: item.created_at
                        });
                    });

                    // 合并数据，将版本ID数组转换为版本对象数组
                    const versionObjects = externalVersionIdentifiers.map(versionId => {
                        const historyInfo = historyMap.get(parseInt(versionId));
                        return {
                            versionId: versionId,
                            bundleVersion: historyInfo ? historyInfo.bundleVersion : '未知',
                            releaseDate: historyInfo ? historyInfo.releaseDate : null
                        };
                    });

                    // 返回修改后的数据结构
                    const responseData = {
                        ...ipatoolResult.data,
                        externalVersionIdentifiers: versionObjects
                    };

                    return res.json({
                        success: true,
                        message: '获取版本列表成功',
                        appId: appId,
                        data: responseData,
                        source: 'ipatool'
                    });
                } else {
                    return res.status(500).json({
                        success: false,
                        message: '获取版本列表失败',
                        error: ipatoolResult.error
                    });
                }
            }
        } catch (execError) {
            // console.error('执行ipatool list-versions命令时出错:', execError);

            // 检查是否是密码令牌过期错误
            if (execError.errorType === 'TOKEN_EXPIRED') {
                return res.status(401).json({
                    success: false,
                    message: '密码令牌已过期，请重新登录',
                    error: execError.error,
                    errorType: 'TOKEN_EXPIRED'
                });
            }

            // 检查是否是许可证相关错误
            if (execError.errorType === 'LICENSE_REQUIRED') {
                return res.status(403).json({
                    success: false,
                    message: '需要先领取该应用的许可证',
                    error: execError.error,
                    errorType: 'LICENSE_REQUIRED'
                });
            }

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

            // 检查是否是App ID不存在的错误
            if (execError.stderr && (
                execError.stderr.includes('not found') ||
                execError.stderr.includes('找不到') ||
                execError.stderr.includes('invalid')
            )) {
                return res.status(404).json({
                    success: false,
                    message: '找不到指定的App',
                    error: 'App ID不存在或无效'
                });
            }

            return res.status(500).json({
                success: false,
                message: '获取版本列表时发生错误',
                error: execError.message || '执行命令失败'
            });
        }

    } catch (error) {
        // console.error('版本列表错误:', error);
        return res.status(500).json({
            success: false,
            message: '服务器内部错误',
            error: error.message
        });
    }
}

/**
 * 获取应用最新版本ID的（仅用于内部调用）
 * @param {number} appId - 应用ID
 * @param {string} accountId - Apple 账号目录 ID
 * @returns {Promise<string|null>} 返回最新版本ID或null
 */
async function getLatestVersionId(appId, accountId) {
    try {
        if (!accountId) {
            return null;
        }
        const ipatoolResult = await executeIpatool(listVersionArgs(appId), accountId);

        if (ipatoolResult.success && ipatoolResult.data) {
            // 获取版本ID数组并反转（最新的在最后）
            const externalVersionIdentifiers = ipatoolResult.data.externalVersionIdentifiers?.reverse() || [];

            if (externalVersionIdentifiers.length > 0) {
                const latestVersionId = externalVersionIdentifiers[0];
                // console.log(`[DEBUG] 应用 ${appId} 的最新版本ID: ${latestVersionId}`);
                return latestVersionId;
            } else {
                // console.log(`[DEBUG] 应用 ${appId} 没有找到版本信息`);
                return null;
            }
        } else {
            // console.log(`[DEBUG] 获取应用 ${appId} 版本信息失败:`, ipatoolResult.error);
            return null;
        }
    } catch (error) {
        // console.error(`获取应用 ${appId} 最新版本ID失败:`, error);
        return null;
    }
}

module.exports = { versionsHandler, getLatestVersionId };
