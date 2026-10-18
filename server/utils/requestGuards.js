const JWT_SHAPE = /^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/;

function readPresentedToken(req) {
    const authorization = String(req?.headers?.authorization || '');
    const bearer = authorization.replace(/^Bearer\s+/i, '').trim();
    const candidates = [
        req?.cookies?.authToken,
        req?.headers?.['x-auth-token'],
        bearer,
    ];

    for (const value of candidates) {
        const token = String(value || '').trim();
        if (JWT_SHAPE.test(token)) {
            return token;
        }
    }

    return '';
}

function wantsStoreSession(req) {
    const header = String(req?.headers?.['x-export-store-session'] || '').trim();
    return header === '1' || header.toLowerCase() === 'true';
}

function canExportStoreSession(req) {
    return Boolean(req?.user) && wantsStoreSession(req);
}

module.exports = {
    readPresentedToken,
    wantsStoreSession,
    canExportStoreSession,
};
