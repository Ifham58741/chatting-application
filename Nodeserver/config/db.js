/**
       * db.js
       * Handles MongoDB connection using Mongoose.
       */
'use strict';

const mongoose = require('mongoose');
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') }); // Load .env from Nodeserver dir

const MONGODB_URI = process.env.MONGODB_URI;

const connectDB = async () => {
    if (!MONGODB_URI) {
        console.error('❌ FATAL ERROR: MONGODB_URI is not defined in the .env file.');
        process.exit(1);
    }

    console.log('Attempting MongoDB connection...');
    // Log URI safely for debugging (hide credentials if present)
    const safeUri = MONGODB_URI.replace(/:.*@/, ':****@');
    console.log(`Using URI: ${safeUri}`);

    try {
        // Mongoose 6+ options are streamlined. No need for deprecated options.
        // `autoIndex` is true by default in development, false in production.
        // Consider setting explicitly based on environment if needed.
        await mongoose.connect(MONGODB_URI, {
            serverSelectionTimeoutMS: 5000, // Timeout after 5s instead of default 30s
            // appName: 'AdvancedChatApp' // Optional: Identify application in MongoDB logs
        });
        console.log('✅ MongoDB Connected Successfully.');

    } catch (error) {
        console.error('❌ MongoDB Connection Error:', error.message);
        // Provide more context based on common error types
        if (error.name === 'MongoNetworkError') {
            console.error('   -> Network error. Is the MongoDB server running and accessible? Check hostname/port.');
        } else if (error.name === 'MongooseServerSelectionError') {
            console.error('   -> Server selection error. Check connection string, firewall rules, and server availability.');
            console.error('   -> Original Error:', error.reason?.message || 'No specific reason available.');
        } else if (error.name === 'MongoServerError' && error.message.includes('Authentication failed')) {
             console.error('   -> Authentication failed. Check username/password in the MongoDB URI.');
        } else {
            console.error('   -> An unexpected connection error occurred.');
        }
        // Exit process on critical connection failure during startup
        process.exit(1);
    }

    // --- Mongoose Connection Event Listeners (Post-Initial Connection) ---
    mongoose.connection.on('error', (err) => {
        // This catches errors *after* the initial connection succeeds
        console.error(`❌ Mongoose Runtime Error: ${err}`);
    });

    mongoose.connection.on('disconnected', () => {
        // This occurs if the connection is lost after establishing it
        console.warn('⚠️ MongoDB Disconnected. Attempting reconnection (managed by driver)...');
        // Implement custom retry logic here only if Mongoose's built-in retry is insufficient
    });

    mongoose.connection.on('reconnected', () => {
        console.log('✅ MongoDB Reconnected.');
    });

    // Optional: Log when connection is closed explicitly
    mongoose.connection.on('close', () => {
        console.log('ℹ️ MongoDB connection closed.');
    });

    // --- Graceful Shutdown Handling ---
    // Function to close Mongoose connection properly
    const gracefulShutdown = async (signal) => {
        console.log(`\n${signal} received. Closing MongoDB connection...`);
        try {
            await mongoose.connection.close();
            console.log('✅ MongoDB connection closed successfully due to app termination.');
            process.exit(0); // Exit cleanly
        } catch (err) {
            console.error('❌ Error closing MongoDB connection during shutdown:', err);
            process.exit(1); // Exit with error code
        }
    };

    // Listen for termination signals
    process.on('SIGINT', () => gracefulShutdown('SIGINT')); // Ctrl+C
    process.on('SIGTERM', () => gracefulShutdown('SIGTERM')); // Kill command
};

module.exports = connectDB;