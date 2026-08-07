/**
 * Side-effect import: load .env.local / .env the same way the worker does
 * (worker/bootstrap.ts), BEFORE any module calls env() — core/clock.ts reads
 * env() at import time, so this must be the FIRST import of any tsx entry
 * point that should honor the env files.
 */
import { loadEnvConfig } from "@next/env";

loadEnvConfig(process.cwd());
