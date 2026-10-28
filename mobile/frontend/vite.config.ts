
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { VitePWA } from 'vite-plugin-pwa'

export default defineConfig({
  plugins: [
    react(),
    tailwindcss(),
    VitePWA({
      registerType: 'autoUpdate',
      manifest: {
        name: 'EchoSight - Accessible Visual Assistant',
        short_name: 'EchoSight',
        description:
          'AI visual assistant for blind and visually impaired users',
        theme_color: '#071724',
        background_color: '#071724',
        display: 'standalone',
        start_url: '/',
        scope: '/',
        icons: [],
      },
    }),
  ],
  server: {
    allowedHosts: [
      'jessica-prices-hello-indicator.trycloudflare.com',
    ],
  },
})
