const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const DATA_ROOT = path.join(__dirname, '../data');
const ACCOUNTS_ROOT = path.join(DATA_ROOT, 'accounts');
const LEGACY_FLAT_DATA_DIR = DATA_ROOT;

const COOKIE_NAME = 'ipaAppleAccount';
const ACCOUNT_ID_RE = /^[a-f0-9]{16}$/;

function appleAccountIdFromEmail(email) {
    const normalized = String(email).trim().toLowerCase();
    return crypto.createHash('sha256').update(normalized).digest('hex').slice(0, 16);
}

function isValidAppleAccountId(id) {
    return typeof id === 'string' && ACCOUNT_ID_RE.test(id);
}

function getAppleAccountHome(accountId) {
    return path.join(ACCOUNTS_ROOT, accountId);
}

/**
 * 解析 IPA 在磁盘上的实际路径：优先当前账号目录，再回退到升级前的 data 根目录（与 getpackage 旧路径一致）。
 * @returns {{ ipaFileName: string, ipaPath: string, dataDir: string }}
 */
function resolveIpaFilePath(fileName, accountId) {
    const ipaFileName = fileName.endsWith('.ipa') ? fileName : `${fileName}.ipa`;
    const candidates = [];
    if (accountId && isValidAppleAccountId(accountId)) {
        const home = getAppleAccountHome(accountId);
        candidates.push({ ipaPath: path.join(home, ipaFileName), dataDir: home });
    }
    candidates.push({
        ipaPath: path.join(LEGACY_FLAT_DATA_DIR, ipaFileName),
        dataDir: LEGACY_FLAT_DATA_DIR,
    });

    for (const c of candidates) {
        if (fs.existsSync(c.ipaPath)) {
            return { ipaFileName, ipaPath: c.ipaPath, dataDir: c.dataDir };
        }
    }
    const primary = candidates[0] || {
        ipaPath: path.join(LEGACY_FLAT_DATA_DIR, ipaFileName),
        dataDir: LEGACY_FLAT_DATA_DIR,
    };
    return { ipaFileName, ipaPath: primary.ipaPath, dataDir: primary.dataDir };
}

function ensureAppleAccountHome(accountId) {
    const home = getAppleAccountHome(accountId);
    fs.mkdirSync(home, { recursive: true });
    return home;
}

/**
 * ipatool 使用 machine.HomeDirectory() + ".ipatool" 存放钥匙串与 cookie；
 * 为每个账号设置独立 HOME 即可实现多账号（Linux/Docker 下为文件型 keyring）。
 */
function ipatoolEnvForAccount(accountId) {
    const home = ensureAppleAccountHome(accountId);
    return { ...process.env, HOME: home };
}

function readAppleAccountIdFromRequest(req) {
    const fromCookie = req.cookies?.[COOKIE_NAME];
    if (isValidAppleAccountId(fromCookie)) {
        return fromCookie;
    }
    const fromHeader = String(req.headers['x-apple-account-id'] || '').trim();
    if (isValidAppleAccountId(fromHeader)) {
        return fromHeader;
    }
    return null;
}

function setAppleAccountCookie(res, accountId) {
    const isLanAccess = process.env.ALLOW_LAN_ACCESS === 'true';
    res.cookie(COOKIE_NAME, accountId, {
        httpOnly: true,
        secure: process.env.NODE_ENV === 'production' && !isLanAccess,
        sameSite: isLanAccess ? 'lax' : 'strict',
        maxAge: 2 * 24 * 60 * 60 * 1000,
        path: '/',
    });
}

function clearAppleAccountCookie(res) {
    const isLanAccess = process.env.ALLOW_LAN_ACCESS === 'true';
    res.clearCookie(COOKIE_NAME, {
        httpOnly: true,
        secure: process.env.NODE_ENV === 'production' && !isLanAccess,
        sameSite: isLanAccess ? 'lax' : 'strict',
        path: '/',
    });
}

