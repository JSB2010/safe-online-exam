import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
  testDir: "test/e2e",
  timeout: 30_000,
  fullyParallel: true,
  use: {
    baseURL: "http://127.0.0.1:8080",
    trace: "on-first-retry",
    screenshot: "only-on-failure"
  },
  webServer: {
    command:
      "npm run build && HOST=127.0.0.1 PORT=8080 USE_IN_MEMORY_STORE=true TOOL_URL=http://localhost:8080 LTI_CLIENT_ID=test-client CANVAS_API_CLIENT_ID=test CANVAS_API_CLIENT_SECRET=test npm start",
    url: "http://127.0.0.1:8080/health",
    reuseExistingServer: !process.env.CI,
    timeout: 120_000
  },
  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] }
    },
    {
      name: "mobile",
      use: { ...devices["Pixel 7"] }
    }
  ]
});
