import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// Member 2: dashboard on :5174; /api/v1/auth is forwarded to the AI backend so the login cookie is same-origin,
// /api/v1/streams to the AI backend (which stream this account's phone is publishing),
// /api/v1/voice to Member 1's voice service (the AI history cassette plays its MP3), and /v3 to MediaMTX's
// stream list (enabled on 127.0.0.1:9997) so the Live Camera page can find the phone's stream.
const proxy = {
  '/api/v1/auth': 'http://localhost:8002',
  '/api/v1/streams': 'http://localhost:8002',
  '/api/v1/voice': 'http://localhost:8001',
  '/v3': 'http://127.0.0.1:9997',
};

export default defineConfig({
  plugins: [react()],
  server: { port: 5174, strictPort: true, proxy },
  preview: { port: 5174, strictPort: true, proxy },
});
