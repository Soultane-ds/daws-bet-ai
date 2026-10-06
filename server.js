'use strict';
const cfg = require('./src/config');
const { createApp } = require('./src/app');
const jobs = require('./src/jobs');

const server = createApp();
server.listen(cfg.port, () => {
  console.log(`DAWS BET AI running on http://localhost:${cfg.port}  (${cfg.isProd ? 'production' : 'development'})`);
  const { getProvider } = require('./src/providers');
  if (!getProvider().configured) console.log('[setup] No football data provider key found. Copy .env.example to .env and set API_FOOTBALL_KEY. The app will show empty states until then.');
  jobs.start();
});
for (const sig of ['SIGINT', 'SIGTERM']) process.on(sig, () => server.close(() => process.exit(0)));
