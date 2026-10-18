const express = require('express');
const router = express.Router();
const fs = require('fs');
const https = require('https');

// 导入IPA相关的路由
const { metadataHandler, parseIpaMetadata } = require('./metadata');

const { authenticateToken } = require('../../middleware/auth');
const {
    isValidAppleAccountId,
    resolveOwnedIpaFile,
    resolveLegacyIpaFile,
    resolveAccountRegion,
} = require('../../utils/appleAccount');
const {
    authorizeAsset,
    ipaUrlForManifest,
    mintAccountInstall,
    mintLegacyInstall,
} = require('../../utils/otaLink');

async function getUserRegion(req) {
    const accountId = isValidAppleAccountId(req?.params?.accountId)
        ? req.params.accountId
        : null;
    if (!accountId) {
        return null;
    }
    return resolveAccountRegion(null, accountId);
}

// 获取应用图标URL的辅助函数
async function getAppIconUrls(appId, userRegion = null) {
    return new Promise((resolve, reject) => {
        let lookupUrl;
        if (userRegion) {
            lookupUrl = `https://itunes.apple.com/${userRegion}/lookup?id=${appId}`;
        } else {
            lookupUrl = `https://itunes.apple.com/lookup?id=${appId}`;
        }

        const request = https.get(lookupUrl, (response) => {
            let data = '';

            response.on('data', (chunk) => (data += chunk));
            response.on('end', () => {
                try {
                    const json = JSON.parse(data);
                    const app = json.results?.[0];

                    resolve({
                        iconUrl60: app?.artworkUrl60 || '',
                        iconUrl100: app?.artworkUrl100 || '',
                        iconUrl512: app?.artworkUrl512 || ''
                    });
                } catch (err) {
                    console.error('解析iTunes响应失败:', err);
                    resolve({
                        iconUrl60: '',
                        iconUrl100: '',
                        iconUrl512: ''
                    });
                }
            });
        });
        request.setTimeout(4000, () => {
            request.destroy();
        });
        request.on('error', (err) => {
            console.error('HTTPS请求失败:', err);
            resolve({
                iconUrl60: '',
                iconUrl100: '',
                iconUrl512: ''
            });
        });
    });
}

// 路由定义
router.post('/metadata', metadataHandler);  // 解析IPA元数据

function escapeXml(text) {
    if (text == null || text === '') return '';
    return String(text)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&apos;');
}

function sendAuthFailure(res, result) {
    if (result.body) {
        return res.status(result.status).json(result.body);
    }
    return res.status(result.status).send('Forbidden');
}

