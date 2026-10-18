const fs = require('fs');
const os = require('os');
const path = require('path');
const test = require('node:test');
const assert = require('node:assert/strict');
const { spawnSync } = require('child_process');

const repoRoot = path.join(__dirname, '..', '..');
const dataRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'ipa-harbor-r3-'));
process.env.IPA_HARBOR_DATA_ROOT = dataRoot;
process.env.NODE_ENV = 'test';
process.env.KEYCHAIN_PASSPHRASE = 'round3-keychain';
process.env.JWT_SECRET = 'round3-jwt';
process.env.OTA_SIGNING_SECRET = 'round3-ota';
process.env.PUBLIC_BASE_URL = 'https://harbor.example';

const { enforceJwtSecret, resolveJwtSecret } = require('../config/jwtSecret');
const {
    parsePublicBaseUrl,
    readOtaConfig,
    signResource,
    verifyResource,
    authorizeAsset,
    mintAccountInstall,
    mintLegacyInstall,
    OTA_TTL_MS,
} = require('../utils/otaLink');
const {
    resolveIpaFilePath,
    resolveLegacyIpaFile,
    resolveOwnedIpaFile,
    COOKIE_NAME,
} = require('../utils/appleAccount');
const genPlistHandler = require('../api/ota/genPlist');

const A = 'aaaaaaaaaaaaaaaa';
const B = 'bbbbbbbbbbbbbbbb';
const NOW = Date.now();

function mockRes() {
    return {
        statusCode: 200,
        body: null,
        status(code) { this.statusCode = code; return this; },
        set() { return this; },
        json(body) { this.body = body; return this; },
        send(body) { this.body = body; return this; },
    };
}

function mockReq(query, host = 'evil.example') {
    return {
        query,
        get(name) {
            if (name === 'x-forwarded-host') return host;
            if (name === 'host') return host;
            return '';
        },
    };
}

function adminReq(accountId, body) {
    return {
        user: { id: 1 },
        cookies: { [COOKIE_NAME]: accountId },
        headers: {},
        body,
    };
}

test('production refuses to start without JWT_SECRET and does not rotate it', () => {
    const missing = spawnSync(process.execPath, ['-e', `
        const { enforceJwtSecret } = require(${JSON.stringify(path.join(repoRoot, 'server/config/jwtSecret.js'))});
        enforceJwtSecret();
        console.log('started');
    `], { env: { PATH: process.env.PATH, NODE_ENV: 'production' } });
    assert.equal(missing.status, 1);
    assert.equal(String(missing.stdout).includes('started'), false);
    assert.equal(String(missing.stderr).includes('round3-jwt'), false);
    assert.equal(String(missing.stderr).includes('development-only-jwt'), false);

    const configured = spawnSync(process.execPath, ['-e', `
        const { enforceJwtSecret } = require(${JSON.stringify(path.join(repoRoot, 'server/config/jwtSecret.js'))});
        const secret = enforceJwtSecret();
        if (secret !== process.env.JWT_SECRET) process.exit(2);
    `], {
        env: { PATH: process.env.PATH, NODE_ENV: 'production', JWT_SECRET: 'round3-jwt' },
    });
    assert.equal(configured.status, 0);

    const development = resolveJwtSecret({ NODE_ENV: 'development' });
    assert.equal(development.ok, true);
    assert.equal(development.secret.length > 0, true);
});

