/**
 * index.js
 * Main server file for the Advanced Real-Time Chat Application.
 * Sets up Express, Socket.IO, Database connection, Middleware, Routes, and Error Handling.
 */
'use strict';

// --- Core & Third-Party Modules ---
const http = require('http');
const path = require('path');
const express = require('express');
const { Server } = require('socket.io');
const mongoose = require('mongoose'); // Used for checking ObjectId validity, DB interactions
require('dotenv').config({ path: path.join(__dirname, '.env') }); // Load environment variables

// --- Application Modules ---
const connectDB = require('./config/db');
const { protectSocket } = require('./middleware/auth'); // Socket auth middleware
const { errorHandler, notFoundHandler } = require('./middleware/errorHandler'); // Express error handlers
const registerSocketHandlers = require('./socketHandlers'); // Centralized socket event logic
const User = require('./models/User'); // User model
const Room = require('./models/Room'); // Room model

// Route handlers
const authRoutes = require('./routes/auth');
const userRoutes = require('./routes/users');
const roomRoutes = require('./routes/rooms');

// --- Configuration ---
const PORT = process.env.PORT || 8000;
const PUBLIC_DIR = path.join(__dirname, '..'); // Client-side files (HTML, CSS, JS) are in the parent dir
const UPLOAD_ROUTE = process.env.UPLOAD_ROUTE || '/uploads/avatars'; // URL path for uploads
const UPLOAD_DIR_FROM_ENV = process.env.UPLOAD_DIR || '../uploads/avatars'; // Path relative to this file from .env
const UPLOAD_DIR_SERVE_ABSOLUTE = path.resolve(__dirname, UPLOAD_DIR_FROM_ENV); // Absolute path for serving static files
const DEFAULT_ROOM = process.env.DEFAULT_ROOM || 'general'; // Default public room name

// Basic validation of critical env variables
if (!process.env.JWT_SECRET || !process.env.MONGODB_URI) {
    console.error("❌ FATAL ERROR: JWT_SECRET and MONGODB_URI must be defined in the .env file.");
    process.exit(1);
}

// --- Server & Socket.IO Setup ---
const app = express();
const server = http.createServer(app);
const io = new Server(server, {
    // Configure CORS if frontend is served from a different origin than the backend
    // cors: {
    //     origin: "http://localhost:3000", // Allow frontend origin
    //     methods: ["GET", "POST"]
    // },
    pingInterval: 10000, // How often to send a ping (ms)
    pingTimeout: 5000,   // How long to wait for pong before disconnecting (ms)
});

// --- In-Memory State Management ---
// IMPORTANT: This in-memory state will be lost on server restart.
// For production/scaling, use a shared store like Redis.
// Map<userId (string), Set<socketId (string)>> - Tracks all sockets for a given user
const userSockets = new Map();
// Map<socketId (string), { userId: string, username: string, currentChatId: string | null, currentChatType: 'room'|'dm'|null }> - Info about each connected socket
const connectedSockets = new Map();
// Map<chatId (string - roomName or DM ObjectId), { name: string, type: 'room'|'dm', dbId: ObjectId, members: Set<userId (string)> }> - Tracks users currently active in each chat
const activeChats = new Map();


