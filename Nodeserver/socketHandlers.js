/**
 * socketHandlers.js
 * Registers and handles Socket.IO events for a connected client.
 * Focuses on clear logic, state management, and error handling.
 */
'use strict';

const mongoose = require('mongoose');
const User = require('./models/User');
const Message = require('./models/Message');
const Room = require('./models/Room');

const MAX_MESSAGE_LENGTH = 1000;
const MESSAGE_HISTORY_LIMIT = parseInt(process.env.MESSAGE_HISTORY_LIMIT || '50', 10);

// --- Export function to register handlers ---
module.exports = (io, socket, state) => {
    // Destructure shared state passed from index.js
    const { userSockets, connectedSockets, activeChats, broadcastPresenceUpdate } = state;

    // User and connection details (user object is attached by protectSocket middleware)
    // Ensure user object and id exist, otherwise middleware failed or something is wrong
    if (!socket.user || !socket.user.id) {
         console.error(`CRITICAL: Socket ${socket.id} reached handlers without valid user object! Disconnecting.`);
         socket.disconnect(true); // Disconnect immediately
         return; // Stop registering handlers for this invalid socket
    }
    const user = socket.user; // user is a plain JS object from protectSocket
    const userId = user.id.toString();
    const username = user.username;
    const socketId = socket.id;

    // --- Helper Functions Specific to this Socket ---

    /** Sends an error message back ONLY to this specific client */
    const sendError = (message) => {
        console.warn(`-> Sending error to ${username} (${socketId}): "${message}"`);
        socket.emit('error message', message); // Client listens on 'error message'
    };

     /** Sends an informational/success message back ONLY to this specific client */
     const sendInfo = (message, type = 'info') => {
          console.log(`-> Sending info to ${username} (${socketId}): "${message}"`);
          socket.emit('server message', { message, type }); // Client listens on 'server message'
     };

    /** Creates a standardized user detail object for sending to clients */
    const formatUserForClient = (targetUser) => {
         if (!targetUser) return null;
         // Ensure IDs are strings
         const idStr = targetUser._id?.toString() || targetUser.id?.toString();
         return {
             id: idStr,
             username: targetUser.username,
             avatarUrl: targetUser.avatarUrl || '/uploads/avatars/default.png', // Provide default
             status: targetUser.status || 'offline' // Provide default
         };
    };

    /** Fetches recent messages for a specific chat from the database */
    const getRecentMessages = async (chatDbId) => {
        if (!mongoose.Types.ObjectId.isValid(chatDbId)) {
            console.error(`Invalid chatDbId format for fetching messages: ${chatDbId}`);
            return [];
        }
        try {
            const messages = await Message.find({ chat: chatDbId })
                .sort({ createdAt: -1 }) // Sort by creation time, newest first
                .limit(MESSAGE_HISTORY_LIMIT)
                .populate('sender', 'username avatarUrl status') // Populate sender details needed
                .lean(); // Use lean for performance

            // Reverse the array to get chronological order (oldest first) for display
            return messages.reverse().map(msg => ({
                 // Ensure sender object exists before accessing properties
                 sender: msg.sender ? formatUserForClient(msg.sender) : { id: null, username: '[Deleted User]', avatarUrl: '/uploads/avatars/default.png', status: 'offline' },
                 text: msg.text,
                 timestamp: msg.createdAt.toISOString() // Use createdAt timestamp
             }));
        } catch (error) {
            console.error(`❌ Error fetching messages for chat ${chatDbId}:`, error);
            sendError("Failed to load message history."); // Notify client
            return []; // Return empty array on error
        }
    };

    /**
     * Joins the current socket to a specific Socket.IO room and updates server state.
     * @param {string} chatId - The ID used for the Socket.IO room (roomName for public, ObjectId string for DMs).
     * @param {string} chatType - 'room' or 'direct'.
     * @param {string} chatName - Display name of the chat.
     * @param {mongoose.Types.ObjectId} chatDbId - The MongoDB ObjectId of the chat Room document.
     */
    const joinSocketToChat = (chatId, chatType, chatName, chatDbId) => {
        const socketData = connectedSockets.get(socketId);
        if (!socketData) {
            console.error(`Cannot join chat: Socket data not found for ${socketId}`);
            return; // Should not happen if socket is connected
        }

        // 1. Update socket's current location state
        socketData.currentChatId = chatId;
        socketData.currentChatType = chatType;

        // 2. Join the Socket.IO room (using chatId which is roomName or DM ObjectId string)
        socket.join(chatId);

        // 3. Add user to the active chat's member set in memory
        if (!activeChats.has(chatId)) {
             activeChats.set(chatId, {
                  name: chatName, // Store display name
                  type: chatType,
                  dbId: chatDbId, // Store the DB id for reference
                  members: new Set()
              });
             console.log(`   Initialized active chat in memory: ${chatType} ${chatId}`);
        }
        activeChats.get(chatId).members.add(userId);

        console.log(`   ${username} (${socketId}) successfully joined ${chatType} "${chatName}" (ID: ${chatId})`);

        // 4. If it's a public room, broadcast updated user list
        if (chatType === 'room') {
            broadcastUserListUpdate(chatId);
            // Also broadcast their presence to the room
            // Use the user object attached to the socket for current status/avatar
            socket.to(chatId).emit('presence update', {
                userId,
                username,
                avatarUrl: user.avatarUrl,
                status: user.status || 'online' // Assume online if joining
            });
        }
    };

     /** Handles leaving the current chat (if any) before joining another or disconnecting */
     const leaveCurrentChat = () => {
         const socketData = connectedSockets.get(socketId);
         // Check if the socket is actually in a chat
         if (!socketData || !socketData.currentChatId || !socketData.currentChatType) {
             // console.log(`   Socket ${socketId} not in a chat, skipping leave.`);
             return;
         }

         const chatId = socketData.currentChatId;
         const chatType = socketData.currentChatType;
         const chatInfo = activeChats.get(chatId);

         console.log(`   ${username} (${socketId}) leaving ${chatType} ${chatId}...`);

         // 1. Leave the Socket.IO room
         socket.leave(chatId);

         // 2. Remove user from the active chat's members set in memory
         if (chatInfo) {
              const deleted = chatInfo.members.delete(userId);
              if(deleted) console.log(`   Removed ${username} from active members of ${chatId}. Remaining: ${chatInfo.members.size}`);
              else console.warn(`   User ${username} not found in active members set for ${chatId} during leave.`);

              // Optional: Clean up empty public rooms from activeChats map
              // Be cautious with this, might cause issues if another user joins immediately after it's cleared.
              // if (chatInfo.type === 'room' && chatInfo.members.size === 0) {
              //     activeChats.delete(chatId);
              //     console.log(`   Removed empty room ${chatId} from activeChats memory.`);
              // }

              // 3. If it was a public room, broadcast the updated user list to remaining members
              if (chatType === 'room' && chatInfo.members.size > 0) {
                   broadcastUserListUpdate(chatId);
              }
               // Also notify remaining users about potential presence change (simplified)
               // A full broadcastPresenceUpdate is better after disconnect status is set
               // socket.to(chatId).emit('presence update', { userId, status: 'offline' }); // Simplified
         } else {
               console.warn(`   Chat info not found in activeChats for ${chatId} while leaving.`);
         }

          // 4. Clear the socket's current location state
          socketData.currentChatId = null;
          socketData.currentChatType = null;

          // 5. Stop broadcasting typing status from this user in the old room (if they were typing)
          // Note: Client side usually handles clearing its own typing state on chat change/disconnect
          io.to(chatId).emit('stop typing', { userId, chat: { type: chatType, id: chatId } });

          console.log(`   ${username} (${socketId}) successfully left ${chatType} ${chatId}.`);
     };


     /** Broadcasts the updated user list for a specific PUBLIC room */
     const broadcastUserListUpdate = async (roomId) => {
          const roomInfo = activeChats.get(roomId);

          // Only broadcast for existing public rooms
          if (!roomInfo || roomInfo.type !== 'room') {
              // console.log(`Skipping user list broadcast for non-room or inactive chat: ${roomId}`);
              return;
          }

          let userListData = [];
          if (roomInfo.members.size > 0) {
               try {
                    // Fetch details for all active members from DB
                     const memberIds = Array.from(roomInfo.members);
                     // Convert string IDs to ObjectIds for the $in query if necessary
                     const memberObjectIds = memberIds.map(id => {
                         try { return new mongoose.Types.ObjectId(id); }
                         catch(e) { console.warn(`Invalid ObjectId format in room members: ${id}`); return null; }
                     }).filter(id => id !== null);


                     const users = await User.find({ _id: { $in: memberObjectIds }})
                         .select('username avatarUrl status') // Select fields needed by client list
                         .lean();
                     userListData = users.map(formatUserForClient).filter(u => u !== null); // Format and filter nulls
               } catch (error) {
                   console.error(`❌ Error fetching users for room ${roomId} list broadcast:`, error);
                    // Send empty list on error to avoid clients showing stale data
                   io.to(roomId).emit('user list update', { room: roomId, users: [] });
                   return;
               }
          } else {
               // console.log(`Room ${roomId} has no active members, broadcasting empty list.`);
          }

           // console.log(`Broadcasting user list for room #${roomId}: ${userListData.length} users`);
           io.to(roomId).emit('user list update', { room: roomId, users: userListData });
     };


    // --- Socket Event Handlers ---

    socket.on('join chat', async (data) => {
         // data: { type: 'room'|'dm', id: string }
         if (!data || !data.type || !data.id) {
             return sendError("Invalid join request data.");
         }

         const requestedType = data.type;
         const requestedId = data.id; // For rooms: name, for DMs: ObjectId string
         let chatDoc, chatIdForClient, chatName, chatAvatarUrl, chatDbId;
         let isNew = false;
         let otherParticipantDetails = null; // For DMs

         console.log(`=> ${username} requests to join ${requestedType}: ${requestedId}`);

          // --- Leave Previous Chat (if any) ---
          leaveCurrentChat();

         try {
             // --- Find/Create Chat Document ---
             if (requestedType === 'room') {
                  // Find existing public room by name
                   chatDoc = await Room.findOne({ type: 'public', name: requestedId });
                   if (!chatDoc) {
                        // Validate name before creating (basic check, model has more)
                        if (requestedId.length < 3 || requestedId.length > 20 || !/^[a-z0-9-_]+$/.test(requestedId)) {
                            return sendError("Invalid room name format. Use lowercase letters, numbers, -, _ (3-20 chars).");
                        }
                        console.log(`   Room "${requestedId}" not found, creating...`);
                        chatDoc = new Room({
                             name: requestedId,
                             displayName: requestedId.charAt(0).toUpperCase() + requestedId.slice(1), // Capitalize
                             type: 'public',
                             owner: userId // Set creator as owner
                        });
                        await chatDoc.save();
                        isNew = true;
                        console.log(`   ✅ Room "${requestedId}" created.`);
                        // TODO: Broadcast updated public room list to all users?
                        // io.emit('room list update', await getPublicRoomsData()); // Requires helper func
                   }
                   chatIdForClient = chatDoc.name; // Use name for client/socket room ID
                   chatName = chatDoc.displayName;
                   chatDbId = chatDoc._id; // Store DB ObjectId
                   chatAvatarUrl = null; // Rooms don't have avatars

             } else if (requestedType === 'direct') {
                  // Find DM room by its MongoDB _id
                   if (!mongoose.Types.ObjectId.isValid(requestedId)) {
                        return sendError("Invalid DM identifier format.");
                   }
                   // Populate the other participant's details needed for the response
                   chatDoc = await Room.findById(requestedId)
                        .populate({
                            path: 'participants',
                            match: { _id: { $ne: new mongoose.Types.ObjectId(userId) } }, // Only populate the other user
                            select: 'username avatarUrl status'
                         });

                   if (!chatDoc || chatDoc.type !== 'direct') {
                        return sendError("Direct message chat not found.");
                   }
                   // Ensure the requesting user is actually a participant
                   const participantIds = await Room.findById(requestedId).select('participants -_id').lean().then(r => r.participants.map(p => p.toString()));
                   if (!participantIds.includes(userId)) {
                        console.warn(`User ${username} attempted to join DM ${requestedId} they are not part of.`);
                        return sendError("Not authorized for this direct message.");
                   }

                   chatIdForClient = chatDoc._id.toString(); // Use ObjectId string for client/socket room ID
                   chatDbId = chatDoc._id;
                   // Get the populated other participant's details
                   // If the populate worked correctly, participants[0] should be the other user
                   otherParticipantDetails = chatDoc.participants.length > 0 ? formatUserForClient(chatDoc.participants[0]) : null;
                   if (!otherParticipantDetails) {
                        console.error(`Could not find other participant details for DM ${chatIdForClient} after population.`);
                        // Attempt to find the other participant ID manually
                         const otherParticipantId = participantIds.find(id => id !== userId);
                         if (otherParticipantId) {
                             const otherUserData = await User.findById(otherParticipantId).select('username avatarUrl status').lean();
                             otherParticipantDetails = formatUserForClient(otherUserData);
                         }
                         if(!otherParticipantDetails) {
                             return sendError("Error identifying DM partner.");
                         }
                   }
                   chatName = otherParticipantDetails.username;
                   chatAvatarUrl = otherParticipantDetails.avatarUrl;
                   isNew = false; // Cannot "create" a DM via join chat, only via initiate DM

             } else {
                   return sendError("Invalid chat type specified.");
             }

             // --- Join Socket & Update Server State ---
             joinSocketToChat(chatIdForClient, requestedType, chatName, chatDbId);

             // --- Fetch Message History ---
             const recentMessages = await getRecentMessages(chatDbId);

             // --- Fetch User List (for rooms only) ---
             let usersInRoomData = [];
             if (requestedType === 'room') {
                  const roomInfo = activeChats.get(chatIdForClient);
                   if (roomInfo && roomInfo.members.size > 0) {
                       try {
                            const memberObjectIds = Array.from(roomInfo.members).map(id => new mongoose.Types.ObjectId(id));
                            const users = await User.find({ _id: { $in: memberObjectIds }})
                                .select('username avatarUrl status').lean();
                            usersInRoomData = users.map(formatUserForClient).filter(u => u !== null);
                       } catch(err) {
                           console.error(`Error fetching user list for room ${chatIdForClient}:`, err);
                       }
                   }
             }

             // --- Send Confirmation and Data to Client ---
             socket.emit('joined chat', {
                 chat: { type: requestedType, id: chatIdForClient, name: chatName, avatarUrl: chatAvatarUrl },
                 users: usersInRoomData, // Empty array for DMs
                 messages: recentMessages,
                 isNew: isNew // Only true if a room was created
             });

         } catch (error) {
             console.error(`❌ Error joining/creating ${requestedType} ${requestedId} for ${username}:`, error);
             sendError(`Failed to join chat: ${error.message || 'Server error'}`);
             // Attempt to clear potentially inconsistent state if join failed midway?
             // leaveCurrentChat(); // Might be needed if some state was set before error
         }
    });


    socket.on('initiate dm', async (targetUserId) => {
         console.log(`=> ${username} requests to initiate DM with user ID: ${targetUserId}`);
         if (!targetUserId || targetUserId === userId) {
             return sendError("Invalid target user for DM.");
         }
         if (!mongoose.Types.ObjectId.isValid(targetUserId)) {
              return sendError("Invalid target user ID format.");
         }

         try {
             // --- Ensure Target User Exists ---
             const targetUser = await User.findById(targetUserId).select('username avatarUrl status').lean();
             if (!targetUser) {
                 return sendError("The user you tried to message does not exist.");
             }
             const targetUserDetails = formatUserForClient(targetUser);

             // --- Find or Create the DM Room ---
             const { room: dmRoom, isNew } = await Room.findOrCreateDirectMessage(userId, targetUserId);
             const dmRoomId = dmRoom._id.toString();
             const dmDbId = dmRoom._id;

             console.log(`   DM Room ID: ${dmRoomId} (isNew: ${isNew})`);

              // --- Ensure Chat is in ActiveChats Map ---
             if (!activeChats.has(dmRoomId)) {
                  activeChats.set(dmRoomId, {
                       name: targetUserDetails.username, // Store target username as name for convenience
                       type: 'direct',
                       dbId: dmDbId,
                       members: new Set([userId, targetUserId]) // Add both participants
                   });
                   console.log(`   Initialized DM ${dmRoomId} in active chats memory.`);
             } else {
                  // Ensure both users are in the members set if chat already existed in memory
                  activeChats.get(dmRoomId).members.add(userId);
                  activeChats.get(dmRoomId).members.add(targetUserId);
             }

             // --- Join Initiator to the DM Room ---
             leaveCurrentChat(); // Leave previous chat first
             joinSocketToChat(dmRoomId, 'direct', targetUserDetails.username, dmDbId);

             // --- Send Join Confirmation & History to Initiator ---
             const recentMessages = await getRecentMessages(dmDbId);
             socket.emit('joined chat', {
                 chat: { type: 'direct', id: dmRoomId, name: targetUserDetails.username, avatarUrl: targetUserDetails.avatarUrl },
                 messages: recentMessages,
                 isNew: isNew // Let client know if they effectively "created" the DM
             });

             // --- Notify the Target User (if they are online) ---
             const targetSockets = userSockets.get(targetUserId);
             if (targetSockets && targetSockets.size > 0) {
                 console.log(`   Notifying target user ${targetUserDetails.username} (${targetUserId}) about DM.`);
                 const initiatorUserDetails = formatUserForClient(user);
                 const dmListDataForTarget = {
                     dmRoomId: dmRoomId,
                     otherUser: initiatorUserDetails,
                     lastMessageTimestamp: dmRoom.lastActivity?.toISOString(),
                     hasUnread: isNew
                 };

                 targetSockets.forEach(targetSocketId => {
                      io.to(targetSocketId).emit('dm list update', [dmListDataForTarget]); // Send as array
                 });
             } else {
                  console.log(`   Target user ${targetUserDetails.username} is offline, cannot send live DM notification.`);
             }

         } catch (error) {
              console.error(`❌ Error initiating DM between ${username} and ${targetUserId}:`, error);
              sendError(`Failed to start DM: ${error.message || 'Server error'}`);
              // If client UI has a joining state, need to signal failure
              // setJoiningState(false); // Client needs to handle error message and reset UI
         }
    });


    socket.on('chat message', async (msgData) => {
         const socketData = connectedSockets.get(socketId);

         // --- Basic Validation ---
         if (!socketData || !socketData.currentChatId || !socketData.currentChatType) {
             return sendError("Cannot send message: You are not currently in a chat.");
         }
         if (!msgData || typeof msgData.text !== 'string' || !msgData.chat) {
             return sendError("Invalid message format received.");
         }
         // Ensure message is for the chat the socket is actually in
         if (msgData.chat.type !== socketData.currentChatType || msgData.chat.id !== socketData.currentChatId) {
             console.warn(`User ${username} sent message for chat ${msgData.chat.id} but is in ${socketData.currentChatId}`);
             return sendError("Message target mismatch. Please rejoin the chat.");
         }

         const messageText = msgData.text.trim();
         const chatId = socketData.currentChatId; // roomName or dmRoomId string
         const chatType = socketData.currentChatType;

         if (!messageText || messageText.length > MAX_MESSAGE_LENGTH) {
             return sendError(`Message is empty or too long (max ${MAX_MESSAGE_LENGTH} chars).`);
         }

         // --- Process and Save Message ---
         try {
              // Find the chat document's DB ID from activeChats map
              const chatInfo = activeChats.get(chatId);
              let chatDbId;
              if (chatInfo && chatInfo.dbId) {
                   chatDbId = chatInfo.dbId;
              } else {
                   // Attempt to refetch from DB if missing from memory (less ideal but fallback)
                   console.warn(`Chat info or DB ID missing for active chat ${chatId}. Refetching...`);
                   const refetchedRoom = chatType === 'room'
                        ? await Room.findOne({ type: 'public', name: chatId }).select('_id').lean()
                        : await Room.findById(chatId).select('_id').lean();
                   if (!refetchedRoom) throw new Error(`Chat room not found in database: ${chatId}`);
                   chatDbId = refetchedRoom._id;
                   // Optionally update activeChats map here if needed
                   if (chatInfo) chatInfo.dbId = chatDbId; else console.warn("Refetched chatDbId but chatInfo still missing from activeChats.");
              }

             console.log(`📩 [${chatType}:${chatId}] ${username}: ${messageText.substring(0, 50)}...`);

             // Create and save the message document
             const newMessage = new Message({
                 text: messageText,
                 sender: userId,
                 chat: chatDbId, // Reference the Room document's ObjectId
             });
             const savedMessage = await newMessage.save();

             // --- Update Chat's Last Activity ---
             // Use `findByIdAndUpdate` for efficiency
             const updatedRoom = await Room.findByIdAndUpdate(chatDbId, { lastActivity: savedMessage.createdAt }, { new: true }).lean();
             if (!updatedRoom) console.warn(`Could not update lastActivity for chat ${chatDbId}`);

             // --- Populate Sender Details for Broadcast ---
             const populatedMessage = await Message.findById(savedMessage._id)
                   .populate('sender', 'username avatarUrl status')
                   .lean();

             if (!populatedMessage || !populatedMessage.sender) {
                  // Should not happen if sender ID was valid, but good check
                  console.error(`Failed to populate sender details for message ${savedMessage._id}`);
                  // Maybe send without full sender details? Or send error?
                  // For now, log error and continue, sender block might be missing/basic on client
                  populatedMessage.sender = { id: userId, username: username, avatarUrl: user.avatarUrl, status: user.status }; // Fallback
             }

             // Prepare broadcast data structure
             const broadcastData = {
                 sender: formatUserForClient(populatedMessage.sender), // Use formatter
                 text: populatedMessage.text,
                 timestamp: populatedMessage.createdAt.toISOString(),
                 chat: { type: chatType, id: chatId } // Use client-facing chatId
             };

             // --- Broadcast to Socket.IO Room ---
             console.log(`   Broadcasting message to room ${chatId}`);
             io.to(chatId).emit('chat message', broadcastData);

             // --- Update DM List for Participants (if DM) ---
             if (chatType === 'direct' && updatedRoom) {
                  const participants = updatedRoom.participants.map(p => p.toString());
                  participants.forEach(async (participantId) => { // Use async if fetching user data inside
                       const targetSockets = userSockets.get(participantId);
                       if (targetSockets && targetSockets.size > 0) {
                           // Determine the "other" user from this participant's perspective
                           let otherUserDetails;
                           if (participantId === userId) { // Recipient's perspective
                               otherUserDetails = formatUserForClient(populatedMessage.sender);
                           } else { // Sender's perspective (target is participantId)
                               otherUserDetails = formatUserForClient(await User.findById(participantId).select('username avatarUrl status').lean());
                           }

                            const dmListData = {
                                dmRoomId: chatId,
                                otherUser: otherUserDetails,
                                lastMessageTimestamp: populatedMessage.createdAt.toISOString(),
                                // Mark as unread *only* for the recipient(s) of the message
                                hasUnread: participantId !== userId
                            };
                           // Send update to all sockets of this participant
                            targetSockets.forEach(targetSocketId => {
                                io.to(targetSocketId).emit('dm list update', [dmListData]);
                            });
                       }
                  });
             }

         } catch (error) {
             console.error(`❌ Error saving/broadcasting message from ${username} in ${chatType} ${chatId}:`, error);
             sendError("Server error: Could not send your message.");
         }
    });

    // --- Typing Indicators ---
    socket.on('typing', (data) => {
         const socketData = connectedSockets.get(socketId);
         // Validate that socket is in the chat it claims to be typing in
         if (socketData?.currentChatId && data?.chat?.id === socketData.currentChatId) {
             // Broadcast to the current chat room, excluding the sender
             // console.log(` Typing: ${username} in ${socketData.currentChatId}`);
             socket.to(socketData.currentChatId).emit('typing', {
                  userId,
                  username,
                  chat: { type: socketData.currentChatType, id: socketData.currentChatId }
              });
         } else {
              // console.warn(`${username} sent 'typing' for wrong chat (${data?.chat?.id} vs ${socketData?.currentChatId})`);
         }
    });

    socket.on('stop typing', (data) => {
          const socketData = connectedSockets.get(socketId);
           // Validate that socket is in the chat it claims to be stopping typing in
          if (socketData?.currentChatId && data?.chat?.id === socketData.currentChatId) {
             // Broadcast to the current chat room, excluding the sender
              // console.log(` Stop Typing: ${username} in ${socketData.currentChatId}`);
             socket.to(socketData.currentChatId).emit('stop typing', {
                  userId,
                  chat: { type: socketData.currentChatType, id: socketData.currentChatId }
              });
         } else {
             // console.warn(`${username} sent 'stop typing' for wrong chat (${data?.chat?.id} vs ${socketData?.currentChatId})`);
         }
    });

    // --- Status Update ---
     socket.on('set status', async (data) => {
          if (!data || !data.status) return sendError("Invalid status update data.");

          const validStatuses = ['online', 'away', 'dnd']; // 'offline' handled by disconnect
          const newStatus = validStatuses.includes(data.status) ? data.status : 'online'; // Default to online if invalid
          // Trim and limit status message length
          const newStatusMessage = (typeof data.statusMessage === 'string' ? data.statusMessage : '').trim().slice(0, 60);

          try {
               // Update status and message in the database
               const updatePayload = { $set: { status: newStatus, statusMessage: newStatusMessage, lastSeen: new Date() } };
               const options = { new: true, select: 'status statusMessage lastSeen' }; // Return only updated fields + needed lastSeen
               const updatedUser = await User.findByIdAndUpdate(userId, updatePayload, options).lean(); // Use lean

                if (!updatedUser) {
                     // This should ideally not happen if the user authenticated correctly
                     console.error(`Failed to update status for user ${userId}: Not found in DB.`);
                     return sendError("Failed to update status: User not found.");
                }

               console.log(`   ${username} updated status to ${newStatus}` + (newStatusMessage ? ` ("${newStatusMessage}")` : ''));

               // Update local user object state attached to the socket for consistency
               // Ensure socket.user remains a plain object if necessary
               socket.user.status = newStatus;
               socket.user.statusMessage = newStatusMessage;
               socket.user.lastSeen = updatedUser.lastSeen;

               // Broadcast presence update to relevant users (using shared function)
                broadcastPresenceUpdate(io, state, userId, {
                     status: newStatus,
                     statusMessage: newStatusMessage,
                     lastSeen: updatedUser.lastSeen.toISOString() // Send ISO string
                 });

                // Optionally send confirmation back to the originating client
                // sendInfo("Status updated successfully.", "success");

          } catch (error) {
               console.error(`❌ Error setting status for ${username}:`, error);
               sendError("Failed to update status on server.");
          }
     });


    // --- Disconnect Handler ---
    socket.on('disconnect', async (reason) => {
        console.log(`🔌 User disconnected: ${username} (Socket: ${socketId}). Reason: ${reason}`);

        // --- Leave Current Chat (if any) ---
        // This handles leaving the Socket.IO room and broadcasting user list updates for rooms
         leaveCurrentChat();

        // --- Update Server Connection State ---
        const userSocketSet = userSockets.get(userId);
        let wasLastConnection = false;
        if (userSocketSet) {
             userSocketSet.delete(socketId); // Remove this socket from the user's set
             if (userSocketSet.size === 0) {
                  // This was the last active socket for this user
                  userSockets.delete(userId); // Remove user from the online map
                  wasLastConnection = true;
                  console.log(`   ${username} is now offline (last connection closed).`);
             } else {
                   console.log(`   ${username} still has ${userSocketSet.size} other connection(s).`);
             }
        } else {
             // This indicates a potential state inconsistency
             console.warn(`   User socket set not found for ${userId} on disconnect.`);
        }

        connectedSockets.delete(socketId); // Remove this specific socket's data

        // --- Update DB Status and Broadcast Presence (only if last connection) ---
        if (wasLastConnection) {
             try {
                  // Update user status to offline in DB
                  const offlineUpdate = { $set: { status: 'offline', lastSeen: new Date() } };
                   // Select lastSeen to ensure we broadcast the correct time
                  const updatedUser = await User.findByIdAndUpdate(userId, offlineUpdate, { new: true, select: 'lastSeen' }).lean();

                  if (updatedUser) {
                        // Broadcast final offline status and lastSeen timestamp
                         broadcastPresenceUpdate(io, state, userId, {
                              status: 'offline',
                              lastSeen: updatedUser.lastSeen.toISOString()
                          });
                        console.log(`   Updated DB status for ${username} to offline.`);
                  } else {
                       // User might have been deleted between connection and disconnection
                       console.warn(`   User ${userId} not found in DB when trying to set offline status on disconnect.`);
                  }
             } catch (dbError) {
                  console.error(`   ❌ Error updating user status to offline for ${username}:`, dbError);
             }
        }
        // --- End Disconnect Handling ---
    });

    // --- Socket Error Handler (for errors on this specific socket) ---
    socket.on('error', (error) => {
        // This catches errors emitted by the socket itself or potentially from middleware errors not caught elsewhere
        console.error(`❗️ Socket Error for ${username} (${socketId}):`, error.message || error);
        // Consider disconnecting the socket on certain severe errors
        // socket.disconnect(true);
    });

    // console.log(`   Registered event listeners for ${username} (${socketId})`);
}; // End module export function