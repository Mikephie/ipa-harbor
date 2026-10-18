const fs = require('fs');
const os = require('os');
const path = require('path');
const test = require('node:test');
const assert = require('node:assert/strict');

const dataRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'ipa-harbor-sec-'));
process.env.IPA_HARBOR_DATA_ROOT = dataRoot;
process.env.KEYCHAIN_PASSPHRASE = 'test-only-passphrase';
process.env.NODE_ENV = 'test';

const {
    buildLoginArgs,
    redactCommandText,
    runIpatool,
} = require('../utils/ipatoolExec');
const {
    readPresentedToken,
    canExportStoreSession,
} = require('../utils/requestGuards');
const {
    isValidAppleAccountId,
    normalizeIpaFileName,
    resolveOwnedIpaFile,
    readAppleAccountIdFromRequest,
    COOKIE_NAME,
} = require('../utils/appleAccount');
const { filterTasksForAccount } = require('../api/dl-manager/taskAccess');
const genPlistHandler = require('../api/ota/genPlist');
const { signResource } = require('../utils/otaLink');

const ACCOUNT_A = 'aaaaaaaaaaaaaaaa';
const ACCOUNT_B = 'bbbbbbbbbbbbbbbb';
const FAKE_PASSWORD = 'pw$(id)"`';

function mockRes() {
    return {
        statusCode: 200,
        body: null,
        status(code) {
            this.statusCode = code;
            return this;
        },
        set() {
            return this;
        },
        json(payload) {
            this.body = payload;
            return this;
        },
        send(payload) {
            this.body = payload;
            return this;
        },
    };
}

function mockReq(query, host = 'harbor.example') {
    return {
        query,
        get(name) {
            if (name === 'host') return host;
            return '';
        },
    };
}

test('login args stay out of the shell', async () => {
    const args = buildLoginArgs({
        email: 'person@example.com',
        password: FAKE_PASSWORD,
        twoFactor: '12ab34',
        passphrase: 'test-only-passphrase',
    });
    assert.equal(Array.isArray(args), true);
    assert.equal(args.includes(FAKE_PASSWORD), false);
    assert.equal(args.includes(`--password=${FAKE_PASSWORD}`), true);
    assert.equal(args.at(-2), '--auth-code');
    assert.equal(args.at(-1), '1234');

    let captured;
    const result = await runIpatool(args, {
        execFile(_file, argv, options, callback) {
            captured = { argv, shell: options.shell };
            callback(null, '{"ok":true}', '');
        },
    });

    assert.equal(result.stdout, '{"ok":true}');
    assert.equal(captured.shell, false);
    assert.deepEqual(captured.argv, args);
    assert.equal(typeof captured.argv, 'object');
    assert.equal(captured.argv.some((part) => part.includes('&&') || part.startsWith('sh ')), false);
});

test('command failures do not keep credential arguments', () => {
    const redacted = redactCommandText(`failed --password=${FAKE_PASSWORD} --email=person@example.com`);
    assert.equal(redacted.includes(FAKE_PASSWORD), false);
    assert.equal(redacted.includes('person@example.com'), false);
    assert.match(redacted, /--password=\[redacted\]/);
});

test('presented token prefers cookie and ignores non-jwt header values', () => {
    const cookieToken = 'aaa.bbb.ccc';
    const headerToken = 'ddd.eee.fff';
    const selected = readPresentedToken({
        cookies: { authToken: cookieToken },
        headers: {
            authorization: 'Bearer not a token',
            'x-auth-token': headerToken,
        },
    });
    assert.equal(selected, cookieToken);
    assert.equal(readPresentedToken({
        headers: { authorization: 'Bearer ' },
    }), '');
    assert.equal(readPresentedToken({
        headers: { 'x-auth-token': headerToken },
    }), headerToken);
});

test('store session export requires an authenticated admin', () => {
    const headers = { 'x-export-store-session': '1' };
    assert.equal(canExportStoreSession({ headers }), false);
    assert.equal(canExportStoreSession({ headers, user: { id: 1 } }), true);
    assert.equal(canExportStoreSession({ headers: {}, user: { id: 1 } }), false);
});

test('account header is ignored until an admin is authenticated', () => {
    assert.equal(isValidAppleAccountId(ACCOUNT_A), true);
    const headers = { 'x-apple-account-id': ACCOUNT_B };
    assert.equal(readAppleAccountIdFromRequest({ headers, cookies: {} }), null);
    assert.equal(readAppleAccountIdFromRequest({
        headers,
        cookies: {},
        user: { id: 1 },
    }), ACCOUNT_B);
    assert.equal(readAppleAccountIdFromRequest({
        headers,
        cookies: { [COOKIE_NAME]: ACCOUNT_A },
        user: { id: 1 },
    }), ACCOUNT_A);
});

