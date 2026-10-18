const { ipatoolEnvForAccount, resolveAccountRegion } = require('../../utils/appleAccount');
const { lookupAppsWithFallback } = require('../../utils/itunesLookup');
const { runIpatool, buildAuthInfoArgs } = require('../../utils/ipatoolExec');

function executeIpatool(args, accountId) {
    return runIpatool(args, {
        timeout: 15000,
        env: ipatoolEnvForAccount(accountId),
    }).then(({ stdout }) => {
        try {
            return { success: true, data: JSON.parse(stdout) };
        } catch (_) {
            return { success: true, rawOutput: stdout };
        }
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
            const infoResult = await executeIpatool(buildAuthInfoArgs(), req.appleAccountId);
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

            const foundIds = new Set(results.map((item) => String(item.trackId || item.trackID || '')));
            const stubs = idArray
                .map((id) => String(id).trim())
                .filter((id) => /^\d+$/.test(id) && !foundIds.has(id))
                .map(delistedAppStub);
            const data = results.concat(stubs);

            if (data.length > 0) {
                return res.json({
                    success: true,
                    message: results.length > 0 ? '获取应用详情成功' : '商店目录已下架，可按版本号下载',
                    data,
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

function delistedAppStub(id) {
    const trackId = Number(id);
    return {
        trackId,
        trackName: `已下架应用 ${trackId}`,
        artistName: '',
        bundleId: `delisted.${trackId}`,
        artworkUrl60: '',
        artworkUrl100: '',
        artworkUrl512: '',
        formattedPrice: '已下架',
        price: 0,
        version: '',
        description: '商店目录里已经没有这个应用。当前账号如果已有许可证，填写版本号即可下载。',
        releaseNotes: '',
        primaryGenreName: '',
        averageUserRating: 0,
        userRatingCount: 0,
        fileSizeBytes: '0',
        currency: 'USD',
        kind: 'software',
        wrapperType: 'software',
    };
}

module.exports = detailsHandler;
