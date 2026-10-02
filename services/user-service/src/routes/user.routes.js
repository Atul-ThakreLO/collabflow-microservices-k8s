const express = require('express');
const router = express.Router();
const userController = require('../controllers/user.controller');

// Internal note: API Gateway injects x-user-id and x-user-role headers after verifying JWT
router.get('/me', userController.getMyProfile);
router.put('/me', userController.updateMyProfile);
router.get('/stats', userController.getTeamStats);
router.get('/:id', userController.getUserById);
router.get('/', userController.listUsers);

module.exports = router;
