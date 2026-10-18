const test = require('node:test');
const assert = require('node:assert/strict');
const { spawnSync } = require('child_process');
const path = require('path');

const jwtPath = path.join(__dirname, '../config/jwtSecret.js');
const keychainPath = path.join(__dirname, '../config/keychain.js');
const { resolveJwtSecret } = require('../config/jwtSecret');
const { parsePublicBaseUrl, authorizeAsset } = require('../utils/otaLink');

function runModule(modulePath, env) {
    return spawnSync(process.execPath, ['-e', `require(${JSON.stringify(modulePath)})`], {
        env: { PATH: process.env.PATH, ...env },
    });
}

test('production JWT rejects missing, empty, and blank values', () => {
    for (const secret of [undefined, '', '   ']) {
        const env = { NODE_ENV: 'production', KEYCHAIN_PASSPHRASE: 'isolated-only' };
        if (secret !== undefined) env.JWT_SECRET = secret;
        const child = spawnSync(process.execPath, ['-e', `
            const { enforceJwtSecret } = require(${JSON.stringify(jwtPath)});
            enforceJwtSecret();
            console.log('started');
        `], { env: { PATH: process.env.PATH, ...env } });
        assert.equal(child.status, 1);
        assert.equal(String(child.stdout).includes('started'), false);
    }
    const ok = resolveJwtSecret({ NODE_ENV: 'production', JWT_SECRET: 'isolated-jwt' });
    assert.equal(ok.ok, true);
    assert.equal(ok.secret, 'isolated-jwt');
});

test('public origin rejects non-https and non-origin values', () => {
    assert.equal(parsePublicBaseUrl('https://ipa.mikephie.com'), 'https://ipa.mikephie.com');
    for (const bad of [
        '',
        '   ',
        'http://ipa.mikephie.com',
        'https://ipa.mikephie.com/ipa',
        'https://ipa.mikephie.com?x=1',
        'https://user:pw@ipa.mikephie.com',
        'https://192.168.88.88:3443/health',
    ]) {
        assert.equal(parsePublicBaseUrl(bad), null);
    }
    const closed = authorizeAsset({
        resource: 'ipa',
        accountId: 'aaaaaaaaaaaaaaaa',
        fileName: '123_1.ipa',
        exp: Date.now() + 1000,
        sig: 'x',
        env: { NODE_ENV: 'production', PUBLIC_BASE_URL: 'https://ipa.mikephie.com/extra', OTA_SIGNING_SECRET: 'isolated-ota' },
    });
    assert.equal(closed.status, 503);
});

test('keychain gate checks presence and does not compare a stored passphrase', () => {
    const missing = runModule(keychainPath, { NODE_ENV: 'production' });
    const empty = runModule(keychainPath, { NODE_ENV: 'production', KEYCHAIN_PASSPHRASE: '' });
    const blank = runModule(keychainPath, { NODE_ENV: 'production', KEYCHAIN_PASSPHRASE: '   ' });
    const present = runModule(keychainPath, { NODE_ENV: 'production', KEYCHAIN_PASSPHRASE: 'isolated-only' });
    assert.equal(missing.status, 1);
    assert.equal(empty.status, 1);
    assert.equal(blank.status, 1);
    assert.equal(present.status, 0);
    assert.equal(String(missing.stdout).includes('isolated-only'), false);
    assert.equal(String(present.stdout).includes('isolated-only'), false);
});
