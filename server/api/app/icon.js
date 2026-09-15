const https = require('https');
const { exec } = require('child_process');
const path = require('path');

// ipatool二进制文件路径
const IPATOOL_PATH = path.join(__dirname, '../../bin/ipatool');
const { KEYCHAIN_PASSPHRASE } = require('../../config/keychain');
const { readAppleAccountIdFromRequest, ipatoolEnvForAccount, resolveAccountRegion } = require('../../utils/appleAccount');
const { lookupAppsWithFallback } = require('../../utils/itunesLookup');

// 1×1 透明 GIF
const ONE_PIXEL_GIF_BASE64 =
    'R0lGODlhAQABAIAAAAAAAP///ywAAAAAAQABAAACAUwAOw==';

/**
 * 获取当前用户的地区设置（同域请求可带 Apple 账号 cookie）
 */
async function getUserRegion(req) {
    return new Promise((resolve) => {
        const accountId = req ? readAppleAccountIdFromRequest(req) : null;
        const command = `"${IPATOOL_PATH}" auth info --keychain-passphrase "${KEYCHAIN_PASSPHRASE}" --non-interactive --format "json"`;
        const execOpts = accountId
            ? { timeout: 15000, env: ipatoolEnvForAccount(accountId) }
            : { timeout: 15000 };

        exec(command, execOpts, (error, stdout, stderr) => {
            if (error) {
                resolve(null);
            } else {
                try {
                    const result = JSON.parse(stdout);
                    if (result.email) {
                        resolve(resolveAccountRegion(result.email, accountId));
                    } else {
                        resolve(null);
                    }
                } catch (parseError) {
                    resolve(null);
                }
            }
        });
    });
}

/**
 * GET /icon/:appid?size=60
 * 从 iTunes Lookup API 获取 App 图标（找不到则返回 1×1 占位图）
 */
const getAppIcon = async (req, res) => {
    const appId = req.params.appid;
    const { size = 100 } = req.query;

    // 参数校验
    if (!appId || !/^\d+$/.test(appId)) {
        return sendPlaceholder(res);
    }

    const userRegion = await getUserRegion(req);

    try {
        const results = await lookupAppsWithFallback([appId], { preferredCountry: userRegion });
        const app = results[0];
        let iconUrl;
        switch (String(size)) {
            case '60':
                iconUrl = app?.artworkUrl60;
                break;
            case '100':
                iconUrl = app?.artworkUrl100;
                break;
            case '512':
                iconUrl = app?.artworkUrl512;
                break;
            default:
                iconUrl = app?.artworkUrl512 || app?.artworkUrl100 || app?.artworkUrl60;
                break;
        }

        if (!iconUrl) {
            return sendPlaceholder(res);
        }

        https
            .get(iconUrl, (imgRes) => {
                res.writeHead(imgRes.statusCode, {
                    'Content-Type': imgRes.headers['content-type'] || 'image/png',
                    'Cache-Control': 'public, max-age=86400',
                    'Access-Control-Allow-Origin': '*',
                    'Access-Control-Allow-Methods': 'GET, OPTIONS',
                    'Cross-Origin-Resource-Policy': 'cross-origin',
                    'Access-Control-Allow-Headers': 'Origin, X-Requested-With, Content-Type, Accept',
                });
                imgRes.pipe(res);
            })
            .on('error', (err) => {
                console.error('Error fetching icon:', err);
                sendPlaceholder(res);
            });
    } catch (err) {
        console.error('HTTPS request failed:', err);
        sendPlaceholder(res);
    }
};

// 获取原始应用图标的URL
const getAppIconUrl = async (req, res) => {
    const appId = req.params.appid;
    const size = req.params.size;
    const userRegion = await getUserRegion(req);

    try {
        const results = await lookupAppsWithFallback([appId], { preferredCountry: userRegion });
        const app = results[0];
        let iconUrl;
        switch (String(size)) {
            case '60':
                iconUrl = app?.artworkUrl60;
                break;
            case '100':
                iconUrl = app?.artworkUrl100;
                break;
            case '512':
                iconUrl = app?.artworkUrl512;
                break;
            default:
                iconUrl = app?.artworkUrl512 || app?.artworkUrl100 || app?.artworkUrl60;
                break;
        }

        if (!iconUrl) {
            return res.status(404).json({ error: 'Icon URL not found' });
        }
        res.json({ iconUrl });
    } catch (err) {
        console.error('HTTPS request failed:', err);
        res.status(500).json({ error: 'HTTPS request failed' });
    }
};

/**
 * 返回 1×1 GIF 占位图
 */
function sendPlaceholder(res) {
    const imgBuffer = Buffer.from(ONE_PIXEL_GIF_BASE64, 'base64');
    res.writeHead(200, {
        'Content-Type': 'image/gif',
        'Content-Length': imgBuffer.length,
        'Cache-Control': 'public, max-age=3600', // 缓存 1 小时
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'GET, OPTIONS',
        'Cross-Origin-Resource-Policy': 'cross-origin',
        'Access-Control-Allow-Headers': 'Origin, X-Requested-With, Content-Type, Accept',
    });
    res.end(imgBuffer);
}

module.exports = { getAppIcon, getAppIconUrl, };
