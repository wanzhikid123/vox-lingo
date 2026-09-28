import { defineConfig } from "@playwright/test";
export default defineConfig({
  testDir: "./test/browser",
  workers: 1,
  use: {
    baseURL: "http://127.0.0.1:3214",
    viewport: { width: 1440, height: 1000 },
  },
  webServer: {
    command: "node test/browser-server.js",
    url: "http://127.0.0.1:3214/api/health",
    reuseExistingServer: false,
    timeout: 20000,
  },
  reporter: "list",
});
