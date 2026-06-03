// PM2 process definition for the DEMI Workspace cockpit.
//
// Serve Tailscale-private. Set TAILSCALE_IP to the tailnet address so the app
// binds to the tailnet only (never 0.0.0.0, never public nginx). Find it with:
//   tailscale ip -4
//
//   pm2 start ecosystem.config.js
//   pm2 save
//
// Build first:  npm run build
module.exports = {
  apps: [
    {
      name: "demi-workspace",
      cwd: "/home/demi/projects/demi-workspace",
      script: "node_modules/next/dist/bin/next",
      args: "start -H ${TAILSCALE_IP:-127.0.0.1} -p 3005",
      interpreter: "node",
      env: {
        NODE_ENV: "production",
        PORT: "3005",
        HERMES_DASHBOARD_URL: "http://127.0.0.1:9119",
        NEXT_PUBLIC_HERMES_CHAT_URL: "http://127.0.0.1:9119/chat",
      },
      autorestart: true,
      max_restarts: 10,
      time: true,
    },
  ],
};
