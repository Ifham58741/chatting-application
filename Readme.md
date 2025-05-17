# ChatApp Enhanced V2

ChatApp  is a full-stack real-time web chat application built with Node.js, Express, Socket.IO, and MongoDB. It features user authentication, public rooms, user profiles with avatar uploads, presence indicators, and more.

## ✨ Features

*   **Real-time Communication:** Instant messaging in public rooms and direct messages using Socket.IO.
*   **User Authentication:**
    *   Secure registration and login (passwords hashed with bcrypt).
    *   JWT-based authentication for API routes and Socket.IO connections.
    *   "Forgot Password" and "Reset Password" functionality via email (Nodemailer).
    *   "Get Me" endpoint to verify tokens and fetch user data.
*   **Chat Rooms:**
    *   Join existing public rooms or create new ones by name.
    *   View a list of users currently in a public room.
*   **Direct Messaging (DMs):**
    *   Initiate one-on-one conversations with other users.
    *   DM list sorted by recent activity.
*   **User Profiles & Presence:**
    *   View basic user profile information.
    *   Upload and display user avatars (using Multer for file handling).
    *   Real-time presence indicators (online, away, DND, offline).
    *   Customizable status messages.
*   **Rich Chat Experience:**
    *   Message history loaded upon joining a chat.
    *   Typing indicators.
    *   System messages for important events (joins, errors).
    *   Timestamps for messages.
*   **Responsive UI:** Frontend designed to adapt to different screen sizes.
*   **Organized Backend:**
    *   MVC-like structure with routes, controllers, models, and middleware.
    *   Centralized error handling.
    *   Request validation using `express-validator`.
*   **Configuration:** Environment variable driven configuration for database, JWT, email, and uploads.

## 🛠️ Tech Stack

**Backend:**
*   Node.js
*   Express.js (Web framework)
*   Socket.IO (Real-time engine)
*   MongoDB (Database) with Mongoose (ODM)
*   JSON Web Tokens (JWT) for authentication
*   bcrypt (Password hashing)
*   Nodemailer (Email sending for password resets)
*   Multer (File uploads for avatars)
*   dotenv (Environment variable management)
*   express-validator (Request validation)

**Frontend:**
*   HTML5
*   CSS3 (Custom styling)
*   Vanilla JavaScript (Client-side logic)
*   Socket.IO Client

**Development:**
*   Nodemon (Automatic server restarts)
*   ESLint (Code linting)

## 📋 Prerequisites

*   Node.js (version specified in `package.json`, e.g., >=18.0.0)
*   npm (Node Package Manager)
*   MongoDB instance (local or cloud-hosted like MongoDB Atlas)

## ⚙️ Setup & Installation

1.  **Clone the repository:**
    ```bash
    git clone <repository-url>
    cd <repository-name>
    ```

2.  **Install backend dependencies:**
    ```bash
    npm install
    ```
    (This installs dependencies listed in `package.json` for the `Nodeserver`)

3.  **Set up Environment Variables:**
    Create a `.env` file in the `Nodeserver/` directory by copying `Nodeserver/.env.example` (if provided, otherwise create from scratch) and fill in the necessary values:
    ```env
    # Nodeserver/.env

    # --- Database ---
    MONGODB_URI=your_mongodb_connection_string # e.g., mongodb://localhost:27017/chatapp_v2

    # --- Server ---
    PORT=8000
    DEFAULT_ROOM=general # Default public room created on startup

    # --- Authentication ---
    JWT_SECRET=your_super_strong_random_jwt_secret # Generate a strong secret
    JWT_EXPIRES_IN=7d # e.g., 1d, 7d, 30m

    # --- Password Reset (Nodemailer - Example with Gmail) ---
    # For Gmail, you might need an "App Password"
    # EMAIL_SERVICE=Gmail
    # EMAIL_HOST=smtp.gmail.com
    # EMAIL_PORT=465 # Or 587 for TLS
    # EMAIL_SECURE=true # true for 465, false for other ports
    # EMAIL_USER=your_email@gmail.com
    # EMAIL_PASS=your_gmail_app_password
    # EMAIL_FROM='"Your Chat App Name" <your_email@gmail.com>' # Sender display name and email
    # CLIENT_URL=http://localhost:8000 # Base URL of your app for password reset links

    # --- File Uploads ---
    # Path relative from Nodeserver/index.js where uploads will be stored
    UPLOAD_DIR=../uploads/avatars # Default: creates 'uploads/avatars' in the project root
    # Publicly accessible URL path for uploads (must match express.static route in Nodeserver/index.js)
    UPLOAD_ROUTE=/uploads/avatars
    MAX_FILE_SIZE=1048576 # Max avatar size in bytes (1MB)

    # --- Other ---
    MESSAGE_HISTORY_LIMIT=50 # Number of messages to load initially per chat
    ```
    *   **Important:** Ensure the `UPLOAD_DIR` directory (e.g., `uploads/avatars/` in the project root) exists and the server has write permissions to it. The application attempts to create it if it doesn't exist.

