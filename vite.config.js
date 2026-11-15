import react from '@vitejs/plugin-react'
import basicSsl from '@vitejs/plugin-basic-ssl'
import { defineConfig } from 'vite'

// https://vite.dev/config/
// The Martial agent's back end (python -m backend.server). Answers can take a minute on CPU-only Ollama.
const api = { '/api': { target: 'http://127.0.0.1:8000', timeout: 300000, proxyTimeout: 300000 } }

export default defineConfig(({ mode }) => {
  // `npm run quest`: serve over HTTPS on the Wi-Fi network so a Meta Quest can open the VR page
  // directly (WebXR needs https). Uses a self-signed certificate; no Developer Mode or adb needed.
  if (mode === 'quest') {
    return {
      plugins: [react(), basicSsl()],
      server: { host: true, port: 5173, strictPort: true, proxy: api },
    }
  }

  return {
    plugins: [react()],
    server: {
      // IPv4 on a fixed port: `adb reverse tcp:5173 tcp:5173` forwards the Meta Quest's
      // localhost:5173 to 127.0.0.1:5173 on this computer (Vite would otherwise listen on IPv6 ::1 only).
      host: '127.0.0.1',
      port: 5173,
      strictPort: true,
      proxy: api,
    },
    preview: { proxy: api },
  }
})
