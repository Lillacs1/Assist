// Vercel imports this file as a serverless function. It just hands requests
// straight to the same Express app used for local dev (see server.js) —
// nothing about your routes, middleware, or logic needs to change.
module.exports = require('../server.js');
