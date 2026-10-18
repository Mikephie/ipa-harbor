const { ipatoolEnvForAccount } = require('../../utils/appleAccount');
const { runIpatool, buildAuthInfoArgs, withKeychain } = require('../../utils/ipatoolExec');

function executeIpatool(args, accountId) {
    return runIpatool(args, {
        timeout: 30000,
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
 * 搜索App
 */
async function searchHandler(req, res) {
    try {
        const { keyword, limit } = req.query;

        // 参数验证
        if (!keyword) {
            return res.status(400).json({
                success: false,
                message: '搜索关键词是必需的参数',
                error: '请在查询参数中提供keyword'
            });
        }

        const parsedLimit = isNaN(limit) ? 10 : parseInt(limit); // 如果limit不是数字，则默认为10
        const accountId = req.appleAccountId;

        // 获取用户设置的地区（通过 ipatool 获取当前用户邮箱）
        let userRegion = null;
        try {
            const infoResult = await executeIpatool(buildAuthInfoArgs(), accountId);
            if (infoResult.success && infoResult.data?.email) {
                userRegion = global.userRegions?.get(infoResult.data.email);
            }
        } catch (error) {
        }

        // 构建ipatool search命令
        const searchArgs = withKeychain([
            'search',
            String(keyword),
            '--limit',
            String(parsedLimit),
        ]);

        try {
            const result = await executeIpatool(searchArgs, accountId);

            if (result.success) {
                const data = await withOwnedDelistedApp(result.data || result.rawOutput, keyword, accountId);
                return res.json({
                    success: true,
                    message: '搜索成功',
                    keyword: keyword,
                    data
                });
            } else {
                return res.status(500).json({
                    success: false,
                    message: '搜索失败',
                    error: result.error
                });
            }
        } catch (execError) {
            // console.error('执行ipatool search命令时出错:', execError);

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

            return res.status(500).json({
                success: false,
                message: '搜索时发生错误',
                error: execError.message || '执行命令失败'
            });
        }

    } catch (error) {
        // console.error('搜索错误:', error);
        return res.status(500).json({
            success: false,
            message: '服务器内部错误',
            error: error.message
        });
    }
}

function numericAppId(keyword) {
    const match = String(keyword || '').trim().match(/^(?:id)?(\d{6,})$/i);
    return match ? match[1] : null;
}

function hasApps(data) {
    return Array.isArray(data?.apps) && data.apps.length > 0;
}

async function withOwnedDelistedApp(data, keyword, accountId) {
    if (hasApps(data)) {
        return data;
    }
    const appId = numericAppId(keyword);
    if (!appId) {
        return data;
    }
    const stub = await ownedDelistedApp(accountId, appId);
    if (!stub) {
        return data;
    }
    const base = data && typeof data === 'object' ? data : {};
    return {
        ...base,
        apps: [stub],
        count: 1,
    };
}

async function ownedDelistedApp(accountId, appId) {
    try {
        const result = await executeIpatool(withKeychain([
            'list-versions',
            '-i',
            String(appId),
        ]), accountId);
        const versions = result.data?.externalVersionIdentifiers;
        if (!result.success || !Array.isArray(versions) || versions.length === 0) {
            return null;
        }
        return {
            id: Number(appId),
            bundleID: result.data.bundleID || `delisted.${appId}`,
            name: `已下架应用 ${appId}`,
            price: 0,
            version: '',
        };
    } catch (_) {
        return null;
    }
}

module.exports = searchHandler;
