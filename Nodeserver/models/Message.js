/**
       * Message.js
       * Mongoose schema and model for chat messages (Enhanced with indexes).
       */
'use strict';

const mongoose = require('mongoose');
const { Schema } = mongoose;

const messageSchema = new Schema({
    text: {
        type: String,
        required: [true, 'Message text cannot be empty.'],
        trim: true,
        maxlength: [1000, 'Message text cannot exceed 1000 characters.'] // Limit message length
    },
    sender: { // Reference to the User who sent the message
        type: Schema.Types.ObjectId,
        ref: 'User',
        required: [true, 'Message must have a sender ID.'],
        index: true // Index sender for potential user-specific queries
    },
    chat: { // Reference to the Room document (representing either a public room or a DM conversation)
        type: Schema.Types.ObjectId,
        ref: 'Room', // Links to the Room model
        required: [true, 'Message must belong to a chat.'],
        index: true // *** Crucial for efficiently fetching chat history ***
    },
    // Timestamp is automatically handled by `timestamps: true` below (createdAt field)
    // Explicit timestamp field can be redundant unless specific needs exist.
    // timestamp: {
    //     type: Date,
    //     default: Date.now,
    //     required: true,
    //     index: true // Important for sorting
    // }
    // Optional: Read receipts
    // readBy: [{
    //     type: Schema.Types.ObjectId,
    //     ref: 'User'
    // }]
}, {
    // Add createdAt and updatedAt timestamps automatically
    timestamps: true,
     // Optional: Specify collection name
    // collection: 'messages'
});

// --- Indexes ---
// Compound index for the most common query: fetching recent messages for a specific chat.
// Sorts by timestamp descending (-1) within each chat.
messageSchema.index({ chat: 1, createdAt: -1 });

// Optional: Add TTL index to automatically delete old messages after a certain period
// Requires configuring MongoDB for TTL collections. Use with caution.
// messageSchema.index({ createdAt: 1 }, { expireAfterSeconds: 3600 * 24 * 90 }); // e.g., expire after 90 days

// --- Middleware ---
// Example: Populate sender details when finding messages (can also be done in query)
// This middleware might add overhead if sender details aren't always needed.
// Consider populating explicitly in controller/handler where required.
/*
messageSchema.pre(/^find/, function(next) {
    // Check if population is already applied or explicitly skipped
    if (this.options._populateSender === false) return next();

    this.populate({
        path: 'sender',
        select: 'username avatarUrl status' // Select only needed fields
    });
    next();
});
*/

// --- Model ---
const Message = mongoose.model('Message', messageSchema);

module.exports = Message;