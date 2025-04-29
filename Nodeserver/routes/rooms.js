/**
 * rooms.js
 * API Routes for managing rooms (listing public rooms).
 */
'use strict';

const express = require('express');
const { getPublicRooms, getRoomDetails } = require('../controllers/roomController'); // Correct path
const { protectRoute } = require('../middleware/auth');

const router = express.Router();

// Get list of public rooms (includes name, description, online count)
// Requires authentication to view rooms.
router.get('/', protectRoute, getPublicRooms);

// Get details for a specific room (e.g., description, owner, members if applicable)
// NOTE: This route is a placeholder and not fully implemented in the controller.
// Requires robust permission checks (public vs private vs DM).
// router.get('/:roomIdOrName', protectRoute, getRoomDetails);


module.exports = router;