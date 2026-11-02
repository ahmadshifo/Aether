
import { defineConfig } from 'vite'
import type { ProxyOptions } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { VitePWA } from 'vite-plugin-pwa'

// Server-only, loopback-only development transport. Never bundled as VITE_* config.
const authTarget = process.env.AUTH_PROXY_TARGET || 'http://127.0.0.1:8002'
const authPort = /^http:\/\/127\.0\.0\.1:(\d{1,5})$/.exec(authTarget)?.[1]
if (!authPort || Number(authPort) < 1 || Number(authPort) > 65535) throw new Error('AUTH_PROXY_TARGET must be http://127.0.0.1:<port>')
const authProxy: Record<string, ProxyOptions> = {
  '^/api/v1/auth(?:/|$)': {
    target: authTarget,
    configure(proxy) {
      proxy.on('proxyRes', response => { response.headers['cache-control'] = 'no-store' })
    },
  },
}

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
    proxy: authProxy,
    allowedHosts: [
      'jessica-prices-hello-indicator.trycloudflare.com',
    ],
  },
  preview: { proxy: authProxy },
})
