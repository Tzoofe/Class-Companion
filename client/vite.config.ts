import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    // IPv4 loopback: Tailscale Funnel proxies to 127.0.0.1 (Vite's default may bind only ::1). Still local-only.
    host: '127.0.0.1',
    // Tunnel hostnames: Tailscale Funnel (fixed, needed for home-screen app + push) and Cloudflare quick tunnels.
    allowedHosts: ['.ts.net', '.trycloudflare.com'],
    proxy: {
      '/api': 'http://localhost:3000',
    },
  },
});