// 生成 manifest.plist 用于 iOS 无线安装（需 HTTPS 与有效证书）
router.get('/install-package/:accountId/:fileName/manifest.plist', async (req, res) => {
    try {
        const { fileName, accountId } = req.params;
        const authz = authorizeAsset({
            resource: 'manifest',
            accountId,
            fileName,
            exp: req.query.exp,
            sig: req.query.sig,
        });
        if (authz.status !== 200) {
            return sendAuthFailure(res, authz);
        }

        const resolved = resolveOwnedIpaFile(accountId, authz.ipaFileName);
        if (!resolved) {
            return res.status(404).send('IPA file not found');
        }
        const { ipaFileName, ipaPath } = resolved;

        // 检查IPA文件是否存在
        if (!fs.existsSync(ipaPath)) {
            return res.status(404).send('IPA file not found');
        }

        try {
            // 解析IPA元数据
            const metadata = await parseIpaMetadata(ipaFileName, accountId);

            // 提取所需信息
            const bundleIdentifier = metadata.softwareVersionBundleId || 'unknown.bundle.id';
            const bundleVersion = metadata.bundleShortVersionString || metadata.bundleVersion || '1.0.0';
            const appName = metadata.itemName || metadata.playlistName || 'Unknown App';
            // 从文件名中提取appId
            const appId = fileName.split('_')[0];

            // 获取用户地区设置
            const userRegion = await getUserRegion(req);

            // 获取图标URL
            const iconUrls = await getAppIconUrls(appId, userRegion);
            const iconUrl57 = metadata.softwareIcon57x57URL || iconUrls.iconUrl60 || '';
            const iconUrl512 = iconUrls.iconUrl512 || '';

            const ipaUrl = ipaUrlForManifest({
                accountId,
                ipaFileName,
                exp: authz.exp,
                config: authz.config,
            });
            const ipaSize = fs.statSync(ipaPath).size;

            const assetBlocks = [];
            assetBlocks.push(`                <dict>
                    <key>kind</key>
                    <string>software-package</string>
                    <key>url</key>
                    <string>${escapeXml(ipaUrl)}</string>
                </dict>`);
            if (iconUrl57) {
                assetBlocks.push(`                <dict>
                    <key>kind</key>
                    <string>display-image</string>
                    <key>url</key>
                    <string>${escapeXml(iconUrl57)}</string>
                </dict>`);
            }
            if (iconUrl512) {
                assetBlocks.push(`                <dict>
                    <key>kind</key>
                    <string>full-size-image</string>
                    <key>url</key>
                    <string>${escapeXml(iconUrl512)}</string>
                </dict>`);
            }

            const manifestContent = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>items</key>
    <array>
        <dict>
            <key>assets</key>
            <array>
${assetBlocks.join('\n')}
            </array>
            <key>metadata</key>
            <dict>
                <key>bundle-identifier</key>
                <string>${escapeXml(bundleIdentifier)}</string>
                <key>bundle-version</key>
                <string>${escapeXml(bundleVersion)}</string>
                <key>kind</key>
                <string>software</string>
                <key>title</key>
                <string>${escapeXml(appName)}</string>
                <key>size-in-bytes</key>
                <integer>${ipaSize}</integer>
            </dict>
        </dict>
    </array>
</dict>
</plist>`;

            res.setHeader('Content-Type', 'application/xml; charset=utf-8');
            res.send(manifestContent);

        } catch (metadataError) {
            console.error('解析IPA元数据失败:', metadataError);
            return res.status(500).send('Failed to parse IPA metadata');
        }

    } catch (error) {
        console.error('生成manifest.plist失败:', error);
        return res.status(500).send('Internal server error');
    }
});

// 新：按账号目录下载 IPA
router.get('/getpackage/:accountId/:fileName', (req, res) => {
    const { fileName, accountId } = req.params;
    const authz = authorizeAsset({
        resource: 'ipa',
        accountId,
        fileName,
        exp: req.query.exp,
        sig: req.query.sig,
    });
    if (authz.status !== 200) {
        return sendAuthFailure(res, authz);
    }

    const resolved = resolveOwnedIpaFile(accountId, authz.ipaFileName);
    if (!resolved) {
        return res.status(404).send('File not found');
    }
    const { ipaPath: filePath } = resolved;

    // 检查文件是否存在
    if (!fs.existsSync(filePath)) {
        return res.status(404).send('File not found');
    }

    const stat = fs.statSync(filePath);
    const fileSize = stat.size;
    const range = req.headers.range;

    if (!range) {
        res.writeHead(200, {
            'Content-Length': fileSize,
            'Content-Type': 'application/octet-stream',
            'Content-Disposition': `attachment; filename="app.ipa"`,
        });
        fs.createReadStream(filePath).pipe(res);
        return;
    }

    const parts = range.replace(/bytes=/, '').split('-');
    const start = parseInt(parts[0], 10);
    const end = parts[1] ? parseInt(parts[1], 10) : fileSize - 1;

    if (start >= fileSize || end >= fileSize) {
        res.status(416).send('Requested range not satisfiable');
        return;
    }

    const chunkSize = end - start + 1;
    const fileStream = fs.createReadStream(filePath, { start, end });


    res.writeHead(206, {
        'Content-Range': `bytes ${start}-${end}/${fileSize}`,
        'Accept-Ranges': 'bytes',
        'Content-Length': chunkSize,
        'Content-Type': 'application/octet-stream',
        'Content-Disposition': `attachment; filename="app.ipa"`,
    });

    fileStream.pipe(res);
});

// 兼容旧路径：仅查找 data 根目录（升级前下载的文件）
router.get('/getpackage/:fileName', (req, res) => {
    const { fileName } = req.params;
    const authz = authorizeAsset({
        resource: 'legacy-ipa',
        fileName,
        exp: req.query.exp,
        sig: req.query.sig,
    });
    if (authz.status !== 200) {
        return sendAuthFailure(res, authz);
    }

    const legacy = resolveLegacyIpaFile(authz.ipaFileName);
    const filePath = legacy?.ipaPath || '';
    if (!filePath) {
        return res.status(404).send('File not found');
    }

    if (!fs.existsSync(filePath)) {
        return res.status(404).send('File not found');
    }

    const stat = fs.statSync(filePath);
    const fileSize = stat.size;
    const range = req.headers.range;

    if (!range) {
        res.writeHead(200, {
            'Content-Length': fileSize,
            'Content-Type': 'application/octet-stream',
            'Content-Disposition': `attachment; filename="app.ipa"`,
        });
        fs.createReadStream(filePath).pipe(res);
        return;
    }

    const parts = range.replace(/bytes=/, '').split('-');
    const start = parseInt(parts[0], 10);
    const end = parts[1] ? parseInt(parts[1], 10) : fileSize - 1;

    if (start >= fileSize || end >= fileSize) {
        res.status(416).send('Requested range not satisfiable');
        return;
    }

    const chunkSize = end - start + 1;
    const fileStream = fs.createReadStream(filePath, { start, end });

    res.writeHead(206, {
        'Content-Range': `bytes ${start}-${end}/${fileSize}`,
        'Accept-Ranges': 'bytes',
        'Content-Length': chunkSize,
        'Content-Type': 'application/octet-stream',
        'Content-Disposition': `attachment; filename="app.ipa"`,
    });

    fileStream.pipe(res);
});

router.post('/install-link', authenticateToken, (req, res) => {
    const result = mintAccountInstall(req);
    return res.status(result.status).json(result.body);
});

router.post('/legacy-install-link', authenticateToken, (req, res) => {
    const result = mintLegacyInstall(req);
    return res.status(result.status).json(result.body);
});

module.exports = router;
