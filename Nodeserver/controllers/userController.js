/**
 * userController.js
 * Controllers for user-related API routes (profiles, avatars).
 */
'use strict';

const User = require('../models/User');
const fs = require('fs').promises; // Use promise-based fs for async cleanup
const path = require('path');
const { resolvedUploadDir } = require('../config/storage'); // Get the absolute upload dir path
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });

const UPLOAD_ROUTE = process.env.UPLOAD_ROUTE || '/uploads/avatars'; // URL path for avatars

// Error handling utility
class AppError extends Error {
    constructor(message, statusCode) {
        super(message);
        this.statusCode = statusCode;
        this.isOperational = true;
        Error.captureStackTrace(this, this.constructor);
    }
}


// @desc    Get user profile by ID
// @route   GET /api/users/:userId
// @access  Private (requires login)
const getUserProfile = async (req, res, next) => {
    const requestedUserId = req.params.userId;
    // Optional: Add check if req.user.id === requestedUserId for 'self' profile indication

    try {
        // Find user by ID, exclude sensitive fields explicitly
        const user = await User.findById(requestedUserId)
            .select('-password -resetPasswordToken -resetPasswordExpire');

        if (!user) {
            return next(new AppError('User not found.', 404));
        }

        res.status(200).json({ success: true, user });
    } catch (error) {
        // Handle CastError specifically if userId has invalid format
        if (error.name === 'CastError') {
             return next(new AppError('User not found (invalid ID format).', 404));
        }
        console.error("Get User Profile Error:", error);
        next(error); // Pass other errors to central handler
    }
};

// @desc    Update logged-in user's profile details (currently only statusMessage)
// @route   PUT /api/users/me
// @access  Private (uses req.user from protectRoute)
const updateUserProfile = async (req, res, next) => {
     const userId = req.user.id; // ID of the logged-in user making the request
     // Extract only allowed fields from body (prevent unwanted updates)
     const { statusMessage } = req.body;

     // Build update object selectively
     const fieldsToUpdate = {};
     if (statusMessage !== undefined) { // Allow setting empty string '', but ignore if field absent
          // Validation (length) already done by express-validator middleware
          fieldsToUpdate.statusMessage = statusMessage;
     }
     // Add other updatable fields here in the future, e.g.:
     // if (req.body.displayName !== undefined) fieldsToUpdate.displayName = req.body.displayName;

     // Check if there's anything actually to update
     if (Object.keys(fieldsToUpdate).length === 0) {
          return res.status(200).json({ success: true, user: req.user, message: "No profile fields provided for update." }); // Return current user data
     }

     try {
          // Find user and update specified fields, return the updated document
          const updatedUser = await User.findByIdAndUpdate(
               userId,
               { $set: fieldsToUpdate },
               {
                    new: true, // Return the modified document rather than the original
                    runValidators: true, // Ensure schema validation rules are applied to updates
                    select: '-password -resetPasswordToken -resetPasswordExpire' // Exclude sensitive fields
                }
          );

          if (!updatedUser) {
               return next(new AppError('User not found.', 404));
          }

          console.log(`Profile updated for user: ${updatedUser.username}`);
          res.status(200).json({ success: true, user: updatedUser });

     } catch (error) {
          console.error("Update User Profile Error:", error);
           // Handle potential validation errors during update
           if (error.name === 'ValidationError') {
                return next(new AppError(`Validation failed: ${error.message}`, 400));
           }
          next(error);
     }
};


// @desc    Upload avatar for logged-in user
// @route   POST /api/users/me/avatar
// @access  Private (uses req.user from protectRoute, file from multer)
const uploadUserAvatar = async (req, res, next) => {
    const userId = req.user.id;

    // Multer middleware (upload.single) should have run before this.
    // Multer error handler middleware should have caught Multer-specific errors.
    // We just need to check if req.file exists.
    if (!req.file) {
        // This might happen if the file filter rejected the file type but handleUploadError didn't catch it,
        // or if no file was sent with the 'avatar' field name.
        return next(new AppError('No valid avatar file uploaded or incorrect field name used.', 400));
    }

    const newFileName = req.file.filename; // Unique filename from Multer config
    const newFilePath = req.file.path; // Full temporary path where Multer saved the file
    const newAvatarUrl = `${UPLOAD_ROUTE}/${newFileName}`; // Publicly accessible URL path

    console.log(`Processing avatar upload for ${req.user.username}. New file: ${newFileName}`);

    try {
        // Find the user to update their avatarUrl
        const user = await User.findById(userId);
        if (!user) {
            // If user doesn't exist (edge case), clean up the uploaded file
            console.warn(`User ${userId} not found after avatar upload. Deleting orphan file: ${newFilePath}`);
            await fs.unlink(newFilePath).catch(err => console.error("Error deleting orphan upload:", err));
            return next(new AppError('User not found.', 404));
        }

        const oldAvatarUrl = user.avatarUrl; // Get the URL of the previous avatar

        // --- Delete Old Avatar File (if not the default) ---
        const defaultAvatarPath = `${UPLOAD_ROUTE}/default.png`;
        if (oldAvatarUrl && oldAvatarUrl !== defaultAvatarPath) {
             try {
                  // Construct the absolute filesystem path from the relative URL path
                  const oldFileName = path.basename(oldAvatarUrl); // Extract filename from URL
                  const oldFilePath = path.join(resolvedUploadDir, oldFileName); // Get absolute path

                  console.log(`   Attempting to delete old avatar file: ${oldFilePath}`);
                  await fs.unlink(oldFilePath);
                  console.log(`   ✅ Deleted old avatar: ${oldFilePath}`);
             } catch (err) {
                  // Log error if deletion fails, but don't block the update process.
                  // ENOENT means file didn't exist, which is fine.
                  if (err.code !== 'ENOENT') {
                       console.error(`   ⚠️ Error deleting old avatar ${oldAvatarUrl}:`, err.message);
                  } else {
                       console.log(`   ℹ️ Old avatar file not found (already deleted?): ${oldAvatarUrl}`);
                  }
             }
        }
        // --- End Old Avatar Deletion ---

        // Update user's avatarUrl in the database
        user.avatarUrl = newAvatarUrl;
        await user.save();

        console.log(`✅ Avatar updated successfully for ${user.username} to ${newAvatarUrl}`);

        // Respond with success and the new URL
        res.status(200).json({
            success: true,
            message: "Avatar uploaded successfully.",
            avatarUrl: newAvatarUrl
        });

        // TODO: Broadcast presence update with new avatar URL?
        // Requires access to broadcast function. Pass it or emit event?
        // broadcastPresenceUpdate(io, state, userId, { avatarUrl: newAvatarUrl });


    } catch (error) {
         // If any error occurs AFTER upload but BEFORE/DURING DB save, delete the newly uploaded file
         console.error("Error saving user avatar URL or during old file cleanup:", error);
         console.warn(`   Attempting to delete recently uploaded file due to error: ${newFilePath}`);
         await fs.unlink(newFilePath).catch(unlinkErr => console.error("   Error deleting upload after DB save failure:", unlinkErr));
         next(error); // Pass error to central handler
    }
};


module.exports = {
    getUserProfile,
    updateUserProfile,
    uploadUserAvatar
};