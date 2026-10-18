const crypto = require('crypto');
const {
    isValidAppleAccountId,
    normalizeIpaFileName,
    resolveOwnedIpaFile,
    resolveLegacyIpaFile,
    readAppleAccountIdFromRequest,
} = require('./appleAccount');

const OTA_TTL_MS = 60 * 60 * 1000;
const RESOURCES = new Set(['manifest', 'ipa', 'legacy-ipa']);

function parsePublicBaseUrl(value) {
    if (typeof value !== 'string') {
        return null;
    }
    const trimmed = value.trim();
    if (!trimmed) {
        return null;
    }
    let url;
    try {
        url = new URL(trimmed);
    } catch (_) {
        return null;
    }
    if (url.protocol !== 'https:') {
        return null;
    }
    if (url.username || url.password) {
        return null;
    }
    if (url.search || url.hash) {
        return null;
    }
    if (url.pathname !== '/' && url.pathname !== '') {
        return null;
    }
    const origin = url.origin;
    const withoutSlash = trimmed.replace(/\/$/, '');
    if (withoutSlash !== origin) {
        return null;
    }
    return origin;
}

function readOtaConfig(env = process.env) {
    const secret = typeof env.OTA_SIGNING_SECRET === 'string' ? env.OTA_SIGNING_SECRET : '';
    const baseUrl = parsePublicBaseUrl(env.PUBLIC_BASE_URL);
    return {
        configured: Boolean(secret) && Boolean(baseUrl),
        secret,
        baseUrl,
    };
}

function signResource({ resource, accountId = '', fileName, exp, secret }) {
    const canonical = [
        resource,
        accountId,
        fileName,
        String(exp),
    ].join('\n');
    return crypto.createHmac('sha256', secret).update(canonical).digest('base64url');
}

function verifyResource({ resource, accountId = '', fileName, exp, sig, secret, now = Date.now() }) {
    if (!RESOURCES.has(resource) || !secret || !sig || !fileName) {
        return false;
    }
    const expNum = Number(exp);
    if (!Number.isSafeInteger(expNum) || expNum <= now) {
        return false;
    }
    const expected = signResource({
        resource,
        accountId,
        fileName,
        exp: expNum,
        secret,
    });
    const actualBuffer = Buffer.from(String(sig));
    const expectedBuffer = Buffer.from(expected);
    if (actualBuffer.length !== expectedBuffer.length) {
        return false;
    }
    return crypto.timingSafeEqual(actualBuffer, expectedBuffer);
}

function signedAssetUrl({ baseUrl, resource, accountId, fileName, exp, secret }) {
    const sig = signResource({ resource, accountId, fileName, exp, secret });
    const query = `exp=${encodeURIComponent(exp)}&sig=${encodeURIComponent(sig)}`;
    if (resource === 'legacy-ipa') {
        return `${baseUrl}/v1/ipa/getpackage/${encodeURIComponent(fileName)}?${query}`;
    }
    if (resource === 'manifest') {
        const stem = fileName.replace(/\.ipa$/i, '');
        return `${baseUrl}/v1/ipa/install-package/${accountId}/${encodeURIComponent(stem)}/manifest.plist?${query}`;
    }
    return `${baseUrl}/v1/ipa/getpackage/${accountId}/${encodeURIComponent(fileName)}?${query}`;
}

function createAccountLinks({ accountId, ipaFileName, config, now = Date.now() }) {
    const exp = now + OTA_TTL_MS;
    const manifestUrl = signedAssetUrl({
        baseUrl: config.baseUrl,
        resource: 'manifest',
        accountId,
        fileName: ipaFileName,
        exp,
        secret: config.secret,
    });
    const downloadUrl = signedAssetUrl({
        baseUrl: config.baseUrl,
        resource: 'ipa',
        accountId,
        fileName: ipaFileName,
        exp,
        secret: config.secret,
    });
    return {
        installUrl: `itms-services://?action=download-manifest&url=${encodeURIComponent(manifestUrl)}`,
        downloadUrl,
        expiresAt: new Date(exp).toISOString(),
        exp,
    };
}

