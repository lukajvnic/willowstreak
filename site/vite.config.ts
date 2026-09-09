import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// 5173 on purpose: it is the origin already in the backend's BACKEND_CORS_ORIGINS.
export default defineConfig({
  plugins: [react()],
  server: { port: 5173, strictPort: true },
})
