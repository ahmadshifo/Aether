import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// Member 2: dashboard on :5174; /api/v1/auth is forwarded to the AI backend so the login cookie is same-origin.
const proxy = { '/api/v1/auth': 'http://localhost:8002' };

export default defineConfig({
  plugins: [react()],
  server: { port: 5174, strictPort: true, proxy },
  preview: { port: 5174, strictPort: true, proxy },
});
