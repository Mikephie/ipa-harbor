const express = require('express');
const router = express.Router();

const loginHandler = require('./login');
const infoHandler = require('./info');
const revokeHandler = require('./revoke');
const regionHandler = require('./region');
const accountsListHandler = require('./accountsList');
const switchAccountHandler = require('./switchAccount');
const removeAccountHandler = require('./removeAccount');

router.post('/login', loginHandler);
router.post('/info', infoHandler);
router.post('/revoke', revokeHandler);
router.post('/region', regionHandler);
router.get('/accounts', accountsListHandler);
router.post('/switch', switchAccountHandler);
router.post('/account/remove', removeAccountHandler);

module.exports = router;
