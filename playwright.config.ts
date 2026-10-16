import { defineConfig } from "@playwright/test";

// Runs against the local stack: `npx supabase start`, `.env.local`, and a production build (`npm run build`).
export default defineConfig({
  testDir: "tests/e2e",
  globalSetup: "./tests/e2e/global-setup.ts",
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: [["list"]],
  use: { baseURL: "http://localhost:3100", trace: "retain-on-failure" },
  webServer: { command: "npx next start -p 3100", url: "http://localhost:3100", reuseExistingServer: true, timeout: 60_000 },
});
