/**
 * auth.js
 * Routes for user authentication (register, login, logout, password reset, me).
 */
'use strict';

const express = require('express');
const { body } = require('express-validator');
const {
    registerUser,
    loginUser,
    logoutUser, // Still mostly client-side for JWT, but route exists
    getMe,
    forgotPassword,
    resetPassword,
    updatePassword // For logged-in users changing their own password
} = require('../controllers/authController'); // Correct path to controllers
const { protectRoute } = require('../middleware/auth');
const validateRequest = require('../middleware/validateRequest');

const router = express.Router();

// --- Registration ---
router.post('/register', validateRequest([
    body('username')
        .trim()
        .notEmpty().withMessage('Username is required.')
        .isLength({ min: 3, max: 20 }).withMessage('Username must be between 3 and 20 characters.')
        .matches(/^[a-zA-Z0-9_-]+$/).withMessage('Username can only contain letters, numbers, underscores, and hyphens.'),
    body('email')
        .trim()
        .notEmpty().withMessage('Email is required.')
        .isEmail().withMessage('Please provide a valid email address.')
        .normalizeEmail(), // Converts to lowercase
    body('password')
        .notEmpty().withMessage('Password is required.')
        .isLength({ min: 6 }).withMessage('Password must be at least 6 characters long.')
]), registerUser);

// --- Login ---
router.post('/login', validateRequest([
    body('email')
        .trim()
        .notEmpty().withMessage('Email is required.')
        .isEmail().withMessage('Please provide a valid email address.')
        .normalizeEmail(),
    body('password')
        .notEmpty().withMessage('Password is required.')
]), loginUser);

// --- Logout ---
// For pure JWT, logout is typically handled client-side by deleting the token.
// A server route might be needed for session invalidation or token blacklisting (not implemented here).
router.post('/logout', protectRoute, logoutUser); // Requires auth to potentially blacklist token if needed

// --- Get Current User ---
// Client uses this to verify token validity on page load and get initial user data.
router.get('/me', protectRoute, getMe);

// --- Password Management ---
router.post('/forgotpassword', validateRequest([
    body('email')
        .trim()
        .notEmpty().withMessage('Email is required.')
        .isEmail().withMessage('Please provide a valid email address.')
        .normalizeEmail()
]), forgotPassword);

// Note: resettoken comes from URL param, password from body
router.put('/resetpassword/:resettoken', validateRequest([
     body('password')
        .notEmpty().withMessage('New password is required.')
        .isLength({ min: 6 }).withMessage('Password must be at least 6 characters long.')
]), resetPassword);

// Optional: Allow logged-in user to update their own password
router.put('/updatepassword', protectRoute, validateRequest([
     body('currentPassword')
        .notEmpty().withMessage('Current password is required.'),
     body('newPassword')
        .notEmpty().withMessage('New password is required.')
        .isLength({ min: 6 }).withMessage('New password must be at least 6 characters long.')
]), updatePassword);


module.exports = router;