function createLegacyLink({ ipaFileName, config, now = Date.now() }) {
    const exp = now + OTA_TTL_MS;
    const downloadUrl = signedAssetUrl({
        baseUrl: config.baseUrl,
        resource: 'legacy-ipa',
        accountId: '',
        fileName: ipaFileName,
        exp,
        secret: config.secret,
    });
    return {
        downloadUrl,
        expiresAt: new Date(exp).toISOString(),
        exp,
    };
}

function unavailableBody() {
    return { success: false, message: 'OTA 未配置' };
}

function rejectedBody() {
    return { success: false, message: '安装链接无效或已过期' };
}

function fileNameFromRequest(body = {}) {
    if (body.file) {
        return String(body.file);
    }
    if (body.appId && body.versionId) {
        return `${body.appId}_${body.versionId}`;
    }
    return '';
}

function mintAccountInstall(req, options = {}) {
    if (!req?.user) {
        return { status: 401, body: { success: false, message: '未提供认证令牌' } };
    }
    const config = readOtaConfig(options.env);
    if (!config.configured) {
        return { status: 503, body: unavailableBody() };
    }
    const accountId = readAppleAccountIdFromRequest(req);
    const requested = String(req.body?.accountId || '').trim();
    if (!isValidAppleAccountId(accountId) || (requested && requested !== accountId)) {
        return { status: 403, body: { success: false, message: '不能为其他账号签发安装链接' } };
    }
    const owned = resolveOwnedIpaFile(accountId, fileNameFromRequest(req.body));
    if (!owned) {
        return { status: 404, body: { success: false, message: '找不到该账号下的 IPA' } };
    }
    const links = createAccountLinks({
        accountId,
        ipaFileName: owned.ipaFileName,
        config,
        now: options.now,
    });
    return {
        status: 200,
        body: {
            success: true,
            data: {
                installUrl: links.installUrl,
                downloadUrl: links.downloadUrl,
                expiresAt: links.expiresAt,
            },
        },
    };
}

function mintLegacyInstall(req, options = {}) {
    if (!req?.user) {
        return { status: 401, body: { success: false, message: '未提供认证令牌' } };
    }
    const config = readOtaConfig(options.env);
    if (!config.configured) {
        return { status: 503, body: unavailableBody() };
    }
    const legacy = resolveLegacyIpaFile(fileNameFromRequest(req.body));
    if (!legacy) {
        return { status: 404, body: { success: false, message: '找不到旧目录中的 IPA' } };
    }
    const links = createLegacyLink({
        ipaFileName: legacy.ipaFileName,
        config,
        now: options.now,
    });
    return {
        status: 200,
        body: { success: true, data: links },
    };
}

function authorizeAsset({ resource, accountId = '', fileName, exp, sig, env = process.env, now = Date.now() }) {
    const config = readOtaConfig(env);
    if (!config.configured) {
        return { status: 503, body: unavailableBody() };
    }
    const ipaFileName = normalizeIpaFileName(fileName);
    if (!ipaFileName) {
        return { status: 400, body: { success: false, message: '无效的文件名' } };
    }
    const signedAccount = resource === 'legacy-ipa' ? '' : accountId;
    if (resource !== 'legacy-ipa' && !isValidAppleAccountId(signedAccount)) {
        return { status: 403, body: rejectedBody() };
    }
    const valid = verifyResource({
        resource,
        accountId: signedAccount,
        fileName: ipaFileName,
        exp,
        sig,
        secret: config.secret,
        now,
    });
    if (!valid) {
        return { status: 403, body: rejectedBody() };
    }
    return { status: 200, ipaFileName, config, exp: Number(exp) };
}

function ipaUrlForManifest({ accountId, ipaFileName, exp, config }) {
    return signedAssetUrl({
        baseUrl: config.baseUrl,
        resource: 'ipa',
        accountId,
        fileName: ipaFileName,
        exp,
        secret: config.secret,
    });
}

module.exports = {
    OTA_TTL_MS,
    parsePublicBaseUrl,
    readOtaConfig,
    signResource,
    verifyResource,
    signedAssetUrl,
    createAccountLinks,
    mintAccountInstall,
    mintLegacyInstall,
    authorizeAsset,
    ipaUrlForManifest,
};
