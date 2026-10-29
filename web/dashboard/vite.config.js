import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// Member 2: dashboard on :5174; /api/v1/auth is forwarded to the AI backend so the login cookie is same-origin,
// and /v3 to MediaMTX's stream list (enabled on 127.0.0.1:9997) so the Live Camera page can find the phone's stream.
const proxy = {
  '/api/v1/auth': 'http://localhost:8002',
  '/v3': 'http://127.0.0.1:9997',
};

export default defineConfig({
  plugins: [react()],
  server: { port: 5174, strictPort: true, proxy },
  preview: { port: 5174, strictPort: true, proxy },
});
