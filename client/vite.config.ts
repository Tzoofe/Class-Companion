import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    // Allow the Cloudflare quick-tunnel hostname (changes every run).
    allowedHosts: ['.trycloudflare.com'],
    proxy: {
      '/api': 'http://localhost:3000',
    },
  },
});
