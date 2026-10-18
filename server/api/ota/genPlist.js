const { resolveOwnedIpaFile } = require('../../utils/appleAccount');
const {
    authorizeAsset,
    ipaUrlForManifest,
    readOtaConfig,
} = require('../../utils/otaLink');

function escapeXml(value) {
    return String(value)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&apos;');
}

function isSafeHttpUrl(raw) {
    try {
        const url = new URL(String(raw));
        return url.protocol === 'http:' || url.protocol === 'https:';
    } catch (_) {
        return false;
    }
}

function safeLabel(value, fallback, pattern) {
    const text = String(value || '').trim().slice(0, 120);
    if (text && pattern.test(text)) {
        return text;
    }
    return fallback;
}

function asset(kind, url) {
    return `
        <dict>
        <key>kind</key>
        <string>${escapeXml(kind)}</string>
        <key>url</key>
        <string>${escapeXml(url)}</string>
        </dict>`;
}

function localIconUrl(iconUrl, baseUrl) {
    let url;
    try {
        url = new URL(String(iconUrl));
    } catch (_) {
        return false;
    }
    return url.origin === baseUrl && /^\/v1\/app\/icon\/\d+$/.test(url.pathname);
}

/**
 * 已签名的 itms-services 清单。下载地址只来自 PUBLIC_BASE_URL。
 */
function genPlistHandler(req, res) {
    const accountId = String(req.query.accountId || '').trim();
    const file = String(req.query.file || '').trim();
    const authz = authorizeAsset({
        resource: 'manifest',
        accountId,
        fileName: file,
        exp: req.query.exp,
        sig: req.query.sig,
    });
    if (authz.status !== 200) {
        return res.status(authz.status).json(authz.body);
    }

    const owned = resolveOwnedIpaFile(accountId, authz.ipaFileName);
    if (!owned) {
        return res.status(404).json({
            success: false,
            message: '找不到该账号下的 IPA',
        });
    }

    const ipaUrl = ipaUrlForManifest({
        accountId,
        ipaFileName: owned.ipaFileName,
        exp: authz.exp,
        config: authz.config,
    });
    if (!isSafeHttpUrl(ipaUrl)) {
        return res.status(400).json({
            success: false,
            message: 'IPA 地址必须是 http 或 https',
        });
    }
    const fetchUrl = String(req.query.fetchurl || '').trim();
    if (fetchUrl && fetchUrl !== ipaUrl) {
        return res.status(400).json({
            success: false,
            message: 'fetchurl 只能指向已签名的本机 IPA',
        });
    }

    const bundleId = safeLabel(req.query.bundleid, 'app.local', /^[A-Za-z0-9][A-Za-z0-9.-]*$/);
    const name = safeLabel(req.query.name, bundleId, /^[^\u0000-\u001f<>&]+$/);
    const version = safeLabel(req.query.version, '1.0', /^[A-Za-z0-9][A-Za-z0-9._+-]*$/);
    const iconUrl = String(req.query.iconurl || '').trim();
    const baseUrl = readOtaConfig().baseUrl;

    let assets = asset('software-package', ipaUrl);
    if (iconUrl && isSafeHttpUrl(iconUrl) && localIconUrl(iconUrl, baseUrl)) {
        assets += asset('display-image', iconUrl);
        assets += asset('full-size-image', iconUrl);
    }

    const xml = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>items</key>
    <array>
        <dict>
            <key>assets</key>
            <array>${assets}
            </array>
            <key>metadata</key>
            <dict>
                <key>bundle-identifier</key>
                <string>${escapeXml(bundleId)}</string>
                <key>bundle-version</key>
                <string>${escapeXml(version)}</string>
                <key>kind</key>
                <string>software</string>
                <key>title</key>
                <string>${escapeXml(name)}</string>
            </dict>
        </dict>
    </array>
</dict>
</plist>
`;

    res.set('Content-Type', 'application/x-plist; charset=utf-8');
    res.set('Cache-Control', 'no-store');
    return res.status(200).send(xml);
}

module.exports = genPlistHandler;
