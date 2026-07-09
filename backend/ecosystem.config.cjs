// PM2 process file for the VPS (160.153.179.249).
// Usage on the server:  pm2 start ecosystem.config.cjs && pm2 save
// NOTE: ports 3000/3001 are reserved for Vigil — Limitless runs on 4000.
module.exports = {
  apps: [
    {
      name: 'limitless-backend',
      script: 'src/server.js',
      cwd: __dirname,
      instances: 1,
      autorestart: true,
      max_memory_restart: '400M',
      env: {
        NODE_ENV: 'production',
        PORT: 4000,
      },
    },
  ],
};
