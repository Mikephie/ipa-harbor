const fs = require('fs');
const path = require('path');
const { compactDecrypt } = require('jose');
const { KEYCHAIN_PASSPHRASE } = require('../config/keychain');
const { getAppleAccountHome, isValidAppleAccountId } = require('./appleAccount');
const { wantsStoreSession } = require('./requestGuards');

function parseJSON(text) {
    if (!text || typeof text !== 'string') {
        return null;
    }
    try {
        return JSON.parse(text);
    } catch (_) {
        return null;
    }
}

function stringValue(value) {
    if (typeof value !== 'string') {
        return '';
    }
    return value.trim();
}

function serializeCookie(cookie) {
    const name = stringValue(cookie.Name || cookie.name);
    const value = stringValue(cookie.Value || cookie.value);
    if (!name) {
        return null;
    }
    const parts = [`${name}=${value}`];
    const domain = stringValue(cookie.Domain || cookie.domain);
    const pathValue = stringValue(cookie.Path || cookie.path) || '/';
    if (domain) {
        parts.push(`Domain=${domain}`);
    }
    parts.push(`Path=${pathValue}`);
    if (cookie.Secure || cookie.secure) {
        parts.push('Secure');
    }
    if (cookie.HttpOnly || cookie.httpOnly) {
        parts.push('HttpOnly');
    }
    return parts.join('; ');
}

function collectCookies(object, cookies) {
    if (!object) {
        return;
    }
    if (Array.isArray(object)) {
        for (const item of object) {
            collectCookies(item, cookies);
        }
        return;
    }
    if (typeof object !== 'object') {
        return;
    }
    const serialized = serializeCookie(object);
    if (serialized) {
        cookies.push(serialized);
        return;
    }
    for (const value of Object.values(object)) {
        collectCookies(value, cookies);
    }
}

function readCookies(accountHome) {
    const jarPath = path.join(accountHome, '.ipatool', 'cookies');
    if (!fs.existsSync(jarPath)) {
        return [];
    }
    const text = fs.readFileSync(jarPath, 'utf8');
    const json = parseJSON(text);
    const cookies = [];
    if (json) {
        collectCookies(json, cookies);
    }
    return cookies;
}

async function decryptKeyringItem(filePath) {
    const token = fs.readFileSync(filePath, 'utf8').trim();
    if (!token || !KEYCHAIN_PASSPHRASE) {
        return null;
    }
    const secret = new TextEncoder().encode(KEYCHAIN_PASSPHRASE);
    const { plaintext } = await compactDecrypt(token, secret);
    return parseJSON(new TextDecoder().decode(plaintext));
}

function decodeItemData(item) {
    if (!item) {
        return null;
    }
    if (Buffer.isBuffer(item.Data)) {
        return parseJSON(item.Data.toString('utf8'));
    }
    if (typeof item.Data === 'string') {
        const asText = parseJSON(item.Data);
        if (asText) {
            return asText;
        }
        try {
            return parseJSON(Buffer.from(item.Data, 'base64').toString('utf8'));
        } catch (_) {
            return null;
        }
    }
    if (item.data) {
        return decodeItemData({ Data: item.data });
    }
    if (item.email || item.passwordToken || item.directoryServicesIdentifier) {
        return item;
    }
    return null;
}

function mapAccount(raw, cookies, accountId) {
    if (!raw || typeof raw !== 'object') {
        return null;
    }
    const payload = raw.account && typeof raw.account === 'object' ? raw.account : raw;
    const email = stringValue(payload.email);
    const name = stringValue(payload.name);
    const names = name.split(/\s+/).filter(Boolean);
    const dsid = stringValue(
        payload.directoryServicesIdentifier
        || payload.directoryServicesID
        || payload.dsPersonId
    );
    const passwordToken = stringValue(payload.passwordToken);
    const storeFront = stringValue(payload.storeFront || payload.storefront);
    const pod = stringValue(payload.pod) || null;
    if (!dsid || !passwordToken || !storeFront) {
        return null;
    }
    return {
        email,
        name,
        firstName: names[0] || '',
        lastName: names.slice(1).join(' '),
        dsPersonId: dsid,
        directoryServicesIdentifier: dsid,
        passwordToken,
        storeFront,
        pod,
        cookies,
        accountId,
    };
}

async function readIpatoolStoreSession(accountId) {
    if (!isValidAppleAccountId(accountId)) {
        return null;
    }
    const home = getAppleAccountHome(accountId);
    const keyringPath = path.join(home, '.ipatool', 'account');
    if (!fs.existsSync(keyringPath)) {
        return null;
    }
    try {
        const item = await decryptKeyringItem(keyringPath);
        return mapAccount(decodeItemData(item), readCookies(home), accountId);
    } catch (error) {
        console.error('读取 ipatool 商店会话失败:', error.message);
        return null;
    }
}

module.exports = {
    wantsStoreSession,
    readIpatoolStoreSession,
};
