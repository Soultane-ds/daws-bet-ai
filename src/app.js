'use strict';
const { createServer, route } = require('./http');
require('./routes/public');
require('./routes/admin');
const { bootstrapAdmin } = require('./auth');

route('GET', '/api/health', async () => ({ ok: true, time: new Date().toISOString() }));

function createApp() {
  bootstrapAdmin();
  return createServer();
}
module.exports = { createApp };
