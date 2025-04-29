/**
 * generateToken.js
 * Utility function to generate JWT.
 */
'use strict';

const jwt = require('jsonwebtoken');
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });

const JWT_SECRET = process.env.JWT_SECRET;
const JWT_EXPIRES_IN = process.env.JWT_EXPIRES_IN || '7d'; // Default expiry if not set in .env

if (!JWT_SECRET) {
    console.error("❌ FATAL ERROR: JWT_SECRET is not defined in .env file. Cannot generate tokens.");
    process.exit(1);
}
if (!JWT_EXPIRES_IN) {
     console.warn("⚠️ WARNING: JWT_EXPIRES_IN is not defined in .env file. Using default of '7d'.");
}


/**
 * Generates a JSON Web Token for a given user ID.
 * @param {string | mongoose.Types.ObjectId} userId - The user's ID. Must be convertible to string.
 * @returns {string} - The generated JWT.
 * @throws {Error} if userId is not provided.
 */
const generateToken = (userId) => {
    if (!userId) {
        throw new Error("User ID is required to generate a token.");
    }
    // Ensure userId is a string for the payload if it's an ObjectId
    const payload = { id: userId.toString() };

    try {
        const token = jwt.sign(
            payload,
            JWT_SECRET,
            { expiresIn: JWT_EXPIRES_IN } // Options: token expiry
        );
        // console.log(`Generated JWT for user ${userId} expiring in ${JWT_EXPIRES_IN}`);
        return token;
    } catch (error) {
         console.error("❌ Error generating JWT:", error);
         // Depending on context, might want to throw a more specific error
         throw new Error("Failed to generate authentication token.");
    }
};

module.exports = generateToken;