test('tasks without an account id are not returned', () => {
    const tasks = [
        { accountId: ACCOUNT_A, createdAt: '2026-09-13T00:00:00.000Z', id: 'a' },
        { accountId: ACCOUNT_B, createdAt: '2026-09-13T01:00:00.000Z', id: 'b' },
        { createdAt: '2026-09-13T02:00:00.000Z', id: 'c' },
    ];
    assert.deepEqual(filterTasksForAccount(tasks, ''), []);
    assert.deepEqual(filterTasksForAccount(tasks, null), []);
    assert.deepEqual(filterTasksForAccount(tasks, ACCOUNT_A).map((task) => task.id), ['a']);
});

test('ota plist only describes an owned local ipa', () => {
    const home = path.join(dataRoot, 'accounts', ACCOUNT_A);
    fs.mkdirSync(home, { recursive: true });
    fs.writeFileSync(path.join(home, '123_1.ipa'), 'fake-ipa');
    fs.mkdirSync(path.join(dataRoot, 'accounts', ACCOUNT_B), { recursive: true });
    fs.writeFileSync(path.join(dataRoot, 'accounts', ACCOUNT_B, '123_1.ipa'), 'other');

    const outside = path.join(dataRoot, 'outside.ipa');
    fs.writeFileSync(outside, 'outside');
    fs.symlinkSync(outside, path.join(home, '999_1.ipa'));

    assert.equal(normalizeIpaFileName('../outside.ipa'), null);
    assert.equal(resolveOwnedIpaFile(ACCOUNT_A, '123_1.ipa')?.ipaFileName, '123_1.ipa');
    assert.equal(resolveOwnedIpaFile(ACCOUNT_A, '999_1.ipa'), null);
    assert.equal(resolveOwnedIpaFile(ACCOUNT_A, '../outside.ipa'), null);
    assert.equal(resolveOwnedIpaFile(ACCOUNT_B, '123_1')?.dataDir.endsWith(ACCOUNT_B), true);

    delete process.env.PUBLIC_BASE_URL;
    delete process.env.OTA_SIGNING_SECRET;
    const unconfigured = mockRes();
    genPlistHandler(mockReq({
        accountId: ACCOUNT_A,
        file: '123_1.ipa',
        fetchurl: 'https://evil.example/app.ipa',
    }, 'evil.example'), unconfigured);
    assert.equal(unconfigured.statusCode, 503);
    assert.equal(JSON.stringify(unconfigured.body).includes('evil.example'), false);

    process.env.PUBLIC_BASE_URL = 'https://harbor.example';
    process.env.OTA_SIGNING_SECRET = 'test-ota-secret';
    const exp = Date.now() + (60 * 60 * 1000);
    const sig = signResource({
        resource: 'manifest',
        accountId: ACCOUNT_A,
        fileName: '123_1.ipa',
        exp,
        secret: process.env.OTA_SIGNING_SECRET,
    });
    const external = mockRes();
    genPlistHandler(mockReq({
        accountId: ACCOUNT_A,
        file: '123_1.ipa',
        exp: String(exp),
        sig,
        fetchurl: 'https://evil.example/app.ipa',
    }, 'evil.example'), external);
    assert.equal(external.statusCode, 400);

    const owned = mockRes();
    genPlistHandler(mockReq({
        accountId: ACCOUNT_A,
        file: '123_1',
        exp: String(exp),
        sig,
        bundleid: 'app.local',
        name: 'Demo',
        version: '1.0',
        iconurl: 'https://evil.example/icon.png',
    }, 'evil.example'), owned);
    assert.equal(owned.statusCode, 200);
    assert.match(String(owned.body), /https:\/\/harbor\.example\/v1\/ipa\/getpackage\/aaaaaaaaaaaaaaaa\/123_1\.ipa/);
    assert.equal(String(owned.body).includes('evil.example'), false);

    const missingSig = signResource({
        resource: 'manifest',
        accountId: ACCOUNT_A,
        fileName: 'does-not-exist.ipa',
        exp,
        secret: process.env.OTA_SIGNING_SECRET,
    });
    const missing = mockRes();
    genPlistHandler(mockReq({
        accountId: ACCOUNT_A,
        file: 'does-not-exist.ipa',
        exp: String(exp),
        sig: missingSig,
    }), missing);
    assert.equal(missing.statusCode, 404);
    delete process.env.PUBLIC_BASE_URL;
    delete process.env.OTA_SIGNING_SECRET;
});

test.after(() => {
    fs.rmSync(dataRoot, { recursive: true, force: true });
});