## 🚀 Running the Application

1.  **Start the server:**
    *   For production:
        ```bash
        npm start
        ```
    *   For development (with auto-reloading via Nodemon):
        ```bash
        npm run dev
        ```

2.  Open your web browser and navigate to `http://localhost:<PORT>` (e.g., `http://localhost:8000` if `PORT` is 8000).

## 📁 Project Structure (Key Components)
.
├── Nodeserver/ # Backend code
│ ├── config/ # Database, mailer, file storage (Multer)
│ ├── controllers/ # Request handling logic
│ ├── middleware/ # Custom middleware (auth, error handling, validation)
│ ├── models/ # Mongoose schemas and models (User, Room, Message)
│ ├── routes/ # API route definitions
│ ├── utils/ # Utility functions (e.g., token generation)
│ ├── .env # Environment variables (ignored by Git)
│ ├── index.js # Main server entry point, Express & Socket.IO setup
│ └── socketHandlers.js # Socket.IO event handling logic
├── css/ # Frontend CSS
│ └── style.css
├── js/ # Frontend JavaScript
│ └── client.js
├── uploads/ # Default directory for user-uploaded avatars (created if doesn't exist)
│ └── avatars/
├── .gitignore # Specifies intentionally untracked files
├── index.html # Main HTML file for the client
├── package.json # Project metadata and dependencies
└── Readme.md # This file



## 🌐 API Endpoints

The application exposes RESTful APIs for authentication and user/room management. Key prefixes:
*   `/api/auth/`: Registration, login, logout, password reset, get current user.
*   `/api/users/`: User profiles, avatar uploads.
*   `/api/rooms/`: Listing public rooms.

*(Refer to `Nodeserver/routes/` for detailed route definitions.)*

## 💬 Socket.IO Events

The application uses Socket.IO for real-time features. Key client-to-server events handled in `Nodeserver/socketHandlers.js`:
*   `join chat`: To join a public room or existing DM.
*   `initiate dm`: To start a new direct message conversation.
*   `chat message`: To send a message to the current chat.
*   `typing` / `stop typing`: For typing indicators.
*   `set status`: To update user's presence status and custom message.

Key server-to-client events:
*   `initial data`: Sends room and DM lists upon connection.
*   `joined chat`: Confirmation after joining a chat, includes history and user list.
*   `chat message`: Broadcasts a new message.
*   `user list update`: Updates user list for a public room.
*   `presence update`: Notifies of user status/avatar changes.
*   `typing` / `stop typing`: Broadcasts typing indicators.
*   `server message` / `error message`: For system notifications and errors.
*   `dm list update`: Updates the user's list of direct messages.

## 💡 Potential Future Enhancements

*   **Persistent In-Memory State:** Replace in-memory `userSockets`, `connectedSockets`, `activeChats` with a shared store like Redis for scalability and persistence across server restarts.
*   **Private Rooms:** Implement password-protected or invite-only private rooms.
*   **Message Editing/Deletion:** Allow users to edit or delete their own messages.
*   **Notifications:** Implement browser notifications for new messages when the window is not active.
*   **Search Functionality:** Search for messages or users.
*   **File Sharing:** Allow sharing of files beyond avatars in chats.
*   **Emojis & Rich Text:** Add support for emojis and basic rich text formatting.
*   **End-to-End Encryption:** For highly secure DMs (complex).
*   **Admin Panel:** For managing users and rooms.
*   **Comprehensive Testing:** Add unit, integration, and end-to-end tests.