// --- Main Server Initialization Function ---
(async () => {
    try {
        // 1. Connect to Database
        await connectDB(); // Exits process on failure

        // 2. Load/Ensure Default Room(s) exist in DB and memory
        await ensureDefaultRoom();

        // 3. Configure Express Middleware
        // Enable trusting proxies if behind Nginx/Heroku/etc. (for IP logging, rate limiting)
        // app.set('trust proxy', 1);
        app.use(express.json()); // Parse JSON request bodies
        app.use(express.urlencoded({ extended: false })); // Parse URL-encoded request bodies

        // Logging Middleware (Simple Example)
        app.use((req, res, next) => {
            console.log(`HTTP Request: ${req.method} ${req.originalUrl}`);
            next();
        });

        // Serve Static Files (HTML, CSS, JS from parent directory)
        app.use(express.static(PUBLIC_DIR));
        console.log(`✅ Serving static files from: ${PUBLIC_DIR}`);

        // Serve Uploaded Files (Avatars)
        console.log(`✅ Serving uploads from URL '${UPLOAD_ROUTE}' mapped to dir: ${UPLOAD_DIR_SERVE_ABSOLUTE}`);
        app.use(UPLOAD_ROUTE, express.static(UPLOAD_DIR_SERVE_ABSOLUTE));

        // 4. Define API Routes
        app.use('/api/auth', authRoutes);
        app.use('/api/users', userRoutes);
        app.use('/api/rooms', roomRoutes);

        // 5. Handle Client-Side Routing (for SPAs)
        // Serve index.html for the root path and any other non-API/file routes
        app.get('*', (req, res, next) => {
            if (req.originalUrl.startsWith('/api/') || req.originalUrl.startsWith(UPLOAD_ROUTE) || req.originalUrl.includes('.')) {
                return next(); // Pass to other handlers or 404
            }
            res.sendFile(path.join(PUBLIC_DIR, 'index.html'), (err) => {
                 if (err) {
                     console.error("Error sending index.html:", err);
                     res.status(500).send('Error loading application.');
                 }
            });
        });


        // 6. Configure Socket.IO Authentication Middleware
        io.use(protectSocket); // Verify JWT for every incoming socket connection


        // 7. Configure Socket.IO Connection Handling
        io.on('connection', (socket) => {
            // At this point, protectSocket middleware should have successfully run next()
            // and attached the validated plain user object to socket.user

            // *** CRITICAL CHECK: Ensure user object is valid after middleware ***
            if (!socket.user || !socket.user.id) {
                console.error(`❌ CRITICAL ERROR: Socket connected (ID: ${socket.id}) but user object or user.id is missing/invalid in 'connection' handler AFTER successful authentication middleware!`);
                console.error("   socket.user object received:", JSON.stringify(socket.user)); // Log the problematic object
                console.error("   Disconnecting socket due to invalid user state.");
                socket.disconnect(true); // Force disconnect the problematic connection
                return; // Stop processing this connection
            }

            // --- If the check passes, proceed with connection setup ---
            const user = socket.user; // user is the plain JS object attached by protectSocket
            const userId = user.id.toString(); // Use the 'id' virtual from the plain object
            const username = user.username;
            const socketId = socket.id;

            console.log(`🔌 User connected: ${username} (ID: ${userId}, Socket: ${socketId})`);

            // --- Store Connection State ---
            if (!userSockets.has(userId)) {
                userSockets.set(userId, new Set());
            }
            userSockets.get(userId).add(socketId);

            connectedSockets.set(socketId, {
                 userId: userId,
                 username: username,
                 currentChatId: null, // Initially not in any chat
                 currentChatType: null
             });

            // --- Create the state object to pass down ---
            // Include the broadcast function here
            const handlerState = {
                 userSockets,
                 connectedSockets,
                 activeChats,
                 broadcastPresenceUpdate // Pass the function reference
             };

            // --- Register Event Listeners for *this specific socket* ---
            // Pass io, socket, and the prepared state object
            registerSocketHandlers(io, socket, handlerState);

            // --- Handle User Presence (Online Status & Initial Data) ---
             handleUserConnect(io, socket, handlerState);

        }); // End io.on('connection')


        // 8. Centralized Express Error Handling (Must be LAST middleware)
        app.use(notFoundHandler); // Catch 404s that fell through routes
        app.use(errorHandler);    // Catch all other errors passed via next(err)

        // 9. Start HTTP Server
        server.listen(PORT, () => {
            console.log(`🚀 Server listening on http://localhost:${PORT}`);
            console.log(`💬 Default public room: #${DEFAULT_ROOM}`);
        });

    } catch (err) {
         console.error("💥 Server startup failed:", err);
         process.exit(1); // Exit if essential startup steps fail
    }
})(); // End main async IIFE


// --- Server Helper Functions ---

