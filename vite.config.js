import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// base './' -> Assets funktionieren auch per file:// in der gepackten App
export default defineConfig({
  base: './',
  plugins: [react()],
  server: { port: 5173, strictPort: true },
});
