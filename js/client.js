/**
 * client.js
 *
 * Frontend logic for the advanced real-time chat application.
 * Refined for robustness and clarity.
 */

(function() {
    'use strict';

    // --- State Variables ---
    let socket = null;
    let currentUser = null; // Stores { id, username, email, avatarUrl, status, statusMessage, token, createdAt, lastSeen }
    let currentChat = { type: null, id: null, name: null }; // type: 'room' or 'dm', id: roomName or dmRoomId, name: display name
    let joinedRooms = new Map(); // Map<roomId(name), { name: string, type: 'room', hasUnread: boolean }>
    let directMessages = new Map(); // Map<dmRoomId(string), { otherUserId: string, otherUsername: string, avatarUrl: string, status: string, hasUnread: boolean, lastMessageTimestamp?: string }>
    let usersInCurrentRoom = new Map(); // Map<userId, { username, avatarUrl, status }> - For the active public room
    let typingTimeout = null;
    let isTyping = false;
    const TYPING_TIMER_LENGTH = 1500; // ms
    let currentTypingUsers = new Map(); // Map<userId, username> typing in the *current* chat

    // --- DOM Element References ---
    const loadingOverlay = document.getElementById('loading-overlay');
    const loadingText = loadingOverlay?.querySelector('span');

    // Auth Elements
    const authContainer = document.getElementById('auth-container');
    const loginView = document.getElementById('login-view');
    const registerView = document.getElementById('register-view');
    const forgotPasswordView = document.getElementById('forgot-password-view');
    const resetPasswordView = document.getElementById('reset-password-view');
    const loginForm = document.getElementById('login-form');
    const registerForm = document.getElementById('register-form');
    const forgotPasswordForm = document.getElementById('forgot-password-form');
    const resetPasswordForm = document.getElementById('reset-password-form');
    const authErrorGeneral = document.getElementById('auth-error-general'); // General auth errors outside forms
    const loginEmailInput = document.getElementById('login-email');
    const loginPasswordInput = document.getElementById('login-password');
    const registerUsernameInput = document.getElementById('register-username');
    const registerEmailInput = document.getElementById('register-email');
    const registerPasswordInput = document.getElementById('register-password');
    const forgotEmailInput = document.getElementById('forgot-email');
    const resetPasswordInput = document.getElementById('reset-password');
    const resetTokenInput = document.getElementById('reset-token'); // Hidden input

    // Chat Container Elements
    const appContainer = document.getElementById('app-container'); // Outer container
    const chatContainer = document.getElementById('chat-container'); // Main chat area (hidden initially)
    const userInfoHeader = document.getElementById('user-info-header');
    const userAvatarHeader = document.getElementById('user-avatar-header');
    const usernameHeader = document.getElementById('username-header');
    const logoutButton = document.getElementById('logout-button');

    // Sidebar Elements
    const roomList = document.getElementById('room-list');
    const dmList = document.getElementById('dm-list');
    const userList = document.getElementById('user-list'); // Users in current *public* room
    const onlineCountSpan = document.getElementById('online-count'); // Count for current public room
    const roomNameInput = document.getElementById('room-name-input');
    const joinRoomButton = document.getElementById('join-room-button');
    const roomErrorElement = document.getElementById('room-error');

    // Chat Window Elements
    const chatWindow = document.getElementById('chat-window');
    const currentChatHeader = document.getElementById('current-chat-header');
    const currentChatAvatar = document.getElementById('current-chat-avatar'); // For DMs
    const currentChatNameSpan = document.getElementById('current-chat-name');
    const messagesList = document.getElementById('messages');
    const typingIndicator = document.getElementById('typing-indicator');
    const messageForm = document.getElementById('message-form');
    const messageInput = document.getElementById('message-input');
    const messageSendButton = messageForm?.querySelector('button');
    const noChatMessage = document.getElementById('no-chat-message');

    // Footer
    const connectionStatus = document.getElementById('connection-status');
    const statusIndicator = document.getElementById('status-indicator');

    // Modals
    const profileModal = document.getElementById('profile-modal');
    const closeProfileModal = document.getElementById('close-profile-modal');
    const profileInfo = document.getElementById('profile-info');
    const profileAvatar = document.getElementById('profile-avatar');
    const profileUsername = document.getElementById('profile-username');
    const profileEmail = document.getElementById('profile-email');
    const profileJoined = document.getElementById('profile-joined');
    const profileLastSeen = document.getElementById('profile-last-seen');
    const profileStatusMsg = document.getElementById('profile-status-message');
    const avatarUploadForm = document.getElementById('avatar-upload-form');
    const avatarFileInput = document.getElementById('avatar-file-input');
    const avatarUploadMessage = document.getElementById('avatar-upload-message'); // For upload feedback
    const statusUpdateForm = document.getElementById('status-update-form');
    const statusSelect = document.getElementById('status-select');
    const statusMessageInput = document.getElementById('status-message-input');
    const statusUpdateButton = statusUpdateForm?.querySelector('button');
    const statusUpdateMessage = document.getElementById('status-update-message'); // For status update feedback


    // --- Initialization ---
    function initialize() {
        console.log('Client script initializing.');
        showLoading(true, "Initializing...");
        setupEventListeners();
        updateConnectionStatus('Initializing...', '');

        // Check for reset password token in URL first
        const urlParams = new URLSearchParams(window.location.search);
        const resetToken = urlParams.get('token');
        if (resetToken) {
            console.log("Password reset token found in URL.");
            showView('auth');
            switchAuthView('reset-password-view');
            resetTokenInput.value = resetToken; // Populate hidden input
            // Clean the URL
            history.replaceState(null, '', window.location.pathname);
            showLoading(false);
        } else {
            // Standard auth check
            checkAuthToken();
        }
    }

    function setupEventListeners() {
        // Auth Links & Forms
        authContainer?.addEventListener('click', handleAuthLinkClick);
        loginForm?.addEventListener('submit', handleLogin);
        registerForm?.addEventListener('submit', handleRegister);
        forgotPasswordForm?.addEventListener('submit', handleForgotPassword);
        resetPasswordForm?.addEventListener('submit', handleResetPassword);
        logoutButton?.addEventListener('click', handleLogout);

        // Chat Interactions
        messageForm?.addEventListener('submit', handleSendMessage);
        messageInput?.addEventListener('input', handleTypingInput);
        // Stop typing when input loses focus or form is submitted (handled in sendMessage)
        messageInput?.addEventListener('blur', () => { if (isTyping) sendStopTyping(); });
        joinRoomButton?.addEventListener('click', handleJoinOrCreateRoomRequest);
        roomNameInput?.addEventListener('keypress', (e) => { if (e.key === 'Enter') { e.preventDefault(); handleJoinOrCreateRoomRequest();} });

        // Sidebar Clicks (using event delegation)
        roomList?.addEventListener('click', handleRoomListClick);
        dmList?.addEventListener('click', handleDMListClick);
        userList?.addEventListener('click', handleUserListClick); // For starting DMs / viewing profiles?

        // Modals & Profile
        userAvatarHeader?.addEventListener('click', openProfileModal); // Open own profile
        closeProfileModal?.addEventListener('click', closeProfileModalFunc);
        window.addEventListener('click', (event) => { // Close modal if clicked outside content
            if (event.target == profileModal) closeProfileModalFunc();
        });
        avatarUploadForm?.addEventListener('submit', handleAvatarUpload);
        // Trigger status update on button click or select change
        statusUpdateButton?.addEventListener('click', handleStatusUpdate);
        statusSelect?.addEventListener('change', handleStatusUpdate);
        statusMessageInput?.addEventListener('keypress', (e) => { if (e.key === 'Enter') { e.preventDefault(); handleStatusUpdate();} });


        // Window Focus/Blur for Presence and Unread Markers
        window.addEventListener('focus', handleWindowFocus);
        window.addEventListener('blur', handleWindowBlur); // Optional: could set status to 'away' automatically

        // Clean up socket on page unload
        window.addEventListener('beforeunload', () => {
            if (socket && socket.connected) {
                console.log("Disconnecting socket before page unload.");
                // Send final presence update? Might not complete reliably.
                // socket.emit('set status', { status: 'offline' }); // Unreliable
                socket.disconnect();
            }
        });
    }

    // --- Loading State ---
    function showLoading(isLoading, message = "Loading...") {
        if (loadingOverlay) {
            loadingOverlay.style.display = isLoading ? 'flex' : 'none';
            if (loadingText) loadingText.textContent = message;
        }
    }

    // --- Utility: Display Messages in UI ---
    function displayMessage(element, message, type = 'error') {
        if (!element) return;
        element.textContent = message;
        element.className = `message-box ${type}`; // Use CSS classes for styling
        element.style.display = message ? 'block' : 'none'; // Show/hide based on message content
    }

    function clearMessageBox(element) {
         if (element) {
             element.textContent = '';
             element.style.display = 'none';
         }
    }

    // --- Authentication ---

    function checkAuthToken() {
        const token = localStorage.getItem('authToken');
        if (token) {
            console.log('Found auth token, attempting to verify...');
            showLoading(true, "Verifying session...");
            fetchUserData(token);
        } else {
            console.log('No auth token found.');
            showView('auth'); // Show auth container (default to login)
            switchAuthView('login-view');
            showLoading(false);
        }
    }

    async function fetchUserData(token) {
         // Uses /api/auth/me which is protected by protectRoute
         try {
             const response = await fetch('/api/auth/me', {
                 method: 'GET',
                 headers: { 'Authorization': `Bearer ${token}` }
             });
             const data = await response.json();

             if (response.ok && data.success && data.user) {
                 console.log('User data verified successfully:', data.user.username);
                 // Store user data including the token locally
                 currentUser = { ...data.user, token: token };
                 initializeAppUI(); // Setup UI for logged-in user
                 connectWebSocket(); // Connect WebSocket *after* getting user data
             } else {
                 console.warn('Token verification failed:', data.error || `Status ${response.status}`);
                 clearAuthToken(); // Invalid token, clear it
                 showView('auth');
                 switchAuthView('login-view');
                 displayMessage(authErrorGeneral, data.error || 'Session expired or invalid. Please log in.');
                 showLoading(false);
             }
         } catch (error) {
             console.error('Network error fetching user data:', error);
             clearAuthToken();
             showView('auth');
             switchAuthView('login-view');
             displayMessage(authErrorGeneral, 'Network error. Could not verify session.');
             showLoading(false);
         }
         // Note: showLoading(false) is called within connectWebSocket success/error handlers
    }


    function handleAuthLinkClick(event) {
        if (event.target.tagName === 'A' && event.target.dataset.view) {
            event.preventDefault();
            const viewId = event.target.dataset.view;
            switchAuthView(viewId);
        }
    }

    async function handleApiAuthRequest(url, body, formElement) {
        const errorElement = formElement?.querySelector('.message-box.error');
        const successElement = formElement?.querySelector('.message-box.success');
        clearMessageBox(errorElement);
        clearMessageBox(successElement);
        showLoading(true, "Processing...");

        try {
            const response = await fetch(url, {
                method: body ? 'POST' : 'GET', // Adjust method based on presence of body
                headers: { 'Content-Type': 'application/json' },
                body: body ? JSON.stringify(body) : null
            });
            const data = await response.json();

            showLoading(false);

            if (response.ok && data.success) {
                return { success: true, data: data }; // Return success and data
            } else {
                 // Handle specific validation errors array
                 let errorMsg = data.error || 'An unknown error occurred.';
                 if (data.errors && Array.isArray(data.errors)) {
                     errorMsg = data.errors.map(e => `${e.field}: ${e.message}`).join(' ');
                 }
                 console.error(`API Error (${url}):`, errorMsg);
                 displayMessage(errorElement, errorMsg, 'error');
                 return { success: false, error: errorMsg };
            }
        } catch (error) {
            console.error(`Network error during API request (${url}):`, error);
            displayMessage(errorElement, 'Network error. Please try again.', 'error');
            showLoading(false);
            return { success: false, error: 'Network error' };
        }
    }


    async function handleLogin(event) {
        event.preventDefault();
        const email = loginEmailInput.value.trim();
        const password = loginPasswordInput.value.trim();
        if (!email || !password) {
            displayMessage(loginForm.querySelector('.message-box.error'), 'Please enter both email and password.', 'error');
            return;
        }

        const result = await handleApiAuthRequest('/api/auth/login', { email, password }, loginForm);

        if (result.success) {
            console.log('Login successful');
            setAuthToken(result.data.token);
            currentUser = { ...result.data.user, token: result.data.token }; // Store user data
            initializeAppUI();
            connectWebSocket(); // Connect after successful login
        }
        // Error messages are handled within handleApiAuthRequest
    }

    async function handleRegister(event) {
        event.preventDefault();
        const username = registerUsernameInput.value.trim();
        const email = registerEmailInput.value.trim();
        const password = registerPasswordInput.value.trim();

        // Basic client checks (server validates more thoroughly)
        if (!username || !email || !password) {
            displayMessage(registerForm.querySelector('.message-box.error'), 'Please fill in all fields.', 'error'); return;
        }
        if (password.length < 6) {
            displayMessage(registerForm.querySelector('.message-box.error'), 'Password must be at least 6 characters.', 'error'); return;
        }
        if (!/^[a-zA-Z0-9_-]+$/.test(username)) {
             displayMessage(registerForm.querySelector('.message-box.error'), 'Invalid username format.', 'error'); return;
        }


        const result = await handleApiAuthRequest('/api/auth/register', { username, email, password }, registerForm);

        if (result.success) {
             console.log('Registration successful');
             setAuthToken(result.data.token);
             currentUser = { ...result.data.user, token: result.data.token }; // Store user data
             initializeAppUI();
             connectWebSocket(); // Connect after successful registration
        }
    }

     async function handleForgotPassword(event) {
         event.preventDefault();
         const email = forgotEmailInput.value.trim();
          if (!email) {
             displayMessage(forgotPasswordForm.querySelector('.message-box.error'), 'Please enter your email address.', 'error'); return;
         }

         const result = await handleApiAuthRequest('/api/auth/forgotpassword', { email }, forgotPasswordForm);

         if (result.success) {
             displayMessage(forgotPasswordForm.querySelector('.message-box.success'), result.data.message || "Password reset email sent (if account exists).", 'success');
             forgotPasswordForm.reset();
             // Optionally switch back to login view after a delay
             // setTimeout(() => switchAuthView('login-view'), 5000);
         }
     }

     async function handleResetPassword(event) {
         event.preventDefault();
         const newPassword = resetPasswordInput.value;
         const resetToken = resetTokenInput.value; // Get token from hidden input

         if (!newPassword || newPassword.length < 6) {
             displayMessage(resetPasswordForm.querySelector('.message-box.error'), "Password must be at least 6 characters long.", 'error'); return;
         }
         if (!resetToken) {
             displayMessage(resetPasswordForm.querySelector('.message-box.error'), "Invalid or missing reset token. Please use the link from your email again.", 'error'); return;
         }

         showLoading(true, "Resetting password...");
          try {
             const response = await fetch(`/api/auth/resetpassword/${resetToken}`, {
                 method: 'PUT', // Use PUT for password reset
                 headers: { 'Content-Type': 'application/json' },
                 body: JSON.stringify({ password: newPassword })
             });
             const data = await response.json();

             showLoading(false);

             if (response.ok && data.success) {
                 displayMessage(loginForm.querySelector('.message-box.success'), "Password reset successfully! Please log in.", 'success'); // Show success on login form
                 resetPasswordForm.reset();
                 resetTokenInput.value = '';
                 switchAuthView('login-view'); // Go to login
             } else {
                  displayMessage(resetPasswordForm.querySelector('.message-box.error'), data.error || "Failed to reset password. Token might be invalid or expired.", 'error');
             }
         } catch (error) {
             console.error('Reset password error:', error);
             displayMessage(resetPasswordForm.querySelector('.message-box.error'), "Network or server error during password reset.", 'error');
             showLoading(false);
         }
     }

    function handleLogout() {
        console.log('Logging out...');
        if (socket && socket.connected) {
            // Optionally notify server (e.g., for immediate presence update, though disconnect handles it)
            // socket.emit('manual logout'); // If server needs explicit notification
            socket.disconnect(); // Disconnect the socket
        }
        clearAuthToken();
        currentUser = null;
        socket = null; // Clear socket reference
        resetUI(); // Reset UI to initial logged-out state
        showView('auth');
        switchAuthView('login-view');
        clearAllMessageBoxes(authContainer); // Clear any lingering auth messages
    }

    function setAuthToken(token) {
        try {
             localStorage.setItem('authToken', token);
        } catch (e) {
             console.error("Failed to set auth token in localStorage:", e);
             displayMessage(authErrorGeneral, "Could not save session. Please ensure cookies/localStorage are enabled.", 'error');
        }
    }

    function clearAuthToken() {
         try {
            localStorage.removeItem('authToken');
         } catch (e) {
              console.error("Failed to clear auth token from localStorage:", e);
         }
    }

    function getToken() {
         // Get token from currentUser first, fallback to localStorage (though should usually be in sync)
         return currentUser?.token || localStorage.getItem('authToken');
    }

    // --- UI Management ---

    function initializeAppUI() {
        if (!currentUser) return;
        console.log("Initializing UI for logged-in user:", currentUser.username);
        // Update header
        usernameHeader.textContent = currentUser.username;
        userAvatarHeader.src = currentUser.avatarUrl || '/uploads/avatars/default.png'; // Use default if missing
        userAvatarHeader.alt = `${currentUser.username}'s avatar`;

        // Show chat, hide auth
        showView('chat');
        // Set initial status in profile modal
        statusSelect.value = currentUser.status || 'online'; // Default to online if undefined
        statusMessageInput.value = currentUser.statusMessage || '';

        // Reset chat area state
        setCurrentChat(null, null, null); // No chat selected initially
        updateUIForNoChat(); // Display placeholder, disable input
        clearChatLists(); // Clear sidebar lists before getting updates
    }

    function showView(viewName) {
        if (authContainer) authContainer.style.display = 'none';
        if (chatContainer) chatContainer.style.display = 'none';

        if (viewName === 'auth') {
            if (authContainer) authContainer.style.display = 'flex';
        } else if (viewName === 'chat') {
            if (chatContainer) chatContainer.style.display = 'flex';
        }
    }

    function switchAuthView(viewId) {
        // Hide all auth views first
        loginView.style.display = 'none';
        registerView.style.display = 'none';
        forgotPasswordView.style.display = 'none';
        resetPasswordView.style.display = 'none';
        // Clear messages in all auth forms
        clearAllMessageBoxes(authContainer);

        // Show the requested view
        const viewToShow = document.getElementById(viewId);
        if (viewToShow) {
            viewToShow.style.display = 'flex';
        } else {
            console.warn(`Auth view ID "${viewId}" not found, defaulting to login.`);
            loginView.style.display = 'flex'; // Default to login if ID invalid
        }
    }


    function disableChatInput(disabled = true, placeholder = "Select a conversation") {
        if (messageInput) {
            messageInput.disabled = disabled;
            messageInput.placeholder = placeholder;
        }
        if (messageSendButton) messageSendButton.disabled = disabled;
    }

    function displayNoChatMessage(show = true) {
        if (noChatMessage) noChatMessage.style.display = show ? 'flex' : 'none';
        // Hide messages list and typing indicator when placeholder is shown
        if (messagesList) messagesList.style.display = show ? 'none' : 'flex';
        if (typingIndicator) typingIndicator.style.display = show ? 'none' : 'block'; // Controlled by updateTypingIndicatorUI
    }

    function resetUI() {
        // Called on logout or fatal connection error
        console.log("Resetting UI to logged-out state.");
        usernameHeader.textContent = '';
        userAvatarHeader.src = '/uploads/avatars/default.png';
        clearChatLists();
        clearChatArea();
        onlineCountSpan.textContent = '0';
        currentChat = { type: null, id: null, name: null };
        joinedRooms.clear();
        directMessages.clear();
        usersInCurrentRoom.clear();
        clearTypingIndicator();
        updateCurrentChatHeader(); // Set header to 'None'
        updateUIForNoChat(); // Show placeholder, disable input
        updateConnectionStatus('Disconnected', 'disconnected');
    }

    function clearChatLists() {
         if (roomList) roomList.innerHTML = '';
         if (dmList) dmList.innerHTML = '';
         if (userList) userList.innerHTML = '';
    }

    function clearAllMessageBoxes(container) {
        const errorElements = container?.querySelectorAll('.message-box.error');
        const successElements = container?.querySelectorAll('.message-box.success');
        const infoElements = container?.querySelectorAll('.message-box.info');
        errorElements?.forEach(el => clearMessageBox(el));
        successElements?.forEach(el => clearMessageBox(el));
        infoElements?.forEach(el => clearMessageBox(el));
        clearMessageBox(authErrorGeneral); // Clear general auth error too
    }

    function displayRoomError(message) {
        if (roomErrorElement) {
            roomErrorElement.textContent = message;
            roomErrorElement.style.display = message ? 'block' : 'none';
        }
    }


    // --- WebSocket Connection & Core Listeners ---
    function connectWebSocket() {
        if (!currentUser || !currentUser.token) {
             console.error("Cannot connect WebSocket: User not authenticated or token missing.");
             showLoading(false);
             handleLogout(); // Force logout if essential data missing
             return;
        }
        if (socket && socket.connected) {
            console.log("Socket already connected.");
            showLoading(false); // Already connected, hide loading
            return;
        }

        console.log('Attempting WebSocket connection...');
        showLoading(true, "Connecting...");
        updateConnectionStatus('Connecting...', 'connecting');

        // Prevent multiple connection attempts if one is in progress
        if (socket && socket.connecting) {
            console.log("Socket connection attempt already in progress.");
            return;
        }

        // Disconnect any existing (potentially stale) socket instance first
        if (socket) {
             socket.disconnect();
             socket = null;
        }

        // Send token for authentication during handshake
        socket = io(window.location.origin, {
            auth: { token: currentUser.token },
            reconnectionAttempts: 5, // Limit automatic reconnection attempts
            reconnectionDelay: 1000, // Initial delay
            reconnectionDelayMax: 5000 // Max delay
        });

        setupSocketListeners();
    }

    function setupSocketListeners() {
        if (!socket) return;

        // --- Core Lifecycle Events ---
        socket.on('connect', handleConnect);
        socket.on('disconnect', handleDisconnect);
        socket.on('connect_error', handleConnectError);

        // --- Custom Application Events ---
        socket.on('initial data', handleInitialData); // Rooms, DMs, etc. upon connection
        socket.on('room list update', handleRoomListUpdate); // Updates to available public rooms
        socket.on('dm list update', handleDMListUpdate); // Updates/additions to user's DMs
        socket.on('joined chat', handleJoinedChat); // Confirmation after joining a room or DM
        socket.on('chat message', handleChatMessage); // Receiving a message in any joined chat
        socket.on('user list update', handleUserListUpdate); // Update user list for the *current* public room
        socket.on('presence update', handlePresenceUpdate); // User status/lastSeen changes globally
        socket.on('typing', handleUserTyping); // User starts typing in current chat
        socket.on('stop typing', handleUserStopTyping); // User stops typing in current chat
        socket.on('server message', handleServerMessage); // Generic info/success from server
        socket.on('error message', handleErrorMessage); // Specific errors from server actions

        // --- Reconnection Events (Optional but good for UX) ---
        socket.on('reconnect_attempt', (attempt) => {
             console.log(`Socket reconnect attempt ${attempt}...`);
             updateConnectionStatus(`Reconnecting (attempt ${attempt})...`, 'connecting');
             showLoading(true, `Connection lost. Reconnecting... (${attempt})`);
        });
        socket.on('reconnect', (attempt) => {
             console.log(`✅ Socket reconnected after ${attempt} attempts.`);
             updateConnectionStatus(`Reconnected as ${currentUser.username}`, 'connected');
             // Server should ideally re-send necessary state or client should request it
             // The 'connect' event handler will likely run again.
             showLoading(false);
        });
        socket.on('reconnect_error', (error) => {
            console.error(`❌ Socket reconnection error: ${error.message}`);
            updateConnectionStatus(`Reconnection Failed`, 'auth-error');
            // Might need manual intervention or logout after several failures
            showLoading(false);
        });
        socket.on('reconnect_failed', () => {
            console.error('❌ Socket reconnection failed after multiple attempts.');
            updateConnectionStatus(`Reconnection Failed`, 'disconnected');
            displayMessage(authErrorGeneral, "Could not reconnect to the server. Please check your connection and refresh.", 'error');
            showLoading(false);
            // Consider logging out or prompting user action
            handleLogout(); // Force logout might be best
        });
    }

    // --- Socket Event Handlers ---
    function handleConnect() {
        console.log(`✅ WebSocket Connected: ${socket.id}`);
        // Update status *after* confirming connection and authentication (server side)
        // The server's 'handleUserConnect' will manage DB status and presence broadcast
        updateConnectionStatus(`Connected as ${currentUser.username}`, 'connected');
        showLoading(false); // Connection successful
        // Server should send 'initial data' automatically after successful auth.
        // If not, client could request it here: socket.emit('request initial data');
    }

    function handleDisconnect(reason) {
        console.warn(`🔌 WebSocket Disconnected: ${reason}`);
        // Don't reset UI immediately if it's a temporary disconnect and auto-reconnect is enabled
        if (reason === 'io server disconnect') {
            // Server explicitly disconnected the client (e.g., auth error during session, kick/ban)
            updateConnectionStatus(`Disconnected by Server`, 'disconnected');
            addSystemMessageToCurrentChat("You were disconnected by the server.", 'error');
            handleLogout(); // Force logout if server kicks us
        } else if (reason === 'ping timeout') {
             updateConnectionStatus(`Disconnected (Timeout)`, 'disconnected');
             addSystemMessageToCurrentChat("Connection timed out. Attempting to reconnect...", 'error');
             // Reconnection attempts should start automatically
        } else if (reason === 'transport close' || reason === 'transport error') {
             updateConnectionStatus(`Disconnected (Network Issue)`, 'disconnected');
             addSystemMessageToCurrentChat(`Connection lost: ${reason}. Attempting to reconnect...`, 'error');
              // Reconnection attempts should start automatically
        } else {
             updateConnectionStatus(`Disconnected: ${reason}`, 'disconnected');
             addSystemMessageToCurrentChat(`Disconnected: ${reason}.`, 'error');
              // Assume potential permanent disconnect if reason is unknown or 'io client disconnect' (manual logout)
              // Let logout logic handle UI reset if needed.
        }
         // Clear typing indicators on disconnect
         clearTypingIndicator();
         // Mark current user state as potentially offline in UI (server handles DB)
         if (currentUser) currentUser.status = 'offline';
         updateUserPresenceInUI(currentUser?.id, 'offline'); // Update self in lists if present
    }

    function handleConnectError(error) {
        console.error(`❌ WebSocket Connection Error: ${error.message}`);
        updateConnectionStatus(`Connection Error`, 'auth-error');
        showLoading(false);
        // Check if it's an authentication error from the server's middleware
        if (error.message.startsWith('Authentication error')) {
             displayMessage(authErrorGeneral, `Authentication failed: ${error.message}. Please log in again.`, 'error');
             handleLogout(); // Force logout on auth failure
        } else {
            // Other connection errors (server down, network issues, CORS)
             displayMessage(authErrorGeneral, `Could not connect to the chat server: ${error.message}`, 'error');
             // Socket.IO client might attempt reconnection based on config
        }
    }

     function handleInitialData(data) {
         // data: { rooms: Array<{ name, hasUnread }>, dms: Array<{ dmRoomId, otherUser: { id, username, avatarUrl, status }, hasUnread, lastMessageTimestamp }> }
         console.log("Received initial data:", data);
         try {
             // Clear local state before applying initial data
             joinedRooms.clear();
             directMessages.clear();

             if (data.rooms && Array.isArray(data.rooms)) {
                 data.rooms.forEach(room => {
                    joinedRooms.set(room.name, { name: room.name, type: 'room', hasUnread: room.hasUnread || false });
                 });
                 updateRoomListUI(); // Update the UI list
             } else {
                 console.warn("No initial room data received.");
                 updateRoomListUI(); // Ensure list is cleared/empty
             }

             if (data.dms && Array.isArray(data.dms)) {
                 data.dms.forEach(dm => {
                     if (dm && dm.dmRoomId && dm.otherUser) { // Basic validation
                         directMessages.set(dm.dmRoomId, {
                             otherUserId: dm.otherUser.id,
                             otherUsername: dm.otherUser.username,
                             avatarUrl: dm.otherUser.avatarUrl || '/uploads/avatars/default.png',
                             status: dm.otherUser.status || 'offline',
                             hasUnread: dm.hasUnread || false,
                             lastMessageTimestamp: dm.lastMessageTimestamp
                         });
                     } else {
                          console.warn("Received invalid DM data structure:", dm);
                     }
                 });
                 updateDMListUI(); // Update the UI list (includes sorting)
             } else {
                 console.warn("No initial DM data received.");
                 updateDMListUI(); // Ensure list is cleared/empty
             }
         } catch (error) {
              console.error("Error processing initial data:", error);
              addSystemMessageToCurrentChat("Error loading initial chat lists.", "error");
         }
     }

    // --- Room & DM Management ---

    function handleJoinOrCreateRoomRequest() {
        if (!socket || !socket.connected) { displayRoomError("Not connected."); return; }
        const roomToJoin = roomNameInput.value.trim().toLowerCase();
        if (validateRoomName(roomToJoin)) {
            if (currentChat.type === 'room' && currentChat.id === roomToJoin) {
                 console.log("Already in this room.");
                 displayRoomError(''); // Clear any previous error
                 return;
            }
            console.log(`Requesting to join/create room: ${roomToJoin}`);
            displayRoomError(''); // Clear error
            setJoiningState(true);
            // Emit 'join chat' - server handles finding/creating room
            socket.emit('join chat', { type: 'room', id: roomToJoin });
            roomNameInput.value = '';
        }
    }

    function handleRoomListClick(event) {
        const li = event.target.closest('li[data-chat-type="room"]');
        if (li && li.dataset.roomId) {
            const roomToJoin = li.dataset.roomId;
            if (currentChat.type !== 'room' || currentChat.id !== roomToJoin) {
                 console.log(`Joining room from list: ${roomToJoin}`);
                 joinChat('room', roomToJoin);
            }
        }
    }

     function handleDMListClick(event) {
         const li = event.target.closest('li[data-chat-type="dm"]');
         if (li && li.dataset.roomId) {
             const dmRoomId = li.dataset.roomId;
             if (currentChat.type !== 'dm' || currentChat.id !== dmRoomId) {
                 console.log(`Joining DM from list: ${dmRoomId}`);
                 joinChat('dm', dmRoomId);
             }
         }
     }

     function handleUserListClick(event) {
        if (!socket || !socket.connected) { displayRoomError("Not connected."); return; }
         const li = event.target.closest('li[data-user-id]');
         if (li && li.dataset.userId) {
             const targetUserId = li.dataset.userId;
             if (targetUserId === currentUser?.id) {
                  openProfileModal(); // Clicked self - open profile
                  return;
             }
             console.log(`User list item clicked, initiating DM with user ID: ${targetUserId}`);

             // Find if DM already exists in our state
             const existingDM = findDMByUserId(targetUserId);
             if (existingDM) {
                  console.log(`Found existing DM (${existingDM.dmRoomId}), joining...`);
                  joinChat('dm', existingDM.dmRoomId);
             } else {
                  // If DM doesn't exist locally, ask server to initiate it
                  console.log(`No existing DM found locally, requesting server initiate DM...`);
                  setJoiningState(true, 'Starting DM...');
                  socket.emit('initiate dm', targetUserId);
             }
         }
     }

     function joinChat(type, id) {
          if (!socket || !socket.connected) {
               addSystemMessageToCurrentChat("Not connected to server.", "error");
               return;
          }
          if (!currentUser) {
               addSystemMessageToCurrentChat("Cannot join chat, not logged in.", "error");
               return;
          }
          if (!type || !id) {
               console.error("Invalid joinChat call - missing type or id.");
               return;
          }
          // Prevent joining the same chat again
          if (currentChat.type === type && currentChat.id === id) {
               console.log(`Already in ${type}: ${id}`);
               return;
          }

          console.log(`Requesting to join ${type}: ${id}`);
          setJoiningState(true, `Joining ${type === 'dm' ? 'conversation' : 'room'}...`);
          clearChatArea(); // Clear messages/users before switching
          socket.emit('join chat', { type, id });
     }

     function findDMByUserId(userId) {
         for (const [dmRoomId, dmData] of directMessages.entries()) {
             if (dmData.otherUserId === userId) {
                 return { dmRoomId, ...dmData }; // Return combined object
             }
         }
         return null;
     }

    function validateRoomName(name) {
        if (!name) { displayRoomError('Room name cannot be empty.'); return false; }
        if (name.length < 3 || name.length > 20) { displayRoomError('Room name must be 3-20 characters.'); return false; }
        // Allow only lowercase letters, numbers, hyphen, underscore
        if (!/^[a-z0-9-_]+$/.test(name)) { displayRoomError('Use only lowercase letters, numbers, -, _'); return false; }
        displayRoomError(''); // Clear error if valid
        return true;
    }

    function handleJoinedChat(data) {
        // data: { chat: { type: 'room'|'dm', id: string, name: string, avatarUrl?: string }, users?: Array<{id, username, avatarUrl, status}>, messages: Array<message>, isNew?: boolean }
        console.log("Joined chat response:", data);
        setJoiningState(false); // Clear joining state indicator

        if (!data || !data.chat || !data.chat.id || !data.chat.type) {
            console.error("Invalid 'joined chat' data received:", data);
            // Display error in the chat window system messages
            addSystemMessageToCurrentChat("Failed to join chat: Invalid data from server.", 'error');
            // If we were trying to join but failed, go back to 'no chat' state
            if (!currentChat.id) updateUIForNoChat();
            return;
        }

        const { chat, users, messages, isNew } = data;

        // --- Update Current Chat State ---
        setCurrentChat(chat.type, chat.id, chat.name, chat.avatarUrl);
        displayNoChatMessage(false); // Hide the "Select a conversation" placeholder

        // --- Load Messages ---
        messagesList.innerHTML = ''; // Clear previous messages
        if (Array.isArray(messages)) {
            console.log(`Loading ${messages.length} messages for ${chat.type} ${chat.name}`);
            messages.forEach(msg => addMessageToList(msg.sender, msg.text, msg.timestamp));
            scrollToBottom(messagesList); // Scroll down after loading history
        } else {
             console.warn("No message history received for", chat.name);
        }

        // --- Handle User List (Only for Public Rooms) ---
        usersInCurrentRoom.clear(); // Clear previous room's users map
        if (chat.type === 'room' && Array.isArray(users)) {
            updateUserListUI(users); // Populates usersInCurrentRoom map and updates UI list
        } else {
            updateUserListUI([]); // Clear UI list if it's a DM or no users array provided
        }

        // --- Update Sidebar State (Rooms/DMs) ---
        if (chat.type === 'room') {
             // Ensure this room exists in the local state
             if (!joinedRooms.has(chat.id)) {
                  joinedRooms.set(chat.id, { name: chat.name, type: 'room', hasUnread: false });
                  updateRoomListUI(); // Add to UI if it wasn't there
             } else {
                  // Mark as read if joining an existing room
                  markChatAsRead(chat.type, chat.id);
             }
        } else { // DM
             // Ensure this DM exists in the local state
             const dmData = directMessages.get(chat.id);
             if (!dmData) {
                 // This might happen if the *other* user initiated and we joined via notification/refresh
                 // We need the other user's info which should be in chat.name/avatarUrl
                 const otherUser = findUserInCurrentRoomList(chat.name); // Attempt to find from user list (unreliable here)
                  console.warn(`Joined DM ${chat.id} but no prior data found. Adding partial data.`);
                   directMessages.set(chat.id, {
                        otherUserId: "unknown", // We ideally need the server to send this reliably
                        otherUsername: chat.name,
                        avatarUrl: chat.avatarUrl || '/uploads/avatars/default.png',
                        status: 'offline', // Unknown status
                        hasUnread: false,
                        lastMessageTimestamp: null
                   });
                  updateDMListUI();
             }
              // Mark as read
              markChatAsRead(chat.type, chat.id);
        }
        updateActiveChatHighlight(); // Highlight in sidebar

        // --- Add System Message ---
        const joinMsg = isNew ? `You created and joined ${chat.name}` : `You joined ${chat.name}`;
        addSystemMessageToCurrentChat(joinMsg, 'success');

        // --- Enable Input ---
        enableChatInput();
        messageInput.focus();
    }

    // Find user in the usersInCurrentRoom map by username (less reliable than ID)
    function findUserInCurrentRoomList(username) {
       for (const [id, user] of usersInCurrentRoom.entries()) {
            if (user.username === username) return { id, ...user };
       }
       return null;
    }


    function handleRoomListUpdate(roomsData) {
        // roomsData: Array<{ name: string, hasUnread: boolean }>
        // This event usually broadcasts the *entire* list of public rooms
        console.log("Received room list update:", roomsData);
         if (Array.isArray(roomsData)) {
             const updatedRoomMap = new Map();
             roomsData.forEach(room => {
                 const existing = joinedRooms.get(room.name);
                 updatedRoomMap.set(room.name, {
                     name: room.name,
                     type: 'room',
                     // Preserve client-side unread status if server doesn't send it,
                     // or if the update is just a general broadcast. Resetting might be safer.
                     hasUnread: room.hasUnread || false // Prefer server state for unread
                 });
             });
             joinedRooms = updatedRoomMap; // Replace local map with server's list
             updateRoomListUI(); // Update the UI list
         }
    }

     function handleDMListUpdate(dmsData) {
         // dmsData: Can be a single DM object or an Array of DM objects
         // Used for adding new DMs or updating existing ones (e.g., new message, presence change)
         console.log("Received DM list update:", dmsData);
          const dmsToUpdate = Array.isArray(dmsData) ? dmsData : [dmsData]; // Ensure it's an array

         let listChanged = false;
         dmsToUpdate.forEach(dm => {
              if (!dm || !dm.dmRoomId || !dm.otherUser || !dm.otherUser.id) {
                  console.warn("Received invalid DM update structure:", dm);
                  return; // Skip invalid DM data
              }

              const existingDM = directMessages.get(dm.dmRoomId);
              const newUnreadStatus = dm.hasUnread !== undefined ? dm.hasUnread : (existingDM ? existingDM.hasUnread : false); // Prefer server unread status

               if (!existingDM ||
                   existingDM.lastMessageTimestamp !== dm.lastMessageTimestamp ||
                   existingDM.status !== (dm.otherUser.status || 'offline') ||
                   existingDM.hasUnread !== newUnreadStatus ||
                    existingDM.otherUsername !== dm.otherUser.username || // Handle username changes
                    existingDM.avatarUrl !== (dm.otherUser.avatarUrl || '/uploads/avatars/default.png') ) {

                  directMessages.set(dm.dmRoomId, {
                      otherUserId: dm.otherUser.id,
                      otherUsername: dm.otherUser.username,
                      avatarUrl: dm.otherUser.avatarUrl || '/uploads/avatars/default.png',
                      status: dm.otherUser.status || 'offline',
                      hasUnread: newUnreadStatus,
                      lastMessageTimestamp: dm.lastMessageTimestamp || existingDM?.lastMessageTimestamp
                  });
                  listChanged = true;
               }
         });

         if (listChanged) {
              updateDMListUI(); // Update the UI list (will also sort)
         }
     }

    function updateRoomListUI() {
        if (!roomList) return;
        roomList.innerHTML = ''; // Clear current list
        // Sort rooms alphabetically by name
        const sortedRooms = Array.from(joinedRooms.values()).sort((a, b) => a.name.localeCompare(b.name));

        sortedRooms.forEach(room => {
            addRoomToListUI(room.name, room.hasUnread);
        });
        updateActiveChatHighlight(); // Re-apply active highlight if current chat is a room
    }

     function updateDMListUI() {
         if (!dmList) return;
         dmList.innerHTML = ''; // Clear current list
         // Sort DMs: by last message timestamp (desc), then unread status (unread first), then alphabetically
         const sortedDMs = Array.from(directMessages.entries()).sort(([, dmA], [, dmB]) => {
             const timeA = dmA.lastMessageTimestamp ? new Date(dmA.lastMessageTimestamp).getTime() : 0;
             const timeB = dmB.lastMessageTimestamp ? new Date(dmB.lastMessageTimestamp).getTime() : 0;
              if (timeB !== timeA) return timeB - timeA; // Most recent message first
              if (dmA.hasUnread !== dmB.hasUnread) return dmB.hasUnread ? 1 : -1; // Unread first
             return dmA.otherUsername.localeCompare(dmB.otherUsername); // Alphabetical tiebreaker
         });
         directMessages = new Map(sortedDMs); // Update the map with sorted order

         directMessages.forEach((dmData, dmRoomId) => {
              addDMToListUI(dmRoomId, dmData);
         });
         updateActiveChatHighlight(); // Re-apply active highlight if current chat is a DM
     }


    function addRoomToListUI(roomName, hasUnread) {
        const item = document.createElement('li');
        item.dataset.roomId = roomName;
        item.dataset.chatType = 'room';
        item.textContent = roomName; // # added via CSS ::before
        if (hasUnread) item.classList.add('has-unread');
        // Active state is handled by updateActiveChatHighlight
        roomList.appendChild(item);
    }

     function addDMToListUI(dmRoomId, dmData) {
        const item = document.createElement('li');
        item.dataset.roomId = dmRoomId;
        item.dataset.chatType = 'dm';
        item.dataset.userId = dmData.otherUserId; // Store other user's ID

        // Container for Avatar and Status Indicator
        const avatarContainer = document.createElement('div');
        avatarContainer.style.position = 'relative'; // Needed for absolute positioning of status
        avatarContainer.style.flexShrink = '0'; // Prevent container shrinking

        // Avatar
        const avatarImg = document.createElement('img');
        avatarImg.src = dmData.avatarUrl || '/uploads/avatars/default.png';
        avatarImg.alt = `${dmData.otherUsername}'s avatar`;
        avatarImg.classList.add('dm-avatar');
        avatarContainer.appendChild(avatarImg);

        // Status Indicator Dot
        const statusSpan = document.createElement('span');
        statusSpan.classList.add('dm-status-indicator', dmData.status || 'offline');
        statusSpan.title = dmData.status || 'offline'; // Tooltip for status
        avatarContainer.appendChild(statusSpan);

        item.appendChild(avatarContainer);

        // Username
        const nameSpan = document.createElement('span');
        nameSpan.textContent = dmData.otherUsername;
        item.appendChild(nameSpan);

        if (dmData.hasUnread) item.classList.add('has-unread');
        // Active state is handled by updateActiveChatHighlight

        dmList.appendChild(item);
     }

    function updateActiveChatHighlight() {
         const allChatItems = document.querySelectorAll('#room-list li, #dm-list li');
         allChatItems.forEach(item => {
             const itemType = item.dataset.chatType;
             const itemId = item.dataset.roomId;
             if (itemType === currentChat.type && itemId === currentChat.id) {
                 item.classList.add('active-item');
             } else {
                 item.classList.remove('active-item');
             }
         });
     }

    function markChatAsRead(type, id) {
         if (!type || !id) return;

         let chatData;
         let listItem;
         let listNeedsUpdate = false; // Flag to check if UI needs refresh

         if (type === 'room') {
             chatData = joinedRooms.get(id);
             listItem = roomList?.querySelector(`li[data-room-id="${id}"]`);
             if (chatData && chatData.hasUnread) {
                 console.log(`Marking room ${id} as read`);
                 chatData.hasUnread = false;
                 // joinedRooms.set(id, chatData); // Map is updated directly
                 listNeedsUpdate = true;
             }
         } else if (type === 'dm') {
              chatData = directMessages.get(id);
              listItem = dmList?.querySelector(`li[data-room-id="${id}"]`);
               if (chatData && chatData.hasUnread) {
                 console.log(`Marking DM ${id} as read`);
                 chatData.hasUnread = false;
                 // directMessages.set(id, chatData); // Map updated directly
                 listNeedsUpdate = true;
             }
         }

         if (listItem && listNeedsUpdate) {
             listItem.classList.remove('has-unread');
             // If sorting DMs by unread, might need to re-sort/re-render list
             // if (type === 'dm') updateDMListUI();
         }
    }

    function markChatAsUnread(type, id) {
        // Don't mark active chat as unread if window has focus and it's the current chat
        if (currentChat.type === type && currentChat.id === id && document.hasFocus()) {
            return;
        }

        let chatData;
        let listItem;
        let listNeedsUpdate = false;

         if (type === 'room') {
             chatData = joinedRooms.get(id);
             listItem = roomList?.querySelector(`li[data-room-id="${id}"]`);
             if (chatData && !chatData.hasUnread) {
                 console.log(`Marking room ${id} as unread`);
                 chatData.hasUnread = true;
                 listNeedsUpdate = true;
             }
         } else if (type === 'dm') {
              chatData = directMessages.get(id);
              listItem = dmList?.querySelector(`li[data-room-id="${id}"]`);
               if (chatData && !chatData.hasUnread) {
                 console.log(`Marking DM ${id} as unread`);
                 chatData.hasUnread = true;
                 listNeedsUpdate = true;
             }
         }

        if (listItem && listNeedsUpdate) {
             listItem.classList.add('has-unread');
             // If sorting DMs by unread status first, re-render the list
             // if (type === 'dm') updateDMListUI();
        }
    }

    function setCurrentChat(type, id, name, avatarUrl = null) {
        currentChat = { type, id, name, avatarUrl };
        console.log(`Current chat set to: ${type || 'None'} - ${name || id || ''}`);

        updateCurrentChatHeader();
        clearTypingIndicator(); // Clear typing indicator when changing chats

        if (id) {
           markChatAsRead(type, id); // Mark as read immediately when switching to it
           displayNoChatMessage(false); // Hide placeholder
           enableChatInput(); // Enable input field
        } else {
            displayNoChatMessage(true); // Show placeholder
            disableChatInput(true, "Select a conversation");
            updateUserListUI([]); // Clear user list when no chat selected
        }

        updateActiveChatHighlight(); // Update sidebar highlight
        // Initial message loading is handled by 'joined chat' event handler
    }

     function updateCurrentChatHeader() {
         if (!currentChat.id) {
             currentChatNameSpan.textContent = 'None';
             currentChatAvatar.style.display = 'none';
             currentChatAvatar.src = '';
         } else {
             currentChatNameSpan.textContent = currentChat.name;
             if (currentChat.type === 'dm' && currentChat.avatarUrl) {
                 currentChatAvatar.src = currentChat.avatarUrl;
                 currentChatAvatar.style.display = 'inline-block';
             } else {
                 // Room selected or DM has no avatar
                 currentChatAvatar.style.display = 'none';
                 currentChatAvatar.src = '';
             }
         }
     }

    function clearChatArea() {
         if (messagesList) messagesList.innerHTML = '';
         if (userList) userList.innerHTML = ''; // Clear room user list too
         if (onlineCountSpan) onlineCountSpan.textContent = '0';
         clearTypingIndicator();
    }

    function updateUIForNoChat() {
        clearChatArea();
        displayNoChatMessage(true);
        disableChatInput(true, "Select a conversation");
        setCurrentChat(null, null, null); // Updates header and active highlights
    }

    function setJoiningState(isJoining, message = '') {
         if (joinRoomButton) joinRoomButton.disabled = isJoining;
         if (roomNameInput) roomNameInput.disabled = isJoining;
         // Could show spinner near button
         displayRoomError(isJoining ? (message || `Joining...`) : ''); // Use room error field for status
         // Optionally use global loading overlay
         // showLoading(isJoining, message || 'Joining...');
    }

    // --- In-Chat Event Handlers ---

    function handleChatMessage(msgData) {
        // msgData: { sender: { id, username, avatarUrl }, text: string, timestamp: string, chat: { type: 'room'|'dm', id: string } }
        console.log('Received message:', msgData);
        if (!msgData || !msgData.chat || !msgData.sender || !msgData.chat.id || !msgData.chat.type) {
             console.warn("Invalid message data received:", msgData); return;
        }

        const { type, id } = msgData.chat;

        // Update DM last message timestamp for sorting & potentially update list UI
         if (type === 'dm') {
             const dmState = directMessages.get(id);
             if (dmState) {
                 // Only update if the new timestamp is different or newer
                 if (dmState.lastMessageTimestamp !== msgData.timestamp) {
                      dmState.lastMessageTimestamp = msgData.timestamp;
                       // Trigger a sort and re-render of the DM list
                      updateDMListUI();
                 }
             }
         }

        // Only add message to UI if it's for the currently active chat
        if (type === currentChat.type && id === currentChat.id) {
            addMessageToList(msgData.sender, msgData.text, msgData.timestamp);
            // If the message is from someone else, clear their typing indicator
            if (msgData.sender.id !== currentUser?.id) {
                removeTypingUser(msgData.sender.id);
            }
            // If the window has focus, mark the chat as read
             if (document.hasFocus()) {
                 markChatAsRead(type, id);
             } else {
                  markChatAsUnread(type, id); // Mark unread if window not focused
             }
        } else {
             // Message is for another chat, mark that chat as unread
             markChatAsUnread(type, id);
        }
    }

    function handleUserListUpdate(data) {
        // data: { room: string, users: Array<{id, username, avatarUrl, status}> }
        // This event is typically only for the *current public room*
        // console.log('Received user list update:', data);
        if (data && currentChat.type === 'room' && data.room === currentChat.id && Array.isArray(data.users)) {
            updateUserListUI(data.users);
        } else {
             // console.log("Ignoring user list update for different room or chat type.");
        }
    }

    function handlePresenceUpdate(data) {
        // data: { userId: string, status: string, lastSeen: string, statusMessage?: string }
        console.log('Presence update received:', data);
        if (!data || !data.userId) return;

         // Update local currentUser state if it's for self (e.g., status changed via another client)
         if (data.userId === currentUser?.id) {
             currentUser.status = data.status;
             currentUser.statusMessage = data.statusMessage || '';
             currentUser.lastSeen = data.lastSeen;
              // Update profile modal UI if it's open
              if (profileModal.style.display === 'flex') {
                   statusSelect.value = currentUser.status;
                   statusMessageInput.value = currentUser.statusMessage;
                   profileLastSeen.textContent = formatTimestamp(currentUser.lastSeen, true);
              }
              // Update own avatar header status indicator? (Maybe too much visual noise)
         }

         // Update user presence in UI lists (DM list, current room list)
         updateUserPresenceInUI(data.userId, data.status);
    }


    function updateUserPresenceInUI(userId, status) {
         // 1. Update user in the current room's user list (if applicable)
         const userItemInRoom = userList?.querySelector(`li[data-user-id="${userId}"]`);
         if (userItemInRoom) {
             const statusIndicator = userItemInRoom.querySelector('.user-status-indicator');
             if (statusIndicator) {
                 statusIndicator.className = `user-status-indicator ${status}`;
                 statusIndicator.title = status;
             }
         }
         // Also update the map state
         if (usersInCurrentRoom.has(userId)) {
              usersInCurrentRoom.get(userId).status = status;
         }

         // 2. Update user in the DM list (if applicable)
         const dmItem = dmList?.querySelector(`li[data-user-id="${userId}"]`); // Find DM list item by other user's ID
         if (dmItem) {
              const statusIndicator = dmItem.querySelector('.dm-status-indicator');
              if (statusIndicator) {
                   statusIndicator.className = `dm-status-indicator ${status}`;
                   statusIndicator.title = status;
              }
         }
         // Also update the map state
         const dmEntry = findDMByUserId(userId);
          if (dmEntry) {
               const dmData = directMessages.get(dmEntry.dmRoomId);
               if (dmData) dmData.status = status;
          }

         // 3. Update user in the chat header if it's a DM with that user
          if (currentChat.type === 'dm') {
              const currentDmData = directMessages.get(currentChat.id);
              if (currentDmData && currentDmData.otherUserId === userId) {
                   // Maybe add a status indicator to the header? (Optional)
                   console.log(`Presence update for current DM partner ${currentChat.name}: ${status}`);
              }
          }
    }


    function handleUserTyping(data) {
        // data: { userId: string, username: string, chat: { type: 'room'|'dm', id: string } }
        if (!data || !data.chat || !data.userId || !data.username) return;
        // Only show typing if it's for the current chat and not from self
        if (data.chat.type === currentChat.type && data.chat.id === currentChat.id && data.userId !== currentUser?.id) {
             addTypingUser(data.userId, data.username);
        }
    }

    function handleUserStopTyping(data) {
        // data: { userId: string, chat: { type: 'room'|'dm', id: string } }
         if (!data || !data.chat || !data.userId) return;
         // Only process if it's for the current chat
         if (data.chat.type === currentChat.type && data.chat.id === currentChat.id) {
            removeTypingUser(data.userId);
        }
    }

    // --- General Message Handlers ---
     function handleServerMessage(messageData) {
         // messageData: { message: string, type: 'info'|'success'|'error', targetChat?: { type, id } }
         console.log("Server message:", messageData);
         const message = messageData.message || 'Received message from server.';
         const type = messageData.type || 'info'; // Default to 'info'
         const targetChat = messageData.targetChat;

         // If targeted to a specific chat, only show if it's the current chat
         if (targetChat) {
             if (currentChat.type === targetChat.type && currentChat.id === targetChat.id) {
                 addSystemMessageToCurrentChat(message, type);
             } else {
                  console.log(`Server message for other chat (${targetChat.id}) ignored in UI.`);
             }
         }
         // If not targeted, show globally (e.g., in current chat or a general notification area)
         else if (currentChat.id) {
             addSystemMessageToCurrentChat(`Server: ${message}`, type);
         } else {
              // If not in a chat, show in the general auth error area
              displayMessage(authErrorGeneral, `Server: ${message}`, type);
         }
     }

     function handleErrorMessage(errorMsg) {
        // Handles specific 'error message' events from the server (custom application errors)
        console.error("Received Server Error Message:", errorMsg);
        setJoiningState(false); // Ensure joining state is cleared on error

        // Try to display contextually
        if (errorMsg.toLowerCase().includes("room") || errorMsg.toLowerCase().includes("chat") || errorMsg.toLowerCase().includes("dm")) {
             displayRoomError(errorMsg); // Show near room input/sidebar
        } else if (currentChat.id) {
            // Show error as a system message in the current chat window
            addSystemMessageToCurrentChat(`Error: ${errorMsg}`, 'error');
        } else {
            // If not in chat, show in the general auth error area
            displayMessage(authErrorGeneral, `Error: ${errorMsg}`, 'error');
        }
     }

    // --- Sending Messages and Typing ---
    function handleSendMessage(event) {
        event.preventDefault();
        const messageText = messageInput.value.trim();

        if (!currentUser) { addSystemMessageToCurrentChat("You must be logged in.", 'error'); return; }
        if (!socket || !socket.connected) { addSystemMessageToCurrentChat("Not connected to server.", 'error'); return; }
        if (!currentChat.id) { addSystemMessageToCurrentChat("Select a conversation first!", 'error'); return; }
        if (!messageText) return; // Don't send empty messages

        // Optional: Check message length client-side too
        if (messageText.length > 1000) {
             addSystemMessageToCurrentChat("Message is too long (max 1000 characters).", 'error');
             return;
        }

        console.log(`Sending to ${currentChat.type} ${currentChat.id}: ${messageText}`);
        socket.emit('chat message', {
            text: messageText,
            chat: { type: currentChat.type, id: currentChat.id }
         });

        messageInput.value = '';
        messageInput.focus();
        // Stop typing indicator immediately after sending
        sendStopTyping();

        // OPTIONAL: Optimistic UI update (add message immediately) - disabled for now, waiting for server confirmation is safer
        // addMessageToList(currentUser, messageText, new Date().toISOString());
    }

    function handleTypingInput() {
        if (!socket || !socket.connected || !currentChat.id) return;
        if (!isTyping) {
            isTyping = true;
            // console.log("Emitting: typing");
            socket.emit('typing', { chat: { type: currentChat.type, id: currentChat.id } });
        }
        // Reset the timeout timer
        clearTimeout(typingTimeout);
        typingTimeout = setTimeout(sendStopTyping, TYPING_TIMER_LENGTH);
    }

    function sendStopTyping() {
         // Only send if currently marked as typing
         if (isTyping && socket && socket.connected && currentChat.id) {
             // console.log("Emitting: stop typing");
             clearTimeout(typingTimeout); // Clear any pending timeout
             isTyping = false;
             socket.emit('stop typing', { chat: { type: currentChat.type, id: currentChat.id } });
         }
    }

    // --- UI Update Functions ---

    function addMessageToList(sender, message, timestamp) {
        // sender: { id, username, avatarUrl } | null for system
        if (!messagesList || !currentUser) return; // Need messages list and current user info

        const isSelf = sender?.id === currentUser.id;
        const isSystem = !sender; // System messages have no sender object
        const messageType = arguments[3] || 'info'; // Optional 4th arg for system message type

        const wasScrolledToBottom = isNearBottom(messagesList);

        const item = document.createElement('li');
        item.classList.add('message'); // Base class

        if (isSystem) {
            item.classList.add('system-message', messageType);
            // Sanitize system message text (simple example, use a library for complex HTML)
            item.textContent = message;
        } else {
            item.classList.add('user-message');
            if (isSelf) item.classList.add('self-message');

            // Message Header (Avatar + Sender Name) - only for others' messages
            if (!isSelf && sender) {
                const headerDiv = document.createElement('div');
                headerDiv.classList.add('message-header');

                const avatarImg = document.createElement('img');
                avatarImg.classList.add('message-avatar');
                avatarImg.src = sender.avatarUrl || '/uploads/avatars/default.png';
                avatarImg.alt = `${sender.username}'s avatar`;
                avatarImg.loading = 'lazy'; // Lazy load avatars
                headerDiv.appendChild(avatarImg);

                const senderSpan = document.createElement('span');
                senderSpan.classList.add('message-sender');
                senderSpan.textContent = sender.username;
                headerDiv.appendChild(senderSpan);

                item.appendChild(headerDiv);
            }

            // Message Content (Text + Timestamp)
            const contentDiv = document.createElement('div');
            contentDiv.classList.add('message-content');

            const textSpan = document.createElement('span');
            textSpan.classList.add('message-text');
            // *** IMPORTANT: Use textContent to prevent XSS from message content ***
            textSpan.textContent = message;
            contentDiv.appendChild(textSpan);

            const timeSpan = document.createElement('span');
            timeSpan.classList.add('message-timestamp');
            timeSpan.textContent = formatTimestamp(timestamp);
            timeSpan.title = formatTimestamp(timestamp, true); // Full date/time on hover
            contentDiv.appendChild(timeSpan);

            item.appendChild(contentDiv);
        }

        messagesList.appendChild(item);

        // Auto-scroll only if user was already near the bottom or sent the message
        if (wasScrolledToBottom || isSelf) {
            scrollToBottom(messagesList);
        }
    }

    function addSystemMessageToCurrentChat(message, type = 'info') {
        // Ensure type is one of the expected values for CSS styling
        const validTypes = ['info', 'success', 'error'];
        const messageType = validTypes.includes(type) ? type : 'info';
        // Pass null for sender to indicate system message, and the type
        addMessageToList(null, message, new Date().toISOString(), messageType);
    }

    function updateUserListUI(usersInRoom) {
         // Updates the user list UI (sidebar) for the current *public* room
         if (!userList || !onlineCountSpan) return;
         userList.innerHTML = ''; // Clear previous list
         usersInCurrentRoom.clear(); // Clear internal map state

         const validUsers = Array.isArray(usersInRoom) ? usersInRoom.filter(user => user && user.id && user.username) : [];

         // Sort users: self first, then alphabetically by username
         validUsers.sort((a, b) => {
             if (a.id === currentUser?.id) return -1; // Self first
             if (b.id === currentUser?.id) return 1;  // Self first
             return a.username.localeCompare(b.username); // Alphabetical
         });

         // Populate map and UI list
         validUsers.forEach(user => {
            usersInCurrentRoom.set(user.id, { // Store in local map state
                 username: user.username,
                 avatarUrl: user.avatarUrl || '/uploads/avatars/default.png',
                 status: user.status || 'offline'
            });
            addUserListItemUI(user.id, user.username, user.avatarUrl, user.status);
         });

         // Update count in the heading
         onlineCountSpan.textContent = validUsers.length;
    }

     function addUserListItemUI(userId, username, avatarUrl, status) {
         const userItem = document.createElement('li');
         userItem.dataset.userId = userId;

         // Avatar Container for relative positioning of status dot
         const avatarContainer = document.createElement('div');
         avatarContainer.classList.add('user-avatar'); // Use class for sizing/styling

         const avatarImg = document.createElement('img');
         avatarImg.src = avatarUrl || '/uploads/avatars/default.png';
         avatarImg.alt = `${username}'s avatar`;
         avatarImg.loading = 'lazy';
         avatarContainer.appendChild(avatarImg);

         // Status Indicator Dot
         const statusSpan = document.createElement('span');
         statusSpan.classList.add('user-status-indicator', status || 'offline');
         statusSpan.title = status || 'offline'; // Tooltip for status
         avatarContainer.appendChild(statusSpan);

         userItem.appendChild(avatarContainer);

         // Username
         const nameSpan = document.createElement('span');
         nameSpan.classList.add('username');
         nameSpan.textContent = username;
         userItem.appendChild(nameSpan);

         if (userId === currentUser?.id) {
             userItem.classList.add('is-self');
             userItem.title = "You"; // Tooltip for self
         } else {
              // Add click listener/cursor pointer to start DM only for other users
              userItem.style.cursor = 'pointer';
              userItem.title = `Click to message ${username}`;
              // Event listener added globally to userList handles the click via delegation
         }

         userList.appendChild(userItem);
     }


    // --- Typing Indicator Logic (Current Chat Specific) ---
    function addTypingUser(userId, username) {
        if (!currentTypingUsers || userId === currentUser?.id) return; // Ignore self
        currentTypingUsers.set(userId, username);
        updateTypingIndicatorUI();
    }

    function removeTypingUser(userId) {
        if (currentTypingUsers && currentTypingUsers.has(userId)) {
            currentTypingUsers.delete(userId);
            updateTypingIndicatorUI();
        }
    }

    function clearTypingIndicator() {
         if(currentTypingUsers) currentTypingUsers.clear();
         updateTypingIndicatorUI();
    }

    function updateTypingIndicatorUI() {
        if (!typingIndicator) return;
        const usersArray = Array.from(currentTypingUsers.values()); // Get array of usernames

        if (usersArray.length === 0) {
            typingIndicator.innerHTML = ''; // Clear content
            typingIndicator.classList.remove('visible');
        } else {
            let text;
            const maxDisplay = 2; // Show max 2 names explicitly
            const namesToShow = usersArray.slice(0, maxDisplay).join(', ');
            const remainingCount = usersArray.length - maxDisplay;

            if (usersArray.length === 1) { text = `${namesToShow} is typing`; }
            else if (usersArray.length === 2) { text = `${namesToShow} are typing`; }
            else { text = `${namesToShow} and ${remainingCount} other${remainingCount > 1 ? 's are' : ' is'} typing`; }

            // Add animated dots
            typingIndicator.innerHTML = `${text}<span>.</span><span>.</span><span>.</span>`;
            typingIndicator.classList.add('visible');
        }
    }

    function enableChatInput() {
         if (!currentChat || !currentChat.id) return; // Only enable if in a chat
         disableChatInput(false, `Message #${currentChat.name}...`);
    }

    function updateConnectionStatus(text, statusClass) {
         if (statusIndicator) {
             statusIndicator.textContent = text;
             statusIndicator.className = ''; // Reset classes first
             if (statusClass) statusIndicator.classList.add(statusClass);
         }
    }

     // --- Profile Modal ---
     function openProfileModal() {
         if (!currentUser || !profileModal) return;
         console.log("Opening profile modal for:", currentUser.username);

         // Populate modal with current user data
         profileAvatar.src = currentUser.avatarUrl || '/uploads/avatars/default.png';
         profileUsername.textContent = currentUser.username;
         profileEmail.textContent = currentUser.email;
         profileJoined.textContent = formatTimestamp(currentUser.createdAt, true); // Include date for join time
         profileLastSeen.textContent = formatTimestamp(currentUser.lastSeen, true); // Include date
         profileStatusMsg.textContent = currentUser.statusMessage || '(No status message set)';
         statusSelect.value = currentUser.status || 'online';
         statusMessageInput.value = currentUser.statusMessage || '';

         clearMessageBox(avatarUploadMessage); // Clear previous upload messages
         clearMessageBox(statusUpdateMessage); // Clear previous status messages
         avatarFileInput.value = ''; // Clear file input selection

         profileModal.style.display = 'flex'; // Show modal
     }

     function closeProfileModalFunc() {
         if (profileModal) profileModal.style.display = 'none';
     }

     async function handleAvatarUpload(event) {
         event.preventDefault();
         clearMessageBox(avatarUploadMessage); // Clear previous messages

         if (!avatarFileInput.files || avatarFileInput.files.length === 0) {
             displayMessage(avatarUploadMessage, 'Please select an image file first.', 'error');
             return;
         }

         const file = avatarFileInput.files[0];
         // Optional: Client-side size check (server validates anyway)
         const maxSize = 1 * 1024 * 1024; // 1MB
         if (file.size > maxSize) {
              displayMessage(avatarUploadMessage, `File is too large (max ${maxSize / 1024 / 1024}MB).`, 'error');
              return;
         }

         const formData = new FormData();
         formData.append('avatar', file); // 'avatar' must match server's upload.single('avatar') name

         showLoading(true, "Uploading avatar...");
         try {
             const response = await fetch('/api/users/me/avatar', {
                 method: 'POST',
                 headers: {
                     'Authorization': `Bearer ${getToken()}`
                     // Content-Type is set automatically by browser for FormData
                 },
                 body: formData
             });
             const data = await response.json();

             showLoading(false);

             if (response.ok && data.success && data.avatarUrl) {
                 console.log('Avatar uploaded successfully:', data.avatarUrl);
                 // Update UI immediately
                 currentUser.avatarUrl = data.avatarUrl;
                 userAvatarHeader.src = data.avatarUrl; // Update header avatar
                 profileAvatar.src = data.avatarUrl; // Update modal avatar
                 displayMessage(avatarUploadMessage, 'Avatar updated successfully!', 'success');
                 avatarFileInput.value = ''; // Clear file input
                 // Update own avatar in user lists if present? (complex, rely on presence update for now)
                 // setTimeout(closeProfileModalFunc, 1500); // Optionally close modal after success

             } else {
                  console.error("Avatar upload failed:", data.error);
                  displayMessage(avatarUploadMessage, data.error || 'Avatar upload failed.', 'error');
             }
         } catch (error) {
             showLoading(false);
             console.error('Avatar upload network error:', error);
             displayMessage(avatarUploadMessage, 'Network error during upload. Please try again.', 'error');
         }
     }

     // --- Status Update ---
      function handleStatusUpdate(event) {
          event?.preventDefault(); // Prevent form submission if triggered by submit event
           if (!currentUser || !socket || !socket.connected) {
                displayMessage(statusUpdateMessage, "Not connected.", "error"); return;
           }

          const newStatus = statusSelect.value;
          const newStatusMessage = statusMessageInput.value.trim();

          // Check if status or message actually changed
          if (newStatus === currentUser.status && newStatusMessage === currentUser.statusMessage) {
               console.log("Status unchanged.");
               // displayMessage(statusUpdateMessage, "Status is already set.", "info"); // Optional feedback
               return;
          }

          console.log(`Updating status to: ${newStatus}, Message: "${newStatusMessage}"`);
          clearMessageBox(statusUpdateMessage); // Clear previous message

          // Disable inputs while updating
          statusSelect.disabled = true;
          statusMessageInput.disabled = true;
          if(statusUpdateButton) statusUpdateButton.disabled = true;

          socket.emit('set status', { status: newStatus, statusMessage: newStatusMessage });

          // Assume success for now, presence update event will confirm
          // Re-enable inputs after a short delay, or wait for confirmation event (safer)
           setTimeout(() => {
               statusSelect.disabled = false;
               statusMessageInput.disabled = false;
               if(statusUpdateButton) statusUpdateButton.disabled = false;
               // Update local display optimistically? Wait for presence update.
               // profileStatusMsg.textContent = newStatusMessage || '(No status message set)';
               displayMessage(statusUpdateMessage, "Status updated.", "success");
               // Clear success message after a bit
               setTimeout(() => clearMessageBox(statusUpdateMessage), 2000);
           }, 500); // Short delay
      }


    // --- Utility Functions ---
    function scrollToBottom(element) {
        if (!element) return;
        // Use requestAnimationFrame for smoother scrolling after potential DOM updates
        requestAnimationFrame(() => {
             element.scrollTop = element.scrollHeight;
        });
    }

    function isNearBottom(element, tolerance = 10) {
        if (!element) return true; // Assume yes if element doesn't exist
        const { scrollTop, scrollHeight, clientHeight } = element;
        return scrollHeight - clientHeight <= scrollTop + tolerance;
    }

    function formatTimestamp(isoString, includeDate = false) {
        if (!isoString) return "??:??";
        try {
            const date = new Date(isoString);
            if (isNaN(date.getTime())) return "Invalid Date"; // Handle invalid date strings

            const hours = date.getHours().toString().padStart(2, '0');
            const minutes = date.getMinutes().toString().padStart(2, '0');
            const timeString = `${hours}:${minutes}`;

            if (includeDate) {
                 const today = new Date();
                 const yesterday = new Date(today);
                 yesterday.setDate(today.getDate() - 1);

                 // Check if it's today
                 if (date.toDateString() === today.toDateString()) {
                     return `Today ${timeString}`;
                 }
                 // Check if it was yesterday
                 if (date.toDateString() === yesterday.toDateString()) {
                     return `Yesterday ${timeString}`;
                 }
                 // Otherwise, show full date and time
                 const year = date.getFullYear();
                 const month = (date.getMonth() + 1).toString().padStart(2, '0'); // Month is 0-indexed
                 const day = date.getDate().toString().padStart(2, '0');
                 const dateString = `${year}-${month}-${day}`;
                 return `${dateString} ${timeString}`;
            } else {
                 // Only return time if date not requested
                 return timeString;
            }
        } catch (error) {
            console.error("Timestamp format error:", error, "Input:", isoString);
            return "??:??"; // Fallback for unexpected errors
        }
    }

     function handleWindowFocus() {
         // console.log("Window focused");
         if (currentChat.id && document.hasFocus()) {
             markChatAsRead(currentChat.type, currentChat.id);
         }
          // Optionally change status from away back to online if not DND
         if (currentUser && currentUser.status === 'away' && socket && socket.connected) {
              // console.log("Window focus detected while away, setting status to online.");
              // socket.emit('set status', { status: 'online', statusMessage: currentUser.statusMessage });
         }
     }

      function handleWindowBlur() {
          // console.log("Window blurred");
           // Optionally set status to 'away' after a delay, unless DND is set
          // if (currentUser && currentUser.status === 'online' && socket && socket.connected) {
          //      setTimeout(() => {
          //           if (!document.hasFocus() && currentUser.status === 'online') { // Check again in case focus returned quickly
          //                console.log("Window blurred for a while, setting status to away.");
          //                socket.emit('set status', { status: 'away', statusMessage: currentUser.statusMessage });
          //           }
          //      }, 30 * 1000); // e.g., 30 seconds delay
          // }

          // Ensure typing stops if window loses focus while typing
          if (isTyping) {
               sendStopTyping();
          }
      }

    // --- Start Application ---
    // Ensure DOM is fully loaded before initializing
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', initialize);
    } else {
        initialize(); // DOMContentLoaded has already fired
    }

})();