/** Ensure the default public room exists in the DB and load into memory */
async function ensureDefaultRoom() {
    try {
         console.log(`Ensuring default room "${DEFAULT_ROOM}" exists...`);
         let room = await Room.findOne({ type: 'public', name: DEFAULT_ROOM });
         if (!room) {
             console.log(`   Default room "${DEFAULT_ROOM}" not found in DB, creating...`);
             room = new Room({
                 name: DEFAULT_ROOM,
                 displayName: DEFAULT_ROOM.charAt(0).toUpperCase() + DEFAULT_ROOM.slice(1), // Capitalize
                 type: 'public',
                 description: 'Default public chat room for everyone.'
             });
             await room.save();
             console.log(`   ✅ Default room "${DEFAULT_ROOM}" created in DB.`);
         } else {
              console.log(`   ℹ️ Default room "${DEFAULT_ROOM}" found in DB.`);
         }
         // Ensure it's loaded into the activeChats map (initialize members set)
         if (!activeChats.has(DEFAULT_ROOM)) {
              activeChats.set(DEFAULT_ROOM, {
                  name: room.displayName, // Store display name
                  type: 'room',
                  dbId: room._id, // Store the DB ObjectId
                  members: new Set() // Initialize with empty members
              });
               console.log(`   ✅ Default room "${DEFAULT_ROOM}" loaded into active server memory.`);
         } else {
             // Ensure dbId is present if already loaded (e.g., after restart without clearing map)
             if (!activeChats.get(DEFAULT_ROOM).dbId) {
                 activeChats.get(DEFAULT_ROOM).dbId = room._id;
             }
         }
    } catch (error) {
         console.error(`❌ FATAL: Error ensuring default room "${DEFAULT_ROOM}":`, error);
         process.exit(1);
    }
}

/** Handles logic when a user's first socket connects or reconnects */
async function handleUserConnect(io, socket, state) {
     const { userSockets, connectedSockets, activeChats, broadcastPresenceUpdate } = state; // Use broadcast func from state
     const userId = socket.user.id.toString();
     const username = socket.user.username;

     const userSocketSet = userSockets.get(userId);
     const isFirstConnection = userSocketSet && userSocketSet.size === 1;

     if (isFirstConnection) {
          console.log(`   ${username} is now online (first connection).`);
          try {
               // Update user status to 'online' in DB
               const updatedUser = await User.findByIdAndUpdate(userId,
                    { $set: { status: 'online', lastSeen: new Date() } },
                    { new: true, select: 'lastSeen' } // Only need lastSeen back
               ).lean();

               if(!updatedUser) {
                    console.error(`   Error updating status for ${username}: User not found in DB.`);
                    return;
               }
               console.log(`   Updated DB status for ${username} to online.`);

               // Broadcast presence update to relevant users
               broadcastPresenceUpdate(io, state, userId, {
                    status: 'online',
                    lastSeen: updatedUser.lastSeen.toISOString()
                });

                // Send initial chat lists (rooms, DMs) to the newly connected socket
                await sendInitialData(socket, state);

          } catch (error) {
               console.error(`   ❌ Error during user connect handling for ${username}:`, error);
                try { await sendInitialData(socket, state); } catch (e) {console.error("Failed to send initial data after connect error:", e)} // Best effort
          }
     } else {
          console.log(`   ${username} connected (subsequent connection, ${userSocketSet?.size || 0} total).`);
          // Just send initial data to this new socket
          await sendInitialData(socket, state);
     }
}

/** Sends initial room and DM list to a newly connected/authenticated socket */
// ... (previous code in index.js)

