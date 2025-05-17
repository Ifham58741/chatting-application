/**
 * auth.js
 * Authentication middleware (JWT verification).
 */
'use strict';

const jwt = require('jsonwebtoken');
const User = require('../models/User');
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });

const JWT_SECRET = process.env.JWT_SECRET;

if (!JWT_SECRET) {
    console.error("❌ FATAL ERROR: JWT_SECRET is not defined in .env file.");
    process.exit(1);
}

/**
 * Middleware to protect Express routes.
 * Verifies JWT from Authorization header ('Bearer <token>').
 * Attaches user object (minus password) to req.user.
 */
const protectRoute = async (req, res, next) => {
    let token;

    if (req.headers.authorization && req.headers.authorization.startsWith('Bearer')) {
        try {
            token = req.headers.authorization.split(' ')[1];
            const decoded = jwt.verify(token, JWT_SECRET);
            // Fetch user, excluding sensitive fields
            req.user = await User.findById(decoded.id).select('-password -resetPasswordToken -resetPasswordExpire');

            if (!req.user) {
                 console.warn(`Auth warning: User ${decoded.id} not found for valid token.`);
                 return res.status(401).json({ success: false, error: 'Not authorized, user not found' });
            }
            next();
        } catch (error) {
            console.error('❌ Token Verification Error:', error.name, error.message);
             let message = 'Not authorized, token failed';
             if (error.name === 'JsonWebTokenError') message = 'Not authorized, invalid token signature';
             if (error.name === 'TokenExpiredError') message = 'Not authorized, token expired';
            res.status(401).json({ success: false, error: message });
        }
    } else {
         res.status(401).json({ success: false, error: 'Not authorized, no token provided' });
    }
};


/**
 * Socket.IO Middleware to authenticate connections.
 * Verifies JWT from socket.handshake.auth.token.
 * Attaches user object (minus password) to socket.user.
 * Calls next() on success, next(new Error(...)) on failure.
 */
const protectSocket = async (socket, next) => {
    const token = socket.handshake.auth?.token;

    if (!token) {
        console.warn(`🔌 Socket connection rejected: No token provided (Socket ID: ${socket.id})`);
        return next(new Error('Authentication error: No token provided'));
    }

    try {
        // Verify token
        const decoded = jwt.verify(token, JWT_SECRET);

        // Get user from the token payload (excluding sensitive fields)
        const user = await User.findById(decoded.id).select('-password -resetPasswordToken -resetPasswordExpire');

        if (!user) {
            console.warn(`🔌 Socket connection rejected: User ${decoded.id} not found for token (Socket ID: ${socket.id})`);
            return next(new Error('Authentication error: User not found'));
        }

        // *** Refined User Object Handling ***
        // Convert Mongoose document to a plain JavaScript object, ensuring virtuals (like 'id') are included.
        const userObject = user.toObject({ virtuals: true });

        // Double-check the resulting object has the 'id' property (which is the string version of _id)
        if (!userObject || !userObject.id) {
             console.error(`❌ CRITICAL: User found (DB ID: ${user._id}) but plain object conversion failed or is missing 'id' virtual.`);
             return next(new Error('Authentication error: Internal server error processing user data.'));
        }

        // Attach the validated plain object to the socket instance
        socket.user = userObject;

        // *** Add extra sanity check before calling next() ***
        if (!socket.user || !socket.user.id) {
            // This should be virtually impossible if the above checks passed, but acts as a final guard.
            console.error(`❌ CRITICAL: socket.user or socket.user.id became invalid immediately after assignment in protectSocket!`);
            return next(new Error('Authentication error: Internal server error attaching user data.'));
        }

        // Log success *after* successfully attaching the validated user object
        console.log(`✅ Socket authenticated: ${socket.user.username} (ID: ${socket.user.id}, Socket: ${socket.id})`);
        next(); // Proceed with connection

    } catch (error) {
        // Handle JWT errors or DB errors during user fetch
        console.error(`❌ Socket connection rejected: Token verification or user fetch failed (Socket ID: ${socket.id})`, error.name, error.message);
         let message = 'Authentication error: Invalid token or user lookup failed';
         if (error.name === 'JsonWebTokenError') message = 'Authentication error: Invalid token signature';
         if (error.name === 'TokenExpiredError') message = 'Authentication error: Token expired';
        next(new Error(message)); // Send specific error message to client
    }
};


module.exports = { protectRoute, protectSocket };