/**
 * users.js
 * API Routes for user-related actions (profiles, avatars).
 */
'use strict';

const express = require('express');
const {
    getUserProfile,
    updateUserProfile, // Only allows updating specific fields like statusMessage
    uploadUserAvatar
} = require('../controllers/userController'); // Correct path
const { protectRoute } = require('../middleware/auth');
const { upload, handleUploadError } = require('../config/storage'); // Multer instance and error handler
const validateRequest = require('../middleware/validateRequest');
const { body } = require('express-validator');


const router = express.Router();

// Get profile of any user by ID
// Requires authentication to access user profiles.
router.get('/:userId', protectRoute, getUserProfile);

// Update logged-in user's profile details (currently only status message)
// Uses protectRoute to identify the user via req.user.id
router.put('/me', protectRoute, validateRequest([
    // Validate only the fields allowed for update via this route
    body('statusMessage')
      .optional({ checkFalsy: true }) // Allow empty string '' to clear status, but treat null/undefined as optional
      .trim()
      .isLength({ max: 60 }).withMessage('Status message cannot exceed 60 characters.')
]), updateUserProfile);

// Upload avatar for the logged-in user
// 1. protectRoute: Ensure user is logged in, attach req.user
// 2. upload.single('avatar'): Handle single file upload with field name 'avatar', place file in req.file
// 3. handleUploadError: Catch errors from Multer (size, type)
// 4. uploadUserAvatar: Controller logic to save file path to user model
// 'avatar' must match the name attribute of the file input field in the HTML form (<input type="file" name="avatar">)
router.post(
    '/me/avatar',
    protectRoute,
    upload.single('avatar'), // Process the upload first
    handleUploadError,      // Handle any Multer errors
    uploadUserAvatar        // If upload ok, run controller
);


module.exports = router;