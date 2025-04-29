/**
 * errorHandler.js
 * Centralized error handling middleware for Express.
 * Should be the LAST middleware included in index.js.
 */
'use strict';

const errorHandler = (err, req, res, next) => {
    console.error("💥 Error Handler Caught:");
    // Log more context if available
    console.error("  Request:", req.method, req.originalUrl);
    if (req.user) console.error("  User:", req.user.id);
    console.error("  Error Message:", err.message);
    if (process.env.NODE_ENV === 'development') { // Log stack only in development
        console.error("  Stack:", err.stack);
    }

    let statusCode = err.statusCode || 500; // Default to 500 Internal Server Error
    let message = err.message || 'Internal Server Error';
    let success = false;

    // --- Handle Specific Error Types ---

    // Mongoose Bad ObjectId Error
    if (err.name === 'CastError' && err.kind === 'ObjectId') {
        statusCode = 404; // Treat invalid ID as not found
        message = `Resource not found. Invalid identifier format.`;
    }

    // Mongoose Duplicate Key Error
    if (err.code === 11000) {
        statusCode = 400; // Bad Request - client tried to create duplicate
        const field = Object.keys(err.keyValue)[0];
        const value = err.keyValue[field];
        message = `Duplicate value entered for '${field}'. The value '${value}' is already taken.`;
    }

    // Mongoose Validation Error
    if (err.name === 'ValidationError') {
        statusCode = 400;
        // Combine multiple validation messages
        const messages = Object.values(err.errors).map(val => val.message);
        message = `Validation Error: ${messages.join('. ')}`;
        // Optionally, send back structured errors
        // errorResponse.errors = Object.values(err.errors).map(val => ({ field: val.path, message: val.message }));
    }

    // JWT Errors (already handled in auth middleware, but catch here if they somehow leak)
    if (err.name === 'JsonWebTokenError') {
         statusCode = 401;
         message = 'Invalid token signature.';
    }
    if (err.name === 'TokenExpiredError') {
         statusCode = 401;
         message = 'Token has expired.';
    }

    // Custom application errors (you can throw errors with statusCode and message)
    if (err.statusCode) {
        statusCode = err.statusCode;
        message = err.message;
    }

    // --- Send Response ---
    // Ensure response is sent only once
    if (res.headersSent) {
        console.error("  Headers already sent, cannot send error response.");
        return next(err); // Delegate to default Express handler
    }

    res.status(statusCode).json({
        success: success,
        error: message,
        // Optionally include stack trace in development
        // stack: process.env.NODE_ENV === 'development' ? err.stack : undefined
    });
};

// Middleware for handling 404 Not Found errors (requests that didn't match any route)
// Place this just BEFORE the main errorHandler in index.js
const notFoundHandler = (req, res, next) => {
    res.status(404).json({ success: false, error: `Not Found - ${req.originalUrl}` });
};


module.exports = { errorHandler, notFoundHandler };