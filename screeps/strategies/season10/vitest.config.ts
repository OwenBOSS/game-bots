import { defineConfig } from 'vitest/config';

export default defineConfig({
    test: {
        globals: true,
        setupFiles: ['./src/__tests__/setup.ts'],
        environment: 'node',
        include: ['src/__tests__/**/*.test.ts'],
    },
});
