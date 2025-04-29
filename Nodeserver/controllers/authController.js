/**
 * authController.js
 * Controllers for authentication routes.
 */
'use strict';

const crypto = require('crypto');
const User = require('../models/User');
const generateToken = require('../utils/generateToken');
const { sendMail, isConfigured: isMailerConfigured } = require('../config/mailer');
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });

const CLIENT_URL = process.env.CLIENT_URL || 'http://localhost:8000'; // Fallback URL for reset links

// Error handling utility
class AppError extends Error {
    constructor(message, statusCode) {
        super(message);
        this.statusCode = statusCode;
        this.isOperational = true; // Flag for operational errors
        Error.captureStackTrace(this, this.constructor);
    }
}


// @desc    Register a new user
// @route   POST /api/auth/register
// @access  Public
const registerUser = async (req, res, next) => {
    const { username, email, password } = req.body;

    try {
        // Check if email already exists (case-insensitive due to model's lowercase: true)
        const emailExists = await User.findOne({ email: email }); // Mongoose handles lowercase
        if (emailExists) {
            // Use AppError for consistent handling
            return next(new AppError('Email address is already registered.', 400));
        }

        // Check if username already exists (case-insensitive via static method)
        const usernameExists = await User.findByUsernameCaseInsensitive(username);
        if (usernameExists) {
            return next(new AppError('Username is already taken.', 400));
        }

        // Create user (password hashing is handled by Mongoose pre-save hook in User model)
        const user = await User.create({
            username,
            email, // Email already normalized by validator
            password,
            status: 'offline' // Initial status
        });

        // User created successfully
        const token = generateToken(user._id);
        console.log(`User registered: ${user.username} (ID: ${user._id})`);

        // Prepare user data to send back (exclude sensitive fields)
        const userData = {
             id: user._id,
             username: user.username,
             email: user.email,
             avatarUrl: user.avatarUrl,
             status: user.status,
             statusMessage: user.statusMessage,
             createdAt: user.createdAt,
             lastSeen: user.lastSeen
         };

        res.status(201).json({
            success: true,
            token: token,
            user: userData
        });

    } catch (error) {
         // Pass other errors (like DB connection issues, unexpected errors) to central handler
         console.error("Registration Error:", error);
         next(error);
    }
};

// @desc    Authenticate user & get token
// @route   POST /api/auth/login
// @access  Public
const loginUser = async (req, res, next) => {
    const { email, password } = req.body; // Email already normalized by validator

    try {
        // Find user by email, explicitly select password for comparison
        const user = await User.findOne({ email: email }).select('+password');

        if (!user) {
            // User not found
            return next(new AppError('Invalid email or password.', 401)); // Use generic message
        }

        // Check if password matches using the instance method
        const isMatch = await user.matchPassword(password);

        if (!isMatch) {
            // Password doesn't match
            return next(new AppError('Invalid email or password.', 401)); // Use generic message
        }

        // --- Login successful ---
        const token = generateToken(user._id);
        console.log(`User logged in: ${user.username} (ID: ${user._id})`);

        // Update lastSeen on login (status update handled by socket connection)
        user.lastSeen = new Date();
        // Avoid validation errors if only updating lastSeen
        await user.save({ validateBeforeSave: false });

        // Prepare user data to send back (exclude sensitive fields)
        const userData = {
              id: user._id,
              username: user.username,
              email: user.email,
              avatarUrl: user.avatarUrl,
              status: user.status, // Send current status from DB
              statusMessage: user.statusMessage,
              createdAt: user.createdAt,
              lastSeen: user.lastSeen
          };

        res.status(200).json({
             success: true,
             token: token,
             user: userData
        });

    } catch (error) {
        console.error("Login Error:", error);
        next(error);
    }
};

