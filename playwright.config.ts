import { defineConfig, devices } from "@playwright/test";
import "dotenv/config";

const testUrl = process.env.TEST_DATABASE_URL;
if (!testUrl || new URL(testUrl).pathname !== "/unieventos_test" || testUrl === process.env.DATABASE_URL) {
  throw new Error("Os testes exigem TEST_DATABASE_URL apontando para unieventos_test, separado do banco da aplicação.");
}

export default defineConfig({
  testDir: "./tests/e2e",
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  reporter: "list",
  use: {
    baseURL: "http://127.0.0.1:3100",
    channel: process.env.PLAYWRIGHT_CHANNEL,
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },
  projects: [
    { name: "desktop", use: { ...devices["Desktop Chrome"], viewport: { width: 1440, height: 1000 } } },
    { name: "mobile", use: { ...devices["Pixel 7"], viewport: { width: 393, height: 851 } } },
  ],
  webServer: {
    command: "node scripts/test-database.mjs server",
    url: "http://127.0.0.1:3100",
    reuseExistingServer: process.env.PLAYWRIGHT_REUSE_TEST_SERVER === "1",
    timeout: 30_000,
  },
});
