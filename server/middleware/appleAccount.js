const { readAppleAccountIdFromRequest } = require('../utils/appleAccount');

function attachAppleAccount(req, res, next) {
    req.appleAccountId = readAppleAccountIdFromRequest(req);
    next();
}

function requireAppleAccount(req, res, next) {
    const id = readAppleAccountIdFromRequest(req);
    if (!id) {
        return res.status(401).json({
            success: false,
            message: '请先登录 Apple 账号',
            error: 'Apple account session required',
        });
    }
    req.appleAccountId = id;
    next();
}

module.exports = {
    attachAppleAccount,
    requireAppleAccount,
};
