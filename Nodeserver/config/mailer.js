/**
 * mailer.js
 * Configures and provides Nodemailer transport for sending emails.
 */
'use strict';

const nodemailer = require('nodemailer');
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });

const mailConfig = {
    service: process.env.EMAIL_SERVICE, // e.g., 'gmail'
    host: process.env.EMAIL_HOST,     // e.g., 'smtp.gmail.com' (often needed for non-service options)
    port: parseInt(process.env.EMAIL_PORT || '587', 10), // 465 for secure, 587 for TLS
    secure: process.env.EMAIL_SECURE === 'true', // true for 465, false for other ports
    auth: {
        user: process.env.EMAIL_USER, // your email address
        pass: process.env.EMAIL_PASS  // your email password or app-specific password
    },
    // Optional: Reject unauthorized TLS connections for added security with some providers
    // tls: {
    //     rejectUnauthorized: true
    // }
};

let transporter = null;
let mailerIsConfigured = false;

// Validate essential config
if (!mailConfig.auth.user || !mailConfig.auth.pass || (!mailConfig.service && !mailConfig.host)) {
    console.warn('⚠️ Email service is not fully configured in .env. Password reset and other email features will NOT work.');
} else {
    try {
        transporter = nodemailer.createTransport(mailConfig);

        // Verify connection configuration (recommended)
        transporter.verify((error, success) => {
            if (error) {
                console.error('❌ Error configuring email transporter:', error);
                console.error('   Check your EMAIL_ settings in the .env file.');
                transporter = null; // Ensure transporter is null if verification fails
            } else {
                console.log('✅ Email transporter configured successfully. Server is ready to send emails.');
                mailerIsConfigured = true;
            }
        });
    } catch (error) {
         console.error('❌ Failed to create email transporter:', error);
         transporter = null;
    }
}

/**
 * Sends an email using the configured transporter.
 * @param {object} mailOptions - Options for nodemailer sendMail (to, subject, text, html).
 * @returns {Promise<object>} - Promise resolving with the result from sendMail.
 * @throws {Error} If mailer is not configured or sending fails.
 */
const sendMail = async (mailOptions) => {
    if (!mailerIsConfigured || !transporter) {
        console.error("❌ Email not sent: Email service not configured or verification failed.");
        throw new Error("Email service not configured.");
    }

    try {
        const optionsWithFrom = {
            ...mailOptions,
            from: process.env.EMAIL_FROM || mailConfig.auth.user // Set default sender
        };
        console.log(`📧 Sending email to ${optionsWithFrom.to} with subject "${optionsWithFrom.subject}"`);
        const info = await transporter.sendMail(optionsWithFrom);
        console.log(`✅ Email sent: ${info.messageId}`);
        // console.log(`   Preview URL: ${nodemailer.getTestMessageUrl(info)}`); // Useful with ethereal.email
        return info;
    } catch (error) {
        console.error(`❌ Error sending email to ${mailOptions.to}:`, error);
        throw error; // Re-throw the error to be handled by the caller
    }
};

module.exports = { sendMail, isConfigured: () => mailerIsConfigured }; // Export function to check config status