// @desc    Get current logged-in user profile
// @route   GET /api/auth/me
// @access  Private (requires valid token via protectRoute)
const getMe = async (req, res, next) => {
     // protectRoute middleware attaches req.user (excluding password/reset fields)
    // We trust protectRoute to handle token validation and user fetching.
    // If req.user exists here, the token was valid and the user was found.
    // The user data is already selected appropriately by protectRoute.
    res.status(200).json({ success: true, user: req.user });
};


// @desc    Forgot password - Generate token & send email
// @route   POST /api/auth/forgotpassword
// @access  Public
const forgotPassword = async (req, res, next) => {
    const { email } = req.body; // Email already normalized by validator

     // Check if email service is configured before proceeding
     if (!isMailerConfigured()) {
          console.error("Forgot Password attempt failed: Email service not configured.");
          return next(new AppError('Password reset service is temporarily unavailable.', 503)); // Service Unavailable
     }

    try {
        const user = await User.findOne({ email: email });

        if (!user) {
             // SECURITY: Do *not* reveal if the email exists. Send success response regardless.
             console.warn(`Password reset requested for non-existent or unverified email: ${email}`);
             // Send the same success message to prevent email enumeration attacks
             return res.status(200).json({ success: true, message: 'If an account with that email exists, a password reset link has been sent.' });
        }

        // Generate the reset token (instance method hashes and saves token/expiry)
        const resetToken = user.generatePasswordResetToken();
        await user.save({ validateBeforeSave: false }); // Save token fields, skip full validation

        // Create reset URL (client handles the /reset-password route + token parameter)
        const resetUrl = `${CLIENT_URL}/reset-password?token=${resetToken}`;

        // Create email message content
        const message = `
            <html><body>
            <h2>Password Reset Request</h2>
            <p>You are receiving this email because a password reset was requested for your account associated with ${user.email}.</p>
            <p>Please click on the following link to complete the process:</p>
            <p><a href="${resetUrl}" target="_blank" style="color: #ffffff; background-color: #6c63ff; padding: 10px 15px; text-decoration: none; border-radius: 5px; display: inline-block;">Reset Your Password</a></p>
            <p>Or paste this URL into your browser:</p>
            <p><a href="${resetUrl}" target="_blank">${resetUrl}</a></p>
            <p>This link will expire in 10 minutes.</p>
            <hr>
            <p>If you did not request this password reset, please ignore this email. Your password will remain unchanged.</p>
            </body></html>
        `;

        try {
            // Send the email using the configured mailer
            await sendMail({
                to: user.email,
                subject: 'ChatApp Password Reset Request',
                html: message,
                text: `To reset your password, visit this URL (expires in 10 mins): ${resetUrl}` // Plain text fallback
            });

            console.log(`Password reset email successfully sent to ${user.email}`);
            res.status(200).json({ success: true, message: 'Password reset link has been sent to your email.' });

        } catch (emailError) {
            console.error('Error sending password reset email:', emailError);
            // IMPORTANT: Clear the generated token fields if email sending fails,
            // otherwise the user has an unusable token saved in their profile.
            user.resetPasswordToken = undefined;
            user.resetPasswordExpire = undefined;
            try {
                 await user.save({ validateBeforeSave: false });
            } catch (saveError) {
                 console.error("Failed to clear reset token after email error:", saveError);
                 // Log this, but the primary issue is the email failure.
            }
            // Pass a user-friendly error to the central handler
            return next(new AppError('Failed to send password reset email. Please try again later.', 500));
        }

    } catch (error) {
        console.error("Forgot Password Error:", error);
        next(error); // Pass DB errors or other unexpected issues
    }
};