test('ota origin is https-only and signing secrets stay independent', () => {
    assert.equal(parsePublicBaseUrl('https://harbor.example'), 'https://harbor.example');
    assert.equal(parsePublicBaseUrl('https://harbor.example:8443'), 'https://harbor.example:8443');
    assert.equal(parsePublicBaseUrl('https://harbor.example/'), 'https://harbor.example');
    for (const bad of [
        'http://harbor.example',
        'https://user:pass@harbor.example',
        'https://harbor.example/ipa',
        'https://harbor.example?x=1',
        'https://harbor.example#frag',
        '',
    ]) {
        assert.equal(parsePublicBaseUrl(bad), null);
    }

    const baseEnv = {
        OTA_SIGNING_SECRET: 'round3-ota',
        PUBLIC_BASE_URL: 'https://harbor.example',
        JWT_SECRET: 'round3-jwt',
        KEYCHAIN_PASSPHRASE: 'round3-keychain',
    };
    const first = signResource({
        resource: 'ipa',
        accountId: A,
        fileName: '123_1.ipa',
        exp: NOW + OTA_TTL_MS,
        secret: readOtaConfig(baseEnv).secret,
    });
    const changedOtherSecrets = signResource({
        resource: 'ipa',
        accountId: A,
        fileName: '123_1.ipa',
        exp: NOW + OTA_TTL_MS,
        secret: readOtaConfig({ ...baseEnv, JWT_SECRET: 'other-jwt', KEYCHAIN_PASSPHRASE: 'other-keychain' }).secret,
    });
    const changedOta = signResource({
        resource: 'ipa',
        accountId: A,
        fileName: '123_1.ipa',
        exp: NOW + OTA_TTL_MS,
        secret: readOtaConfig({ ...baseEnv, OTA_SIGNING_SECRET: 'other-ota' }).secret,
    });
    assert.equal(first, changedOtherSecrets);
    assert.notEqual(first, changedOta);
    assert.equal(enforceJwtSecret({ NODE_ENV: 'test', JWT_SECRET: 'round3-jwt' }, () => {
        throw new Error('should not exit');
    }), 'round3-jwt');
});

