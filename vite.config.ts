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
    manifest: true,
    sourcemap: false,
    rollupOptions: {
      output: {
        entryFileNames: "assets/index.js",
        // Route-level chunks are content-addressed so a page opened during a
        // deployment cannot reuse an older view implementation from cache.
        chunkFileNames: "assets/[name]-[hash].js",
        assetFileNames: "assets/[name][extname]",
        manualChunks(moduleId) {
          if (/[/\\]node_modules[/\\](?:react|react-dom|scheduler)[/\\]/u.test(moduleId)) {
            return "react-vendor";
          }
          if (/[/\\]node_modules[/\\]lucide-react[/\\]/u.test(moduleId)) {
            return "icons";
          }
          return undefined;
        }
      }
    }
  },
  server: {
    port: 5173,
    host: "127.0.0.1"
  },
  test: {
    environment: "jsdom",
    // Several installer and supply-chain suites spawn native tools. Keep enough
    // parallelism for fast CI without saturating constrained container hosts.
    maxWorkers: 4,
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
        "src/server/data/postgres/**",
        "src/server/data/postgres-repositories.ts",
        "src/server/data/schema.ts",
        "test/**",
        "src/server/main.ts"
      ]
    }
  }
});
