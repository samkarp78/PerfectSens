import { defineConfig } from 'vitest/config';
import preact from '@preact/preset-vite';

export default defineConfig({
  plugins: [preact()],
  base: './',
  test: { include: ['tests/**/*.test.ts'], testTimeout: 120000 },
});
