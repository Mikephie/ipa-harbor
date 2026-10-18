const crypto = require('crypto');
const fs = require('fs');
const http = require('http');
const { once } = require('events');

const base = process.env.ISOLATED_BASE_URL || 'http://127.0.0.1:18080';
const secret = process.env.OTA_SIGNING_SECRET;
const adminUser = process.env.ISOLATED_ADMIN_USER || 'isoadmin';
const adminPassword = process.env.ISOLATED_ADMIN_PASSWORD;
const account = 'aaaaaaaaaaaaaaaa';
const other = 'bbbbbbbbbbbbbbbb';
const publicOrigin = 'https://ipa.mikephie.com';

if (!secret || !adminPassword) {
    console.error('missing isolated test env');
    process.exit(2);
}

function sign(resource, accountId, fileName, exp) {
    return crypto.createHmac('sha256', secret)
        .update([resource, accountId, fileName, String(exp)].join('\n'))
        .digest('base64url');
}

function request(method, urlPath, { headers = {}, body = null } = {}) {
    const url = new URL(urlPath, base);
    return new Promise((resolve, reject) => {
        const req = http.request(url, { method, headers }, (res) => {
            const chunks = [];
            res.on('data', (chunk) => chunks.push(chunk));
            res.on('end', () => resolve({
                status: res.statusCode,
                headers: res.headers,
                body: Buffer.concat(chunks),
            }));
        });
        req.on('error', reject);
        if (body) req.write(body);
        req.end();
    });
}

