import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// In local dev (`npm run dev`), /api is proxied to the Express backend.
// In Docker, nginx does the same proxying (see nginx.conf).
export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: { '/api': process.env.API_TARGET || 'http://localhost:4000' },
  },
});