// @desc    Reset password using token from URL parameter
// @route   PUT /api/auth/resetpassword/:resettoken
// @access  Public
const resetPassword = async (req, res, next) => {
    const { resettoken } = req.params; // Token from URL
    const { password } = req.body; // New password from request body

    if (!resettoken || !password) {
        return next(new AppError('Missing required information for password reset.', 400));
    }

    try {
        // Hash the incoming token from the URL to match the hashed token stored in DB
        const hashedToken = crypto
            .createHash('sha256')
            .update(resettoken)
            .digest('hex');

        // Find user by the *hashed* token and check if the token hasn't expired
        const user = await User.findOne({
            resetPasswordToken: hashedToken,
            resetPasswordExpire: { $gt: Date.now() } // Check expiry ($gt ensures it's still valid)
        }); // Password is not needed here, default select is fine

        if (!user) {
            // Token is invalid, not found, or expired
            return next(new AppError('Invalid or expired password reset token.', 400));
        }

        // --- Token is valid, proceed to reset password ---
        // Set the new password (pre-save hook in User model will hash it)
        user.password = password;
        // Clear the reset token fields so it can't be used again
        user.resetPasswordToken = undefined;
        user.resetPasswordExpire = undefined;

        // Save the user document (triggers hashing and clears token fields)
        await user.save(); // Runs full validation, including password length check

        console.log(`Password reset successful for user: ${user.username}`);

        // Respond to client - Do not automatically log in for security.
        res.status(200).json({
             success: true,
             message: 'Password has been reset successfully. You can now log in with your new password.'
         });

    } catch (error) {
        console.error("Reset Password Error:", error);
        // Handle potential validation errors from user.save() if password too short etc.
        if (error.name === 'ValidationError') {
             return next(new AppError(`Validation failed: ${error.message}`, 400));
        }
        next(error); // Handle other errors (DB connection etc.)
    }
};


// @desc    Update password for a currently logged-in user
// @route   PUT /api/auth/updatepassword
// @access  Private (requires valid token via protectRoute)
const updatePassword = async (req, res, next) => {
     const { currentPassword, newPassword } = req.body;
     const userId = req.user.id; // User ID is reliably obtained from protectRoute middleware

     if (!currentPassword || !newPassword) {
           return next(new AppError('Both current and new passwords are required.', 400));
     }
      if (currentPassword === newPassword) {
           return next(new AppError('New password cannot be the same as the current password.', 400));
      }

     try {
          // Find user and explicitly select the password field for comparison
          const user = await User.findById(userId).select('+password');

          if (!user) {
               // Should not happen if protectRoute worked, but good safety check
               return next(new AppError('User not found.', 404));
          }

          // Check if the provided current password matches the one in the database
          const isMatch = await user.matchPassword(currentPassword);
          if (!isMatch) {
               return next(new AppError('Incorrect current password.', 401)); // Unauthorized (wrong current pw)
          }

          // --- Current password is correct, proceed to update ---
          // Set the new password (pre-save hook will hash it)
          user.password = newPassword;
          await user.save(); // Runs validation (e.g., min length) and hashes password

          console.log(`Password updated successfully for user: ${user.username}`);

          // Respond success - Do not send back a new token unless necessary for your security model
          res.status(200).json({ success: true, message: 'Password updated successfully.' });

     } catch (error) {
          console.error("Update Password Error:", error);
          // Handle potential validation errors from user.save()
           if (error.name === 'ValidationError') {
                return next(new AppError(`Validation failed: ${error.message}`, 400));
           }
          next(error);
     }
};


// @desc    Logout User
// @route   POST /api/auth/logout
// @access  Private
const logoutUser = (req, res, next) => {
     // For stateless JWT authentication, logout is primarily a client-side action
     // where the client discards the token.
     // Server-side action is only needed if implementing:
     // 1. Session-based auth: req.session.destroy(...)
     // 2. Token Blacklisting: Add the JWT ID (jti claim) or the full token to a blacklist (e.g., in Redis)
     //    with an expiry matching the token's original expiry. This prevents reuse of the token until it naturally expires.

     // Since we are using simple JWT without blacklisting:
     console.log(`User logged out (client-side token removal): ${req.user.username} (ID: ${req.user.id})`);
     res.status(200).json({ success: true, message: 'Logout successful (token invalidated client-side).' });
};


module.exports = {
    registerUser,
    loginUser,
    logoutUser,
    getMe,
    forgotPassword,
    resetPassword,
    updatePassword
};