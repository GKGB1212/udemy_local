import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  // Tên repo trên GitHub Pages: https://<user>.github.io/udemy_local/
  base: '/udemy_local/',
  plugins: [react()],
  server: { open: true },
})
