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
    } catch {
        return false;
    }
}

function asset(kind, url, needsShine) {
    const shine = needsShine
        ? `
        <key>needs-shine</key>
        <false/>`
        : '';
    return `
        <dict>
        <key>kind</key>
        <string>${escapeXml(kind)}</string>${shine}
        <key>url</key>
        <string>${escapeXml(url)}</string>
        </dict>`;
}

/**
 * 给手机 itms-services 用的 HTTPS 安装清单。
 * palera.in 已不可用；清单必须 HTTPS，IPA 仍可指向本机 http://127.0.0.1。
 */
function genPlistHandler(req, res) {
    const bundleId = String(req.query.bundleid || '').trim();
    const name = String(req.query.name || bundleId || 'App').trim();
    const version = String(req.query.version || '1.0').trim();
    const fetchUrl = String(req.query.fetchurl || '').trim();
    const iconUrl = String(req.query.iconurl || '').trim();

    if (!bundleId || !isSafeHttpUrl(fetchUrl)) {
        return res.status(400).json({
            success: false,
            message: '需要 bundleid 和合法的 fetchurl',
        });
    }

    let assets = asset('software-package', fetchUrl, false);
    if (iconUrl && isSafeHttpUrl(iconUrl)) {
        assets += asset('display-image', iconUrl, true);
        assets += asset('full-size-image', iconUrl, true);
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