const ACCOUNT_META_FILE = 'account-meta.json';

function readAccountMeta(accountId) {
    if (!isValidAppleAccountId(accountId)) {
        return null;
    }
    const metaPath = path.join(getAppleAccountHome(accountId), ACCOUNT_META_FILE);
    if (!fs.existsSync(metaPath)) {
        return null;
    }
    try {
        return JSON.parse(fs.readFileSync(metaPath, 'utf8'));
    } catch (_) {
        return null;
    }
}

function writeAccountMeta(accountId, patch = {}) {
    const home = ensureAppleAccountHome(accountId);
    const metaPath = path.join(home, ACCOUNT_META_FILE);
    const previous = readAccountMeta(accountId) || {};
    const payload = {
        ...previous,
        ...patch,
        updatedAt: new Date().toISOString(),
    };
    if (payload.email) {
        payload.email = String(payload.email).trim().toLowerCase();
    }
    fs.writeFileSync(metaPath, `${JSON.stringify(payload, null, 2)}\n`, 'utf8');
    return payload;
}

function resolveAccountRegion(email, accountId) {
    if (email && global.userRegions?.has(email)) {
        return global.userRegions.get(email) || null;
    }
    const meta = readAccountMeta(accountId);
    return meta?.region || null;
}

/**
 * 列出本机已保存会话的账号（存在 .ipatool 目录）
 */
/**
 * 删掉该账号的 ipatool 钥匙串/cookie。
 * 只做 auth revoke 不够：文件还在时，下次 login 会复用会话，苹果不会发验证码。
 */
function wipeIpatoolSession(accountId) {
    if (!isValidAppleAccountId(accountId)) {
        return false;
    }
    const ipatoolDir = path.join(getAppleAccountHome(accountId), '.ipatool');
    if (!fs.existsSync(ipatoolDir)) {
        return false;
    }
    fs.rmSync(ipatoolDir, { recursive: true, force: true });
    return true;
}

function listStoredAccounts(currentAccountId) {
    if (!fs.existsSync(ACCOUNTS_ROOT)) {
        return [];
    }
    const list = [];
    const entries = fs.readdirSync(ACCOUNTS_ROOT, { withFileTypes: true });
    for (const ent of entries) {
        if (!ent.isDirectory()) continue;
        const accountId = ent.name;
        if (!isValidAppleAccountId(accountId)) continue;
        const home = path.join(ACCOUNTS_ROOT, accountId);
        const ipatoolDir = path.join(home, '.ipatool');
        if (!fs.existsSync(ipatoolDir)) continue;

        let email = null;
        let updatedAt = null;
        const metaPath = path.join(home, ACCOUNT_META_FILE);
        if (fs.existsSync(metaPath)) {
            try {
                const meta = JSON.parse(fs.readFileSync(metaPath, 'utf8'));
                email = meta.email || null;
                updatedAt = meta.updatedAt || null;
            } catch (_) {
                /* ignore */
            }
        }

        list.push({
            accountId,
            email: email || `••••${accountId.slice(-4)}`,
            lastLoginAt: updatedAt,
            current: accountId === currentAccountId,
        });
    }

    list.sort((a, b) => {
        if (a.current !== b.current) return a.current ? -1 : 1;
        return String(b.lastLoginAt || '').localeCompare(String(a.lastLoginAt || ''));
    });

    return list;
}

module.exports = {
    ACCOUNTS_ROOT,
    LEGACY_FLAT_DATA_DIR,
    COOKIE_NAME,
    appleAccountIdFromEmail,
    isValidAppleAccountId,
    getAppleAccountHome,
    resolveIpaFilePath,
    ensureAppleAccountHome,
    ipatoolEnvForAccount,
    readAppleAccountIdFromRequest,
    setAppleAccountCookie,
    clearAppleAccountCookie,
    writeAccountMeta,
    readAccountMeta,
    resolveAccountRegion,
    listStoredAccounts,
    wipeIpatoolSession,
};
