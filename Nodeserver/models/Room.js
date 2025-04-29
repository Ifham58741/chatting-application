/**
       * Room.js
       * Mongoose schema and model for persistent chat rooms/channels and Direct Messages.
       */
'use strict';

const mongoose = require('mongoose');
const { Schema } = mongoose;

const roomSchema = new Schema({
    name: { // Used as the unique ID for *public* rooms (e.g., 'general', 'random')
        type: String,
        // Required only for public/private rooms, should be absent for DMs
        required: function() { return this.type === 'public' || this.type === 'private'; },
        unique: true,
        sparse: true, // IMPORTANT: Allows multiple documents without 'name' (i.e., DMs) while enforcing uniqueness for those that have it.
        trim: true,
        lowercase: true,
        minlength: [3, 'Room name must be at least 3 characters.'],
        maxlength: [20, 'Room name cannot exceed 20 characters.'],
        match: [/^[a-z0-9-_]+$/, 'Room name can only contain lowercase letters, numbers, underscores, and hyphens.']
    },
    displayName: { // User-facing name (can have different casing, spaces etc.) - Primarily for public/private rooms.
        type: String,
        required: function() { return this.type === 'public' || this.type === 'private'; },
        trim: true,
        maxlength: [30, 'Room display name cannot exceed 30 characters.'],
    },
    description: { // Optional description for public/private rooms
        type: String,
        trim: true,
        maxlength: [100, 'Description cannot exceed 100 characters.'],
        default: ''
    },
    type: { // Distinguishes between room types
        type: String,
        enum: ['public', 'private', 'direct'], // 'direct' for DMs
        required: true,
        default: 'public',
        index: true // Index type for filtering rooms
    },
    owner: { // Reference to the User who created the room (optional for public, maybe required for private)
        type: Schema.Types.ObjectId,
        ref: 'User',
    },
    participants: [{ // Array of User ObjectIds participating in the chat
        // Required for 'direct' (always 2 participants), potentially used for 'private' rooms as well.
        type: Schema.Types.ObjectId,
        ref: 'User',
        required: function() { return this.type === 'direct'; },
    }],
    lastActivity: { // Timestamp of the last message sent in the room (used for sorting DMs/Rooms)
        type: Date,
        default: Date.now,
        index: true // Index for sorting by activity
    }
}, {
    timestamps: true // Automatically manage createdAt/updatedAt
});

// --- Indexes ---
// Index for finding public rooms efficiently by name
roomSchema.index({ type: 1, name: 1 }, { unique: true, partialFilterExpression: { type: 'public' } });

// Index for finding private rooms efficiently by name (if using names for private rooms)
// roomSchema.index({ type: 1, name: 1 }, { unique: true, partialFilterExpression: { type: 'private' } });

// Compound index for finding DM rooms between two specific participants.
// Ensures uniqueness for a pair regardless of the order of IDs in the 'participants' array.
// Uses a partial filter to apply only to 'direct' type rooms.
roomSchema.index(
    { type: 1, participants: 1 },
    {
        unique: true,
        partialFilterExpression: { type: 'direct' }
    }
);

// Index participants for finding all rooms a user is part of
roomSchema.index({ participants: 1 });


// --- Static Methods ---

/**
 * Finds or creates a Direct Message (DM) room between two users.
 * Ensures only one DM room exists per pair of users.
 * Handles potential race conditions during creation.
 * @param {string|mongoose.Types.ObjectId} userId1 - ID of the first user.
 * @param {string|mongoose.Types.ObjectId} userId2 - ID of the second user.
 * @returns {Promise<{room: Document, isNew: boolean}>} - The DM room document and a flag indicating if it was newly created.
 * @throws {Error} If users are the same or creation fails.
 */
roomSchema.statics.findOrCreateDirectMessage = async function(userId1, userId2) {
     const user1_id = userId1.toString();
     const user2_id = userId2.toString();

     if (user1_id === user2_id) {
          throw new Error("Cannot create a direct message with oneself.");
     }
     // Sort IDs consistently to ensure the unique index on 'participants' works correctly.
     const participants = [user1_id, user2_id].sort();

     try {
         // 1. Attempt to find the existing DM room
         let dmRoom = await this.findOne({
             type: 'direct',
             // $all ensures both participants are present, $size ensures exactly two.
             participants: { $all: participants, $size: 2 }
         });

         let isNew = false;

         // 2. If not found, attempt to create it
         if (!dmRoom) {
             console.log(`Creating new DM room for users: ${user1_id}, ${user2_id}`);
             dmRoom = new this({
                 type: 'direct',
                 participants: participants,
                 // name, displayName, description are typically not used for DMs
                 lastActivity: new Date() // Initialize activity timestamp
             });
             try {
                 await dmRoom.save();
                 isNew = true;
                 console.log(`✅ DM Room created with ID: ${dmRoom._id}`);
             } catch (error) {
                 // 3. Handle potential race condition (duplicate key error - code 11000)
                 if (error.code === 11000) {
                      console.warn("DM creation race condition detected. Retrying find...");
                      // Another process/request likely created the room just before this save completed.
                      // Find the room again. It should exist now.
                      dmRoom = await this.findOne({
                          type: 'direct',
                          participants: { $all: participants, $size: 2 }
                      });
                      if (!dmRoom) {
                          // This is highly unlikely but indicates a persistent issue.
                          console.error("❌ Failed to find DM room even after race condition handling.");
                          throw new Error("Server error: Could not find or create DM room.");
                      }
                      console.log("   Found existing DM room after race condition.");
                      isNew = false; // It wasn't new from this process's perspective
                 } else {
                      // Re-throw other database errors
                      console.error(`❌ Error saving new DM room:`, error);
                      throw error;
                 }
             }
         }

         return { room: dmRoom, isNew: isNew };

     } catch (error) {
          console.error(`❌ General error in findOrCreateDirectMessage for ${user1_id}, ${user2_id}:`, error);
          // Rethrow or wrap the error
          throw new Error(`Failed to find or create direct message: ${error.message}`);
     }
};

// --- Instance Methods ---

/**
 * Updates the lastActivity timestamp for the room.
 * Call this after a new message is saved.
 * @returns {Promise<Document>} The saved room document.
 */
roomSchema.methods.updateLastActivity = function() {
    this.lastActivity = new Date();
    // Using save() is simple and triggers middleware if any.
    // For high-throughput systems, updateOne might be slightly more performant
    // if only this field needs updating and no middleware logic depends on save().
    // return mongoose.model('Room').updateOne({ _id: this._id }, { $set: { lastActivity: new Date() } });
    return this.save();
};


// --- Model ---
const Room = mongoose.model('Room', roomSchema);

module.exports = Room;