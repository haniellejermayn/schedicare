import { loadEnvConfig } from "@next/env";

async function bootstrap() {
  loadEnvConfig(process.cwd());
  await import("./index");
}

bootstrap().catch((error) => {
  console.error("[worker] bootstrap failed:", error);
  process.exitCode = 1;
});
