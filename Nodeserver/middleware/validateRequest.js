/**
 * validateRequest.js
 * Middleware using express-validator to validate request bodies/params/queries.
 */
'use strict';

const { validationResult } = require('express-validator');

/**
 * Middleware factory to run validation checks defined in routes.
 * If validation fails, sends a 400 response with errors.
 * Otherwise, calls next().
 *
 * @param {Array<ValidationChain>} validations - An array of validation chains from express-validator.
 * @returns {Function} Express middleware function.
 */
const validateRequest = (validations) => {
    return async (req, res, next) => {
        // Run all validation checks concurrently for the current request
        await Promise.all(validations.map(validation => validation.run(req)));

        const errors = validationResult(req);
        if (errors.isEmpty()) {
            return next(); // No errors, proceed to the next middleware/controller
        }

        // Format errors for a consistent response structure
        const formattedErrors = errors.array().map(err => ({
            field: err.param, // The parameter/field that failed validation (e.g., 'body.email', 'params.id')
            message: err.msg,
            value: err.value // Optionally include the invalid value that was provided
        }));

        console.warn("⚠️ Validation Error:", JSON.stringify(formattedErrors));

        // Send a 400 Bad Request response
        res.status(400).json({
            success: false,
            error: 'Validation failed. Please check your input.', // General error message
            errors: formattedErrors // Detailed list of validation errors
        });
    };
};

module.exports = validateRequest;