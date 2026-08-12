/**
 * Planning-only Claude Sonnet cost calculator.
 *
 * The app does not persist token usage yet, so the built-in scenarios are
 * deliberately ranges. Replace them with measured Bedrock usage before using
 * the output for pricing or a financial forecast.
 *
 * Examples:
 *   npx tsx scripts/estimate-claude-cost.ts
 *   npx tsx scripts/estimate-claude-cost.ts --input 120000 --output 20000 --runs 10 --fx 58
 */

const INPUT_USD_PER_MILLION = 3;
const OUTPUT_USD_PER_MILLION = 15;

type Estimate = {
  label: string;
  inputTokens: number;
  outputTokens: number;
};

const scenarios: Record<string, Estimate[]> = {
  "3-patient cascade": [
    { label: "low", inputTokens: 25_000, outputTokens: 4_000 },
    { label: "base", inputTokens: 50_000, outputTokens: 8_000 },
    { label: "high", inputTokens: 100_000, outputTokens: 20_000 },
  ],
  "full live demo": [
    { label: "low", inputTokens: 60_000, outputTokens: 10_000 },
    { label: "base", inputTokens: 120_000, outputTokens: 20_000 },
    { label: "high", inputTokens: 240_000, outputTokens: 40_000 },
  ],
};

function arg(name: string): string | undefined {
  const index = process.argv.indexOf(`--${name}`);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

function positiveNumber(name: string, fallback?: number): number | undefined {
  const raw = arg(name);
  if (raw == null) return fallback;
  const value = Number(raw);
  if (!Number.isFinite(value) || value <= 0) {
    throw new Error(`--${name} must be a positive number`);
  }
  return value;
}

function cost(inputTokens: number, outputTokens: number): number {
  return (
    (inputTokens / 1_000_000) * INPUT_USD_PER_MILLION +
    (outputTokens / 1_000_000) * OUTPUT_USD_PER_MILLION
  );
}

function money(usd: number, fx?: number): string {
  const usdText = `$${usd.toFixed(3)}`;
  return fx ? `${usdText} / ₱${(usd * fx).toFixed(2)}` : usdText;
}

const customInput = positiveNumber("input");
const customOutput = positiveNumber("output");
const runs = positiveNumber("runs", 1)!;
const fx = positiveNumber("fx");

if ((customInput == null) !== (customOutput == null)) {
  throw new Error("Use --input and --output together");
}

console.log(
  `Claude Sonnet planning rate: $${INPUT_USD_PER_MILLION}/M input + $${OUTPUT_USD_PER_MILLION}/M output tokens`,
);
console.log("Prompt caching, batch discounts, and non-model infrastructure are excluded.\n");

if (customInput != null && customOutput != null) {
  const perRun = cost(customInput, customOutput);
  console.table([
    {
      estimate: "custom",
      inputTokens: customInput,
      outputTokens: customOutput,
      runs,
      cost: money(perRun * runs, fx),
    },
  ]);
} else {
  for (const [name, estimates] of Object.entries(scenarios)) {
    console.log(name);
    console.table(
      estimates.map((estimate) => ({
        estimate: estimate.label,
        inputTokens: estimate.inputTokens,
        outputTokens: estimate.outputTokens,
        costPerRun: money(cost(estimate.inputTokens, estimate.outputTokens), fx),
      })),
    );
  }
}

