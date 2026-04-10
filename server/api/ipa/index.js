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
    LEGACY_FLAT_DATA_DIR,
    resolveIpaFilePath,
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

function escapeXml(text) {
    if (text == null || text === '') return '';
    return String(text)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&apos;');
}

/** 反代后的公网 Host（OTA 清单里的 IPA URL 须与设备可访问的 TLS 主机一致） */
function publicHostForOta(req) {
    const raw = req.get('x-forwarded-host') || req.get('host') || '';
    return raw.split(',')[0].trim();
}

// 生成 manifest.plist 用于 iOS 无线安装（需 HTTPS 与有效证书）
router.get('/install-package/:accountId/:fileName/manifest.plist', async (req, res) => {
    try {
        const { fileName, accountId } = req.params;

        // 验证文件名格式 (应该是 appId_versionId 格式)
        if (!fileName || !fileName.includes('_')) {
            return res.status(400).send('Invalid file name format');
        }

        const { ipaFileName, ipaPath } = resolveIpaFilePath(fileName, accountId);

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

            const host = publicHostForOta(req);
            if (!host) {
                return res.status(500).send('Cannot determine public host');
            }
            // iOS OTA 要求 IPA 与清单均为 HTTPS
            const ipaUrl = `https://${host}/v1/ipa/getpackage/${accountId}/${ipaFileName}`;
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

    if (!fileName) {
        return res.status(400).send('fileName parameter is required');
    }

    const { ipaPath: filePath } = resolveIpaFilePath(fileName, accountId);

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