/** Sends initial room and DM list to a newly connected/authenticated socket */
async function sendInitialData(socket, state) {
     // const { activeChats } = state; // Not strictly needed here
     const userId = socket.user.id.toString();
     console.log(`   Sending initial data to ${socket.user.username} (Socket: ${socket.id})...`);
     try {
          // 1. Get Public Rooms from DB
          const publicRooms = await Room.find({ type: 'public' })
               .select('name')
               .lean();
          const roomListData = publicRooms.map(room => ({
               name: room.name,
               hasUnread: false
          }));
          console.log(`      Found ${roomListData.length} public rooms.`);

          // 2. Get User's Direct Messages from DB
          console.log(`      Fetching DMs for user ${userId}...`);
          const userDMs = await Room.find({ type: 'direct', participants: userId })
               .populate({
                    path: 'participants',
                    match: { _id: { $ne: new mongoose.Types.ObjectId(userId) } }, // Populate only the OTHER participant
                    select: 'username avatarUrl status' // Select needed fields
               })
               .select('participants lastActivity _id') // Ensure _id is selected for dmRoomId
               .sort({ lastActivity: -1 })
               .lean();
          console.log(`      Found ${userDMs.length} potential DM documents.`);

           const dmListData = userDMs.map(dm => {
                // The 'participants' array should contain *only* the other user due to the `match` filter
                const otherUser = dm.participants[0];
                if (!otherUser) {
                     // This might happen if a user was deleted but the DM room wasn't cleaned up
                     console.warn(`   ⚠️ DM Room ${dm._id} found for user ${userId} but the other participant data is missing or invalid. Skipping.`);
                     return null;
                }
                console.log(`      Processing DM with ${otherUser.username} (Room ID: ${dm._id})`);
                return {
                    dmRoomId: dm._id.toString(), // Use the DB ObjectId string
                    otherUser: {
                         id: otherUser._id.toString(),
                         username: otherUser.username,
                         avatarUrl: otherUser.avatarUrl || '/uploads/avatars/default.png',
                         status: otherUser.status || 'offline'
                    },
                    lastMessageTimestamp: dm.lastActivity?.toISOString(),
                    hasUnread: false // Client assumes read initially, relies on message events for unread
                };
           }).filter(dm => dm !== null); // Filter out any skipped DMs

          // 3. Emit the combined data to the client
          socket.emit('initial data', {
               rooms: roomListData,
               dms: dmListData
          });
          console.log(`   ✅ Sent initial data to ${socket.user.username}. Rooms: ${roomListData.length}, DMs: ${dmListData.length}.`);

     } catch (error) {
          console.error(`   ❌ Error fetching or sending initial data to ${socket.user.username}:`, error);
          socket.emit('error message', 'Failed to load initial chat data. Please refresh.');
     }
}

// ... (rest of index.js, including ensureDefaultRoom, handleUserConnect, broadcastPresenceUpdate, server start, etc.)

// Make sure broadcastPresenceUpdate is defined correctly as shown previously
// module.exports = { io, userSockets, connectedSockets, activeChats, broadcastPresenceUpdate };

/** Broadcasts presence updates to relevant users (those sharing an active chat) */
function broadcastPresenceUpdate(io, state, userId, updateData) {
     const { userSockets, activeChats, connectedSockets } = state; // Use state passed in

     // Get username reliably if possible
     const userSocketIds = userSockets.get(userId);
     let username = userId; // Fallback to ID
     if (userSocketIds && userSocketIds.size > 0) {
         const firstSocketId = Array.from(userSocketIds)[0];
         username = connectedSockets.get(firstSocketId)?.username || userId;
     }

     console.log(`   Broadcasting presence update for ${username} (${userId}):`, updateData);

     // Find all unique users who share an *active* chat with the user whose presence changed
     const usersToNotify = new Set();
     activeChats.forEach(chatInfo => {
          if (chatInfo.members.has(userId)) {
               chatInfo.members.forEach(memberId => {
                    if (memberId !== userId) { // Don't notify self
                         usersToNotify.add(memberId);
                    }
               });
          }
     });

     if (usersToNotify.size > 0) {
           console.log(`      -> Notifying ${usersToNotify.size} users: [${Array.from(usersToNotify).join(', ')}]`);
           usersToNotify.forEach(notifyUserId => {
                const targetSockets = userSockets.get(notifyUserId);
                if (targetSockets && targetSockets.size > 0) {
                     targetSockets.forEach(socketId => {
                          io.to(socketId).emit('presence update', { userId, ...updateData });
                     });
                }
           });
      } else {
           console.log(`      -> No other users in active shared chats to notify.`);
      }
}


// --- Global Unhandled Error Catching ---
process.on('uncaughtException', (error) => {
    console.error('💥 UNCAUGHT EXCEPTION:', error.name, error.message);
    console.error(error.stack);
    console.error("   Application will exit due to uncaught exception.");
    // Optionally attempt graceful shutdown of DB, etc. before exiting
    process.exit(1);
});

process.on('unhandledRejection', (reason, promise) => {
    console.error('💥 UNHANDLED PROMISE REJECTION:');
    console.error('   Reason:', reason);
    // Optional: Exit process on unhandled rejection
    // process.exit(1);
});

console.log("Server script setup complete. Starting Express/Socket.IO server...");

// Export shared state and potentially io instance if needed elsewhere (though passing state is preferred)
// module.exports = { io, userSockets, connectedSockets, activeChats, broadcastPresenceUpdate };