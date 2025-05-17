/**
 * roomController.js
 * Controllers for room-related API routes.
 */
'use strict';

const Room = require('../models/Room');
// Import shared state ONLY if absolutely necessary for API (prefer passing via request or context if possible)
// const { activeChats } = require('../index'); // Avoid direct import if possible

// Error handling utility
class AppError extends Error {
    constructor(message, statusCode) {
        super(message);
        this.statusCode = statusCode;
        this.isOperational = true;
        Error.captureStackTrace(this, this.constructor);
    }
}


// @desc    Get list of public rooms (name, description, etc.)
// @route   GET /api/rooms
// @access  Private (User must be logged in to see rooms)
const getPublicRooms = async (req, res, next) => {
    try {
        // Fetch rooms directly from the database
        const publicRooms = await Room.find({ type: 'public' })
            .select('name displayName description createdAt lastActivity') // Select fields needed by client
            .sort({ lastActivity: -1 }) // Sort by most recent activity
            .lean(); // Use lean() for performance - returns plain JS objects

        // Get active user counts - This requires access to the live socket state.
        // It's generally better if the client gets this information via Socket.IO updates
        // rather than mixing live state into a REST API response.
        // If absolutely needed here, index.js would need to provide access to `activeChats`.
        // For now, we omit the live online count from this API response.
        // const roomsWithCounts = publicRooms.map(room => ({
        //     ...room,
        //     onlineCount: activeChats.get(room.name)?.members.size || 0 // Requires access to activeChats
        // }));

        res.status(200).json({
            success: true,
            rooms: publicRooms // Send rooms without live count from API
        });

    } catch (error) {
        console.error("Error fetching public rooms:", error);
        next(error); // Pass to central error handler
    }
};

// @desc    Get details for a specific room (Placeholder)
// @route   GET /api/rooms/:roomIdOrName
// @access  Private (Requires specific permissions)
const getRoomDetails = async (req, res, next) => {
    // This controller is complex and requires careful implementation:
    // 1. Determine if param is ObjectId (for DM) or name (for public/private).
    // 2. Fetch the room from the database.
    // 3. Check if the room exists and if the requesting user (req.user) has permission to view it:
    //    - Public rooms: Anyone logged in.
    //    - Private rooms: Check if user is a member/owner.
    //    - Direct messages: Check if user is one of the two participants.
    // 4. If authorized, select and return relevant details (e.g., name, description, members list).
    // 5. Handle errors (Not Found, Forbidden).

    console.warn("getRoomDetails controller not fully implemented.");
    return next(new AppError('This feature (get room details) is not yet available.', 501)); // 501 Not Implemented
};


module.exports = {
    getPublicRooms,
    getRoomDetails // Exporting placeholder
};