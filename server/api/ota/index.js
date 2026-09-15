const express = require('express');
const router = express.Router();
const genPlistHandler = require('./genPlist');

router.get('/genPlist', genPlistHandler);

module.exports = router;
