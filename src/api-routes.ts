/** One definitive path per operation, identical on every API host. */
export const RESEARCH_ROUTE = '/tasks/v1/research';
export function productPath(suffix: string): string {
 const family = /^(?:crawl|scrape\/batch)(?:\/|$)/.test(suffix) ? '/tasks/v1' : '/web/v1';
 return `${family}/${suffix}`;
}
