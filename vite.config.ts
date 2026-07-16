import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";
import { fileURLToPath, URL } from "node:url";

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      "@shared": fileURLToPath(new URL("./src/shared", import.meta.url)),
      "@server": fileURLToPath(new URL("./src/server", import.meta.url)),
      "@client": fileURLToPath(new URL("./src/client", import.meta.url))
    }
  },
  build: {
    outDir: "dist/client",
    emptyOutDir: true,
    sourcemap: false,
    rollupOptions: {
      output: {
        entryFileNames: "assets/index.js",
        chunkFileNames: "assets/[name].js",
        assetFileNames: "assets/[name][extname]"
      }
    }
  },
  server: {
    port: 5173,
    host: "127.0.0.1"
  },
  test: {
    environment: "jsdom",
    exclude: ["test/e2e/**", "node_modules/**", "dist/**", ".worktrees/**"],
    coverage: {
      provider: "v8",
      reporter: ["text", "lcov"],
      thresholds: {
        lines: 80,
        functions: 87,
        branches: 66,
        statements: 80
      },
      include: [
        "src/shared/**/*.ts",
        "src/server/config/**/*.ts",
        "src/server/controllers/**/*.ts",
        "src/server/data/**/*.ts",
        "src/server/http/**/*.ts",
        "src/server/services/**/*.ts"
      ],
      exclude: [
        ".worktrees/**",
        "dist/**",
        "src/client/**",
        "src/server/assets/**",
        "src/server/app.module.ts",
        "src/server/data/cleanup.ts",
        "src/server/data/migrate.ts",
        "src/server/data/postgres-repositories.ts",
        "src/server/data/schema.ts",
        "test/**",
        "src/server/main.ts"
      ]
    }
  }
});
