import { defineConfig } from 'vite';
import { fileURLToPath } from 'node:url';
import basicSsl from '@vitejs/plugin-basic-ssl';

const here = (p: string) => fileURLToPath(new URL(p, import.meta.url));

// `npm run dev:https` serves over HTTPS with a self-signed certificate so phones on your
// Wi-Fi can use motion sensors while you develop (accept the certificate warning once).
export default defineConfig(({ mode }) => ({
  base: './',
  plugins: mode === 'https' ? [basicSsl()] : [],
  build: {
    target: 'es2020',
    chunkSizeWarningLimit: 2500,
    rollupOptions: {
      input: {
        tv: here('./index.html'),
        pad: here('./p/index.html'),
      },
    },
  },
}));