async function main() {
    const setupBody = JSON.stringify({ username: adminUser, password: adminPassword });
    const setup = await request('POST', '/v1/admin/setup', {
        headers: { 'content-type': 'application/json', 'content-length': Buffer.byteLength(setupBody) },
        body: setupBody,
    });
    if (setup.status !== 200 && setup.status !== 201) {
        throw new Error(`setup ${setup.status}`);
    }
    const login = await request('POST', '/v1/admin/login', {
        headers: { 'content-type': 'application/json', 'content-length': Buffer.byteLength(setupBody) },
        body: setupBody,
    });
    if (login.status !== 200) {
        throw new Error(`login ${login.status}`);
    }
    const setCookie = login.headers['set-cookie'];
    const cookie = String(Array.isArray(setCookie) ? setCookie[0] : setCookie || '').split(';')[0];
    if (!cookie.startsWith('authToken=')) {
        throw new Error('login cookie missing');
    }

    const linkBody = JSON.stringify({ appId: '123', versionId: '1', accountId: account });
    const unauth = await request('POST', '/v1/ipa/install-link', {
        headers: { 'content-type': 'application/json', 'content-length': Buffer.byteLength(linkBody) },
        body: linkBody,
    });
    if (unauth.status !== 401) throw new Error(`unauth ${unauth.status}`);

    const minted = await request('POST', '/v1/ipa/install-link', {
        headers: {
            'content-type': 'application/json',
            'content-length': Buffer.byteLength(linkBody),
            cookie: `${cookie}; ipaAppleAccount=${account}`,
            host: 'evil.example',
            'x-forwarded-host': 'evil.example',
        },
        body: linkBody,
    });
    if (minted.status !== 200) throw new Error(`mint ${minted.status}`);
    const mintedJson = JSON.parse(minted.body.toString('utf8'));
    const installUrl = mintedJson.data.installUrl;
    if (!installUrl.startsWith('itms-services://?action=download-manifest&url=')) {
        throw new Error('install url shape');
    }
    const manifestUrl = new URL(decodeURIComponent(new URL(installUrl).searchParams.get('url')));
    if (manifestUrl.origin !== publicOrigin) throw new Error('manifest origin');
    if (installUrl.includes('evil.example')) throw new Error('host poisoned install url');

    const manifestPath = `${manifestUrl.pathname}?${manifestUrl.searchParams.toString()}`;
    const manifest = await request('GET', manifestPath, {
        headers: { host: 'evil.example', 'x-forwarded-host': 'evil.example' },
    });
    if (manifest.status !== 200) throw new Error(`manifest ${manifest.status}`);
    const xml = manifest.body.toString('utf8');
    if (xml.includes('evil.example')) throw new Error('host poisoned manifest');
    const match = xml.match(/<key>url<\/key>\s*<string>([^<]+)<\/string>/);
    if (!match) throw new Error('ipa url missing');
    const ipaUrl = new URL(match[1].replaceAll('&amp;', '&'));
    if (ipaUrl.origin !== publicOrigin) throw new Error('ipa origin');
    const ipaPath = `${ipaUrl.pathname}?${ipaUrl.searchParams.toString()}`;

    const full = await request('GET', ipaPath);
    if (full.status !== 200) throw new Error(`download ${full.status}`);
    const expected = fs.readFileSync(process.env.ISOLATED_IPA_PATH);
    if (!full.body.equals(expected)) throw new Error('download bytes');

    const range = await request('GET', ipaPath, { headers: { range: 'bytes=0-15' } });
    if (range.status !== 206) throw new Error(`range ${range.status}`);
    if (!range.body.equals(expected.subarray(0, 16))) throw new Error('range bytes');
    const beyond = await request('GET', ipaPath, { headers: { range: `bytes=${expected.length}-` } });
    if (beyond.status !== 416) throw new Error(`beyond ${beyond.status}`);

    const past = Date.now() - 1000;
    const expiredPath = `/v1/ipa/getpackage/${account}/123_1.ipa?exp=${past}&sig=${encodeURIComponent(sign('ipa', account, '123_1.ipa', past))}`;
    const expired = await request('GET', expiredPath);
    if (expired.status !== 403) throw new Error(`expired ${expired.status}`);

    const exp = Date.now() + 1200;
    const slowPath = `/v1/ipa/getpackage/${account}/123_1.ipa?exp=${exp}&sig=${encodeURIComponent(sign('ipa', account, '123_1.ipa', exp))}`;
    const slowUrl = new URL(slowPath, base);
    const first = http.get(slowUrl, (res) => {
        if (res.statusCode !== 200) {
            console.error(`slow-start ${res.statusCode}`);
            process.exit(1);
        }
        res.pause();
    });
    await once(first, 'response');
    await new Promise((resolve) => setTimeout(resolve, 1600));
    const late = await request('GET', slowPath, { headers: { range: 'bytes=0-15' } });
    if (late.status !== 403) throw new Error(`late-range ${late.status}`);
    first.destroy();

    const crossed = await request('GET', `/v1/ipa/getpackage/${other}/123_1.ipa?${ipaUrl.searchParams.toString()}`);
    if (crossed.status !== 403) throw new Error(`cross ${crossed.status}`);
    const traversal = await request('GET', `/v1/ipa/getpackage/${account}/..%2F123_1.ipa?${ipaUrl.searchParams.toString()}`);
    if (![400, 403, 404].includes(traversal.status)) throw new Error(`traversal ${traversal.status}`);
    const linkTraversal = JSON.stringify({ file: '../123_1.ipa', accountId: account });
    const badMint = await request('POST', '/v1/ipa/install-link', {
        headers: {
            'content-type': 'application/json',
            'content-length': Buffer.byteLength(linkTraversal),
            cookie: `${cookie}; ipaAppleAccount=${account}`,
        },
        body: linkTraversal,
    });
    if (badMint.status !== 404) throw new Error(`traversal-mint ${badMint.status}`);
    for (const file of ['999_1.ipa', '888_1.ipa']) {
        const body = JSON.stringify({ file, accountId: account });
        const response = await request('POST', '/v1/ipa/install-link', {
            headers: {
                'content-type': 'application/json',
                'content-length': Buffer.byteLength(body),
                cookie: `${cookie}; ipaAppleAccount=${account}`,
            },
            body,
        });
        if (response.status !== 404) throw new Error(`symlink ${file} ${response.status}`);
    }

    const health = await request('GET', '/health');
    if (health.status !== 200 || !health.body.includes('"status":"ok"')) throw new Error('health');
    console.log('FULL_OTA_OK');
}

main().catch((error) => {
    console.error(error.message);
    process.exit(1);
});
