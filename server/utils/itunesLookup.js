const https = require('https');

function makeHttpsRequest(url) {
    return new Promise((resolve, reject) => {
        const request = https.get(url, (response) => {
            let data = '';
            response.on('data', (chunk) => {
                data += chunk;
            });
            response.on('end', () => {
                if (response.statusCode === 200) {
                    resolve(data);
                } else {
                    reject(new Error(`HTTP ${response.statusCode}: ${response.statusMessage}`));
                }
            });
        });

        request.on('error', (error) => {
            reject(error);
        });

        request.setTimeout(10000, () => {
            request.destroy();
            reject(new Error('请求超时'));
        });
    });
}

function buildLookupUrl(ids, country, lang) {
    const idList = ids.map(String).join(',');
    const query = `id=${idList}${lang ? `&lang=${encodeURIComponent(lang)}` : ''}`;
    if (country) {
        return `https://itunes.apple.com/${country}/lookup?${query}`;
    }
    return `https://itunes.apple.com/lookup?${query}`;
}

async function lookupApps(ids, { country, lang } = {}) {
    if (!ids?.length) {
        return [];
    }
    const raw = await makeHttpsRequest(buildLookupUrl(ids, country, lang));
    const data = JSON.parse(raw);
    return Array.isArray(data.results) ? data.results : [];
}

/**
 * iTunes 无国家码时默认美区。ipatool 搜索用的是账号商店，国区 App 在美区 lookup 会变成 0 条，
 * 批量查询时只剩下 Apple Music 这类全球应用，前端再按 index 0 打开就会点错。
 */
async function lookupAppsWithFallback(ids, { preferredCountry, lang = 'zh-CN' } = {}) {
    const wanted = [...new Set((ids || []).map(String))];
    const countries = [];
    if (preferredCountry) {
        countries.push(String(preferredCountry).toLowerCase());
    }
    countries.push('cn', 'us', null);

    const seenCountry = new Set();
    const byId = new Map();

    for (const country of countries) {
        const key = country || '_default';
        if (seenCountry.has(key)) {
            continue;
        }
        seenCountry.add(key);

        try {
            const results = await lookupApps(wanted, { country, lang });
            for (const app of results) {
                const id = String(app.trackId || '');
                if (id && !byId.has(id)) {
                    byId.set(id, app);
                }
            }
        } catch (_) {
            /* 尝试下一个商店 */
        }

        if (wanted.every((id) => byId.has(id))) {
            break;
        }
    }

    return wanted.map((id) => byId.get(id)).filter(Boolean);
}

module.exports = {
    lookupApps,
    lookupAppsWithFallback,
};
