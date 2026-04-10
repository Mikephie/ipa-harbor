const express = require('express');
const router = express.Router();
const { authenticateToken } = require('../../middleware/auth');
const { attachAppleAccount, requireAppleAccount } = require('../../middleware/appleAccount');

const searchHandler = require('./search.js');
const purchaseHandler = require('./purchase.js');
const { versionsHandler } = require('./versions.js');
const downloadHandler = require('./download.js');
const detailsHandler = require('./details.js');
const { getAppIcon, getAppIconUrl } = require('./icon.js');

router.use(attachAppleAccount);

router.get('/search', authenticateToken, requireAppleAccount, searchHandler);
router.get('/icon/:appid', getAppIcon); // 获取图标，不需要管理员认证
router.get('/icon-url/:appid/:size', getAppIconUrl); // 获取图标URL，不需要管理员认证
router.post('/details', authenticateToken, requireAppleAccount, detailsHandler);
router.post('/:bundleId/purchase', authenticateToken, requireAppleAccount, purchaseHandler);
router.post('/:appId/versions', authenticateToken, requireAppleAccount, versionsHandler);
router.post('/:appId/:versionId', authenticateToken, requireAppleAccount, downloadHandler);

module.exports = router;
