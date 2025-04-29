/**
       * User.js
       * Mongoose schema and model for users (Enhanced with indexes and methods).
       */
'use strict';

const mongoose = require('mongoose');
const bcrypt = require('bcrypt');
const crypto = require('crypto'); // For password reset token
const { Schema } = mongoose;

const userSchema = new Schema({
    username: {
        type: String,
        required: [true, 'Username is required.'],
        unique: true, // Creates a unique index
        trim: true,
        minlength: [3, 'Username must be at least 3 characters.'],
        maxlength: [20, 'Username cannot exceed 20 characters.'],
        // Simple regex: letters, numbers, underscore, hyphen
        match: [/^[a-zA-Z0-9_-]+$/, 'Username can only contain letters, numbers, underscores, and hyphens.'],
        // Consider collation for case-insensitive unique index if needed by DB:
        // collation: { locale: 'en', strength: 2 } // strength 2 = case-insensitive
    },
    email: {
        type: String,
        required: [true, 'Email is required.'],
        unique: true, // Creates a unique index
        trim: true,
        lowercase: true, // Store email in lowercase for consistent lookups
        match: [/^\w+([.-]?\w+)*@\w+([.-]?\w+)*(\.\w{2,3})+$/, 'Please provide a valid email address.']
    },
    password: {
        type: String,
        required: [true, 'Password is required.'],
        minlength: [6, 'Password must be at least 6 characters long.'],
        select: false // *** IMPORTANT: Exclude password field by default in queries ***
    },
    avatarUrl: {
        type: String,
        // Use the default route configured in .env or fallback
        default: `${process.env.UPLOAD_ROUTE || '/uploads/avatars'}/default.png`
    },
    status: {
        type: String,
        enum: ['online', 'away', 'dnd', 'offline'],
        default: 'offline',
        index: true // Index status for potentially filtering online users (though less efficient than a dedicated system)
    },
    statusMessage: { // Optional custom status text
        type: String,
        trim: true,
        maxlength: [60, 'Status message cannot exceed 60 characters.'],
        default: ''
    },
    resetPasswordToken: {
        type: String,
        select: false // Exclude by default
    },
    resetPasswordExpire: {
        type: Date,
        select: false // Exclude by default
    },
    lastSeen: {
        type: Date,
        default: Date.now,
        index: true // Index for potential sorting or filtering
    }
}, {
     // Add timestamps (createdAt, updatedAt)
     timestamps: true,
     // Optional: Specify collection name
     // collection: 'users'
});

// --- Indexes ---
// Ensure unique indexes are created (already defined by `unique: true` above)
// Index for case-insensitive username lookup (if not using collation)
// userSchema.index({ username: 1 }, { unique: true, collation: { locale: 'en', strength: 2 } }); // Preferred way
// userSchema.index({ email: 1 }, { unique: true }); // Already created

// --- Mongoose Hooks (Middleware) ---

// Hash password BEFORE saving a user document (only if password modified)
userSchema.pre('save', async function (next) {
    // 'this' refers to the document being saved
    if (!this.isModified('password')) {
        // Skip hashing if password wasn't changed
        return next();
    }

    try {
        // Generate salt (cost factor 10 is generally recommended)
        const salt = await bcrypt.genSalt(10);
        // Hash the password with the salt
        this.password = await bcrypt.hash(this.password, salt);
        next(); // Proceed with saving
    } catch (error) {
        next(error); // Pass error to Mongoose error handling
    }
});

// --- Instance Methods ---
// Methods available on individual user documents (e.g., user.matchPassword())

/**
 * Compare entered password with the hashed password in the database.
 * @param {string} enteredPassword - The password attempt from user login.
 * @returns {Promise<boolean>} - True if passwords match, false otherwise.
 */
userSchema.methods.matchPassword = async function (enteredPassword) {
    // 'this.password' is typically excluded due to `select: false`.
    // We either need to explicitly select it in the query that fetched the user,
    // or re-fetch it here. Re-fetching is less efficient but safer if unsure.
    const userWithPassword = await mongoose.model('User').findById(this._id).select('+password');
    if (!userWithPassword || !userWithPassword.password) {
         console.error(`Could not retrieve password hash for user ${this._id} in matchPassword.`);
         return false; // Safety check
    }
    return await bcrypt.compare(enteredPassword, userWithPassword.password);
};

/**
 * Generate and hash password reset token, set expiry. Saves changes to the instance.
 * @returns {string} The *unhashed* reset token (to be sent via email).
 */
userSchema.methods.generatePasswordResetToken = function () {
    // Generate token (simple random bytes)
    const resetToken = crypto.randomBytes(20).toString('hex');

    // Hash token and set to resetPasswordToken field
    // Hashing prevents attackers from using leaked DB data directly as reset tokens
    this.resetPasswordToken = crypto
        .createHash('sha256')
        .update(resetToken)
        .digest('hex');

    // Set expire time (e.g., 10 minutes from now)
    this.resetPasswordExpire = Date.now() + 10 * 60 * 1000; // 10 minutes in ms

    console.log(`Generated reset token (hashed): ${this.resetPasswordToken} for user ${this.username}`);

    // Return the *unhashed* token to be sent via email
    return resetToken;
};


// --- Static Methods ---
// Methods available on the Model itself (e.g., User.findByUsername())

/**
 * Find a user by username, case-insensitively.
 * @param {string} username - The username to search for.
 * @returns {Promise<Document|null>} The user document or null if not found.
 */
userSchema.statics.findByUsernameCaseInsensitive = function(username) {
     // Using regex for case-insensitivity. Requires an index for performance.
     // Ensure the index exists (either via `unique: true` with collation or a separate text/regex index).
     return this.findOne({ username: { $regex: new RegExp(`^${username}$`, 'i') } });
};

// Create the Mongoose model
const User = mongoose.model('User', userSchema);

module.exports = User;