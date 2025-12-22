// routes/capturas.routes.js
const express = require('express');
const router = express.Router();
const capturasController = require('../controllers/capturas.controller');

router.post('/iniciar', capturasController.iniciarCapturas);
router.post("/iniciar-sync", capturasController.iniciarCapturasSync);

module.exports = router;