import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';

// Dev proxy for the coach endpoint: the client calls the relative path
// /api/coach so no key or provider URL lives in client code or config.
export default defineConfig(({ mode }) => {
  const port = loadEnv(mode, process.cwd(), 'COACH_PORT').COACH_PORT || '8787';
  const proxy = {
    '/api/coach': {
      target: `http://127.0.0.1:${port}`,
      changeOrigin: true,
    },
  };
  return { plugins: [react()], server: { proxy }, preview: { proxy } };
});
