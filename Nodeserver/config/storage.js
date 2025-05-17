/**
 * storage.js
 * Configures Multer for file uploads (e.g., avatars).
 */
'use strict';

const multer = require('multer');
const path = require('path');
const fs = require('fs');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });

const UPLOAD_DIR_CONFIG = process.env.UPLOAD_DIR; // Path relative to index.js from .env
const MAX_FILE_SIZE = parseInt(process.env.MAX_FILE_SIZE || '1048576', 10); // Default 1MB

// Resolve the absolute path for the upload directory based on the location of index.js
const resolvedUploadDir = path.resolve(__dirname, '..', UPLOAD_DIR_CONFIG || '../uploads/avatars');

// Ensure upload directory exists
if (!fs.existsSync(resolvedUploadDir)) {
    try {
        fs.mkdirSync(resolvedUploadDir, { recursive: true });
        console.log(`✅ Created upload directory: ${resolvedUploadDir}`);
    } catch (err) {
        console.error(`❌ FATAL: Failed to create upload directory: ${resolvedUploadDir}`, err);
        console.error("   Ensure the parent directory exists and the process has write permissions.");
        process.exit(1); // Exit if upload dir cannot be created
    }
} else {
     console.log(`ℹ️ Using upload directory: ${resolvedUploadDir}`);
}


// --- Multer Storage Configuration ---
const storage = multer.diskStorage({
    destination: function (req, file, cb) {
        cb(null, resolvedUploadDir); // Use the resolved absolute path
    },
    filename: function (req, file, cb) {
        // Generate unique filename: user-<userId>-<timestamp>.<original_extension>
        // Ensure req.user is available (add auth middleware before this route)
        const userId = req.user ? req.user.id : 'unknown'; // Safety check for userId
        const uniqueSuffix = `${userId}-${Date.now()}`;
        const extension = path.extname(file.originalname).toLowerCase(); // Ensure lowercase extension
        cb(null, `user-${uniqueSuffix}${extension}`);
    }
});

// --- Multer File Filter ---
const fileFilter = (req, file, cb) => {
    // Accept only image files
    const allowedMimes = ['image/jpeg', 'image/png', 'image/gif', 'image/webp'];
    const allowedExts = ['.jpg', '.jpeg', '.png', '.gif', '.webp'];

    const fileMime = file.mimetype;
    const fileExt = path.extname(file.originalname).toLowerCase();

    if (allowedMimes.includes(fileMime) && allowedExts.includes(fileExt)) {
        cb(null, true); // Accept file
    } else {
        // Reject file - Create a specific error type for the handler
        const error = new Error('Invalid file type. Only JPG, PNG, GIF, WEBP allowed.');
        error.code = 'INVALID_FILE_TYPE';
        cb(error, false);
    }
};

// --- Multer Upload Instance ---
const upload = multer({
    storage: storage,
    limits: {
        fileSize: MAX_FILE_SIZE
    },
    fileFilter: fileFilter
});

// --- Multer Error Handling Middleware (for routes using upload) ---
// This middleware should be used *after* upload.single() or upload.array() in the route definition
const handleUploadError = (err, req, res, next) => {
    if (err instanceof multer.MulterError) {
        // A Multer error occurred (e.g., file too large)
        console.warn("Multer upload error:", err.code);
        let message = 'File upload error.';
        if (err.code === 'LIMIT_FILE_SIZE') {
             message = `File too large. Maximum size is ${MAX_FILE_SIZE / 1024 / 1024}MB.`;
        }
         return res.status(400).json({ success: false, error: message });
    } else if (err && err.code === 'INVALID_FILE_TYPE') {
         // Custom error from our fileFilter
         console.warn("Multer upload error:", err.message);
         return res.status(400).json({ success: false, error: err.message });
    } else if (err) {
        // An unknown error occurred when uploading. Pass to general error handler.
        return next(err);
    }
    // If no error, proceed
    next();
};


module.exports = { upload, handleUploadError, resolvedUploadDir };