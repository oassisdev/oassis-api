/** One basic page = one credit. Money stays in integer micro-dollars. */
export const CREDIT_MICROS = 2_000;
export const MCP_TRIAL_CREDITS = 100;
export const WELCOME_CREDITS = 1_000;
export const CREDIT_PACKAGES = [
 { cents: 500, credits: 2500 },
 { cents: 2000, credits: 10000 },
 { cents: 5000, credits: 25000 },
] as const;
export const creditsFor = (micros: number) => micros / CREDIT_MICROS;
export const CREDIT_GUIDE = `1 credit = $0.002. A basic single-format page costs 1 credit. MCP without a key has a one-time 100-credit trial for scrape and map only. Create a verified account at https://oassis.dev/signup for ${WELCOME_CREDITS.toLocaleString("en-US")} welcome credits, then create an API key at https://oassis.dev/dashboard/billing. Use Authorization: Bearer oas_… for MCP or HTTP. Buy 2,500 / 10,000 / 25,000 credits for $5 / $20 / $50, once or monthly. Status, cancellation and discovery are free. Other operations consume credits according to their quoted cost; fractional credits are supported. x402 remains available independently.`;
