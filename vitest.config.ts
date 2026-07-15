import { defineConfig } from "vitest/config";
import path from "node:path";

export default defineConfig({
  test: {
    environment: "node",
    include: ["tests/**/*.test.ts"],
    fileParallelism: false,
    env: {
      DATABASE_URL: "file:./.tmp/test.db",
      DEMO_NOW: "2026-08-10T07:30:00+08:00",
      AI_PROVIDER: "fallback",
      CALENDAR_PROVIDER: "simulated",
      MAIL_PROVIDER: "simulated",
      FALLBACK_ENABLED: "true",
      PACING_MS: "0",
      AUTO_SIMULATE_REPLIES: "false",
      TZ: "UTC"
    },
    testTimeout: 30000
  },
  resolve: { alias: { "@": path.resolve(__dirname, ".") } }
});
