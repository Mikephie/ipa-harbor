const { exec } = require('child_process');
const path = require('path');

const IPATOOL_PATH = path.join(__dirname, '../../bin/ipatool');
const { KEYCHAIN_PASSPHRASE } = require('../../config/keychain');
const { ipatoolEnvForAccount, resolveAccountRegion } = require('../../utils/appleAccount');
const { lookupAppsWithFallback } = require('../../utils/itunesLookup');

function executeIpatool(command, accountId) {
    return new Promise((resolve, reject) => {
        exec(command, {
            timeout: 15000,
            env: ipatoolEnvForAccount(accountId),
        }, (error, stdout, stderr) => {
            if (error) {
                reject(error);
            } else {
                try {
                    const result = JSON.parse(stdout);
                    resolve({ success: true, data: result });
                } catch (parseError) {
                    resolve({ success: true, rawOutput: stdout });
                }
            }
        });
    });
}

async function detailsHandler(req, res) {
    try {
        const { ids, lang = 'zh-CN' } = req.body;
        if (!ids) {
            return res.status(400).json({
                success: false,
                message: '应用ID列表是必需的参数',
                error: '请在请求体中提供ids数组'
            });
        }

        let idArray;
        if (Array.isArray(ids)) {
            idArray = ids;
        } else {
            return res.status(400).json({
                success: false,
                message: 'ID参数格式错误',
                error: 'ids必须是数组格式'
            });
        }

        if (idArray.length === 0) {
            return res.status(400).json({
                success: false,
                message: '至少需要提供一个应用ID',
                error: 'ids数组不能为空'
            });
        }

        let userRegion = null;
        try {
            const infoCommand = `"${IPATOOL_PATH}" auth info --keychain-passphrase "${KEYCHAIN_PASSPHRASE}" --non-interactive --format "json"`;
            const infoResult = await executeIpatool(infoCommand, req.appleAccountId);
            if (infoResult.success && infoResult.data?.email) {
                userRegion = resolveAccountRegion(infoResult.data.email, req.appleAccountId);
            }
        } catch (error) {
        }

        try {
            const results = await lookupAppsWithFallback(idArray, {
                preferredCountry: userRegion,
                lang,
            });

            if (results.length > 0) {
                return res.json({
                    success: true,
                    message: '获取应用详情成功',
                    data: results
                });
            }

            return res.status(404).json({
                success: false,
                message: '未找到应用详情',
                error: '指定的应用ID可能不存在'
            });
        } catch (apiError) {
            console.error('调用iTunes API时出错:', apiError);
            return res.status(500).json({
                success: false,
                message: '获取应用详情时发生错误',
                error: apiError.message || '调用iTunes API失败'
            });
        }

    } catch (error) {
        console.error('应用详情错误:', error);
        return res.status(500).json({
            success: false,
            message: '服务器内部错误',
            error: error.message
        });
    }
}

module.exports = detailsHandler;
