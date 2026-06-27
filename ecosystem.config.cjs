/** PM2 — pm2 start ecosystem.config.cjs */
module.exports = {
  apps: [{
    name: 'pixelmania',
    script: 'server.js',
    instances: 1,
    exec_mode: 'fork',
    autorestart: true,
    max_memory_restart: '512M',
    env: {
      NODE_ENV: 'development',
    },
    env_production: {
      NODE_ENV: 'production',
    },
    listen_timeout: 10000,
    kill_timeout: 12000,
  }],
};
