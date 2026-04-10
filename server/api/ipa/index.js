const express = require('express');
const router = express.Router();
const path = require('path');
const fs = require('fs');
const https = require('https');
const { exec } = require('child_process');

// 导入IPA相关的路由
const { metadataHandler, parseIpaMetadata } = require('./metadata');

const IPATOOL_PATH = path.join(__dirname, '../../bin/ipatool');
const { KEYCHAIN_PASSPHRASE } = require('../../config/keychain');
const {
    readAppleAccountIdFromRequest,
    ipatoolEnvForAccount,
    getAppleAccountHome,
    LEGACY_FLAT_DATA_DIR,
} = require('../../utils/appleAccount');

/**
 * 获取当前用户的地区设置（按请求中的 Apple 账号 cookie）
 */
async function getUserRegion(req) {
    return new Promise((resolve) => {
        const accountId = req ? readAppleAccountIdFromRequest(req) : null;
        const command = `"${IPATOOL_PATH}" auth info --keychain-passphrase "${KEYCHAIN_PASSPHRASE}" --non-interactive --format "json"`;
        const execOpts = accountId ? { timeout: 15000, env: ipatoolEnvForAccount(accountId) } : { timeout: 15000 };

        exec(command, execOpts, (error, stdout, stderr) => {
            if (error) {
                resolve(null);
            } else {
                try {
                    const result = JSON.parse(stdout);
                    if (result.email) {
                        const region = global.userRegions?.get(result.email);
                        resolve(region || null);
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

// 获取应用图标URL的辅助函数
async function getAppIconUrls(appId, userRegion = null) {
    return new Promise((resolve, reject) => {
        let lookupUrl;
        if (userRegion) {
            lookupUrl = `https://itunes.apple.com/${userRegion}/lookup?id=${appId}`;
        } else {
            lookupUrl = `https://itunes.apple.com/lookup?id=${appId}`;
        }

        https.get(lookupUrl, (response) => {
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
        }).on('error', (err) => {
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

function resolveIpaPath(fileName, accountId) {
    const ipaFileName = fileName.endsWith('.ipa') ? fileName : `${fileName}.ipa`;
    const base = accountId ? getAppleAccountHome(accountId) : LEGACY_FLAT_DATA_DIR;
    return { ipaFileName, ipaPath: path.join(base, ipaFileName) };
}

// 生成manifest.plist文件用于无线安装 (目前有问题，貌似不可用)
router.get('/install-package/:accountId/:fileName/manifest.plist', async (req, res) => {
    try {
        const { fileName, accountId } = req.params;

        // 验证文件名格式 (应该是 appId_versionId 格式)
        if (!fileName || !fileName.includes('_')) {
            return res.status(400).send('Invalid file name format');
        }

        const { ipaFileName, ipaPath } = resolveIpaPath(fileName, accountId);

        // 检查IPA文件是否存在
        if (!fs.existsSync(ipaPath)) {
            return res.status(404).send('IPA file not found');
        }

        try {
            // 解析IPA元数据
            const metadata = await parseIpaMetadata(ipaFileName, accountId);

            // 提取所需信息
            const bundleIdentifier = metadata.softwareVersionBundleId || 'unknown.bundle.id';
            const kind = metadata.kind || 'full';
            const bundleVersion = metadata.bundleShortVersionString || metadata.bundleVersion || '1.0.0';
            const appName = metadata.itemName || metadata.playlistName || 'Unknown App';
            const developerName = metadata.playlistName || 'Unknown Developer';
            // 从文件名中提取appId
            const appId = fileName.split('_')[0];

            // 获取用户地区设置
            const userRegion = await getUserRegion(req);

            // 获取图标URL
            const iconUrls = await getAppIconUrls(appId, userRegion);
            const iconUrl57 = metadata.softwareIcon57x57URL || iconUrls.iconUrl60 || '';
            const iconUrl512 = iconUrls.iconUrl512 || '';

            // 构建IPA下载URL
            const host = req.get('host');
            const ipaUrl = `https://${host}/v1/ipa/getpackage/${accountId}/${ipaFileName}`; // 必须https
            console.log(
                'ipaUrl', ipaUrl,
                'iconUrl57', iconUrl57,
                'iconUrl512', iconUrl512,
            )
            // 生成manifest.plist内容
            const manifestContent = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>items</key>
    <array>
        <dict>
            <key>assets</key>
            <array>
                <dict>
                    <key>kind</key>
                    <string>display-image</string>
                    <key>url</key>
                    <string>${iconUrl512}</string>
                </dict>
                <dict>
                    <key>kind</key>
                    <string>software-package</string>
                    <key>url</key>
                    <string>${ipaUrl}</string>
                </dict>
            </array>
            <key>metadata</key>
            <dict>
                <key>bundle-identifier</key>
                <string>${bundleIdentifier}</string>
                <key>bundle-version</key>
                <string>${bundleVersion}</string>
                <key>developer-name</key>
                <string>${developerName}</string>
                <key>kind</key>
                <string>${kind}</string>
                <key>title</key>
                <string>${appName}</string>
            </dict>
        </dict>
    </array>
</dict>
</plist>`;

            // 设置正确的Content-Type和文件名
            res.setHeader('Content-Type', 'text/xml');
            res.setHeader('Content-Disposition', `attachment; filename="manifest.plist"`);
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

    if (!fileName) {
        return res.status(400).send('fileName parameter is required');
    }

    const { ipaPath: filePath } = resolveIpaPath(fileName, accountId);

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

    if (!fileName) {
        return res.status(400).send('fileName parameter is required');
    }

    const filePath = path.join(LEGACY_FLAT_DATA_DIR, fileName);

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

module.exports = router;
