const fs = require('fs');
const os = require('os');
const path = require('path');
const Module = require('module');
const test = require('node:test');
const assert = require('node:assert/strict');

const dataRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'ipa-harbor-auth-'));
process.env.IPA_HARBOR_DATA_ROOT = dataRoot;
process.env.NODE_ENV = 'test';
process.env.KEYCHAIN_PASSPHRASE = 'regression-only';

const ACCOUNT = 'cccccccccccccccc';
const EMAIL = 'person@example.com';
const state = {
    session: null,
    calls: 0,
};

function installExport(resolved, exports) {
    const mocked = new Module(resolved);
    mocked.filename = resolved;
    mocked.loaded = true;
    mocked.exports = exports;
    require.cache[resolved] = mocked;
}

const execPath = require.resolve('../utils/ipatoolExec');
const realExec = require(execPath);
require.cache[execPath].exports = {
    ...realExec,
    runIpatool() {
        state.calls += 1;
        return Promise.resolve({
            stdout: JSON.stringify({
                email: EMAIL,
                name: 'Person',
                password: 'secret-password',
                passwordToken: 'secret-token',
                cookies: 'secret-cookie',
            }),
            stderr: '',
        });
    },
};

installExport(require.resolve('../utils/readIpatoolAccount'), {
    wantsStoreSession(req) {
        const header = String(req?.headers?.['x-export-store-session'] || '').trim();
        return header === '1' || header.toLowerCase() === 'true';
    },
    readIpatoolStoreSession() {
        return Promise.resolve(state.session);
    },
});

const loginHandler = require('../api/auth/login');
const revokeHandler = require('../api/auth/revoke');
const { appleAccountIdFromEmail } = require('../utils/appleAccount');

function mockRes() {
    return {
        statusCode: 200,
        body: null,
        cookies: [],
        status(code) {
            this.statusCode = code;
            return this;
        },
        json(body) {
            this.body = body;
            return this;
        },
        cookie(name, value) {
            this.cookies.push([name, value]);
            return this;
        },
        clearCookie() {
            return this;
        },
    };
}

function loginReq(extra = {}) {
    return {
        body: { email: EMAIL, password: 'not-sent-to-apple' },
        headers: {},
        cookies: {},
        ...extra,
    };
}

test('reusable keychain session does not call ipatool or return secrets', async () => {
    state.calls = 0;
    state.session = {
        email: EMAIL,
        name: 'Person',
        password: 'secret-password',
        passwordToken: 'secret-token',
        cookies: 'secret-cookie',
    };
    const res = mockRes();
    await loginHandler(loginReq(), res);
    assert.equal(state.calls, 0);
    assert.equal(res.body.success, true);
    assert.equal(res.body.data.accountId, appleAccountIdFromEmail(EMAIL));
    const encoded = JSON.stringify(res.body);
    assert.equal(encoded.includes('secret-password'), false);
    assert.equal(encoded.includes('secret-token'), false);
    assert.equal(encoded.includes('secret-cookie'), false);
});

test('store session export still requires an authenticated user', async () => {
    state.calls = 0;
    state.session = {
        email: EMAIL,
        passwordToken: 'secret-token',
        cookies: 'secret-cookie',
    };
    const denied = mockRes();
    await loginHandler(loginReq({
        headers: { 'x-export-store-session': '1' },
    }), denied);
    assert.equal(JSON.stringify(denied.body).includes('secret-token'), false);

    const allowed = mockRes();
    await loginHandler(loginReq({
        user: { id: 1 },
        headers: { 'x-export-store-session': '1' },
    }), allowed);
    assert.equal(allowed.body.data.passwordToken, 'secret-token');
    assert.equal(JSON.stringify(allowed.body).includes('secret-password'), false);
});

test('two-factor and a different stored email do not reuse the session', async () => {
    state.calls = 0;
    state.session = { email: 'other@example.com', name: 'Other' };
    const mismatch = mockRes();
    await loginHandler(loginReq(), mismatch);
    assert.equal(state.calls > 0, true);

    state.calls = 0;
    state.session = { email: EMAIL, name: 'Person' };
    const twoFactor = mockRes();
    await loginHandler(loginReq({
        body: { email: EMAIL, password: 'not-sent-to-apple', twoFactor: '123456' },
    }), twoFactor);
    assert.equal(state.calls > 0, true);
});

test('app revoke keeps the keychain and web revoke removes only that account', async () => {
    const home = path.join(dataRoot, 'accounts', ACCOUNT, '.ipatool');
    fs.mkdirSync(home, { recursive: true });
    fs.writeFileSync(path.join(home, 'account'), 'fake-keychain');
    state.calls = 0;

    const appRes = mockRes();
    await revokeHandler({
        headers: { 'user-agent': 'IPAHarbor/1 CFNetwork' },
        cookies: { ipaAppleAccount: ACCOUNT },
    }, appRes);
    assert.equal(appRes.body.message, '已保留现有商店会话');
    assert.equal(state.calls, 0);
    assert.equal(fs.existsSync(path.join(home, 'account')), true);

    const webRes = mockRes();
    await revokeHandler({
        headers: { 'user-agent': 'Mozilla/5.0' },
        cookies: { ipaAppleAccount: ACCOUNT },
    }, webRes);
    assert.equal(webRes.body.success, true);
    assert.equal(state.calls, 1);
    assert.equal(fs.existsSync(home), false);
});

test.after(() => {
    fs.rmSync(dataRoot, { recursive: true, force: true });
});