test('signed manifest ignores host headers and rejects bad links', () => {
    const home = path.join(dataRoot, 'accounts', A);
    fs.mkdirSync(home, { recursive: true });
    fs.writeFileSync(path.join(home, '123_1.ipa'), 'fake');
    fs.mkdirSync(path.join(dataRoot, 'accounts', B), { recursive: true });
    fs.writeFileSync(path.join(dataRoot, 'accounts', B, '123_1.ipa'), 'other');
    fs.writeFileSync(path.join(dataRoot, 'legacy_1.ipa'), 'legacy');
    const outside = path.join(dataRoot, 'outside.ipa');
    fs.writeFileSync(outside, 'outside');
    fs.symlinkSync(outside, path.join(home, '999_1.ipa'));

    const exp = NOW + OTA_TTL_MS;
    const secret = 'round3-ota';
    const manifestSig = signResource({
        resource: 'manifest',
        accountId: A,
        fileName: '123_1.ipa',
        exp,
        secret,
    });
    const ipaSig = signResource({
        resource: 'ipa',
        accountId: A,
        fileName: '123_1.ipa',
        exp,
        secret,
    });

    const plist = mockRes();
    genPlistHandler(mockReq({
        accountId: A,
        file: '123_1.ipa',
        exp: String(exp),
        sig: manifestSig,
    }), plist);
    assert.equal(plist.statusCode, 200);
    assert.match(String(plist.body), /https:\/\/harbor\.example\/v1\/ipa\/getpackage\/aaaaaaaaaaaaaaaa\/123_1\.ipa\?/);
    assert.equal(String(plist.body).includes('evil.example'), false);
    assert.match(String(plist.body), /itms-services|software-package/);
    assert.equal(String(plist.body).includes('sig='), true);

    assert.equal(authorizeAsset({
        resource: 'ipa', accountId: A, fileName: '123_1.ipa', exp, sig: ipaSig, now: NOW,
    }).status, 200);
    assert.equal(authorizeAsset({
        resource: 'ipa', accountId: A, fileName: '123_1.ipa', exp, sig: manifestSig, now: NOW,
    }).status, 403);
    assert.equal(authorizeAsset({
        resource: 'ipa', accountId: B, fileName: '123_1.ipa', exp, sig: ipaSig, now: NOW,
    }).status, 403);
    assert.equal(authorizeAsset({
        resource: 'ipa', accountId: A, fileName: '123_1.ipa', exp: NOW - 1, sig: ipaSig, now: NOW,
    }).status, 403);
    const tampered = `${ipaSig.slice(0, -1)}${ipaSig.endsWith('a') ? 'b' : 'a'}`;
    assert.equal(authorizeAsset({
        resource: 'ipa', accountId: A, fileName: '123_1.ipa', exp, sig: tampered, now: NOW,
    }).status, 403);
    assert.equal(authorizeAsset({
        resource: 'ipa', accountId: A, fileName: '../123_1.ipa', exp, sig: ipaSig, now: NOW,
    }).status, 400);
    const accountLookup = resolveIpaFilePath('legacy_1.ipa', A);
    assert.equal(accountLookup?.ipaPath.includes(`${path.sep}accounts${path.sep}`), true);
    assert.equal(fs.existsSync(accountLookup.ipaPath), false);
    assert.equal(resolveLegacyIpaFile('legacy_1.ipa')?.ipaFileName, 'legacy_1.ipa');
    const legacyViaOtherAccount = authorizeAsset({
        resource: 'ipa', accountId: B, fileName: 'legacy_1.ipa', exp, sig: signResource({
            resource: 'ipa', accountId: B, fileName: 'legacy_1.ipa', exp, secret,
        }), now: NOW,
    });
    assert.equal(legacyViaOtherAccount.status, 200);
    assert.equal(resolveOwnedIpaFile(B, 'legacy_1.ipa'), null);
    assert.equal(authorizeAsset({
        resource: 'manifest',
        accountId: A,
        fileName: '123_1.ipa',
        exp,
        sig: manifestSig,
        env: {},
        now: NOW,
    }).status, 503);
    assert.equal(resolveIpaFilePath('123_1.ipa', A)?.ipaPath.includes(`${path.sep}${B}${path.sep}`), false);

    const minted = mintAccountInstall(adminReq(A, { appId: '123', versionId: '1', accountId: A }), { now: NOW });
    assert.equal(minted.status, 200);
    assert.match(minted.body.data.installUrl, /^itms-services:\/\/\?action=download-manifest&url=/);
    assert.match(decodeURIComponent(minted.body.data.installUrl), /https:\/\/harbor\.example\//);
    assert.equal(minted.body.data.installUrl.includes('evil.example'), false);
    assert.equal(mintAccountInstall({ cookies: {}, headers: {}, body: {} }).status, 401);
    assert.equal(mintAccountInstall(adminReq(A, { appId: '123', versionId: '1', accountId: B }), { now: NOW }).status, 403);
    assert.equal(mintAccountInstall(adminReq(A, { file: '999_1.ipa' }), { now: NOW }).status, 404);

    const legacy = mintLegacyInstall(adminReq(A, { file: 'legacy_1.ipa' }), { now: NOW });
    assert.equal(legacy.status, 200);
    assert.match(legacy.body.data.downloadUrl, /\/v1\/ipa\/getpackage\/legacy_1\.ipa\?/);
    assert.equal(legacy.body.data.downloadUrl.includes(`/${A}/`), false);
    const legacySig = signResource({
        resource: 'legacy-ipa', accountId: '', fileName: 'legacy_1.ipa', exp, secret,
    });
    assert.equal(verifyResource({
        resource: 'legacy-ipa', accountId: '', fileName: 'legacy_1.ipa', exp, sig: legacySig, secret, now: NOW,
    }), true);
    assert.equal(verifyResource({
        resource: 'ipa', accountId: A, fileName: 'legacy_1.ipa', exp, sig: legacySig, secret, now: NOW,
    }), false);
});

test('docker run forwards secrets and uses the listening port', () => {
    const pkg = JSON.parse(fs.readFileSync(path.join(repoRoot, 'server/package.json'), 'utf8'));
    const script = pkg.scripts['docker:run'];
    const dockerfile = fs.readFileSync(path.join(repoRoot, 'server/Dockerfile'), 'utf8');
    assert.equal(script.includes('KEYCHAIN_PASSPHRASE='), false);
    assert.equal(script.includes('-e KEYCHAIN_PASSPHRASE'), true);
    assert.equal(script.includes('-e JWT_SECRET'), true);
    assert.equal(script.includes('-e OTA_SIGNING_SECRET'), true);
    assert.equal(script.includes('-e PUBLIC_BASE_URL'), true);
    assert.equal(script.includes('3080:3080'), true);
    assert.equal(script.includes('3000:3000'), false);
    assert.match(dockerfile, /EXPOSE 3080/);
    assert.match(dockerfile, /ENV PORT=3080/);
});

test.after(() => {
    fs.rmSync(dataRoot, { recursive: true, force: true });
});
