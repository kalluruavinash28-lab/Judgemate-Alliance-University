import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
export default defineConfig({ base: '/in/', plugins: [react()], build: { outDir: 'dist/in' } });
