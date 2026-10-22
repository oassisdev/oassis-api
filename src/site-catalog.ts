import { AGENT_NAMES } from './agents/catalog';

/** Canonical public HTML pages; auth and machine endpoints are intentionally excluded. */
export const SITE_PATHS = [
  '/', '/try', '/docs', '/task-api', '/web-scraping-api', '/web-crawling-api',
  '/browser-api', '/mcp', '/x402', '/use-cases', '/agents',
  ...AGENT_NAMES.map(name => `/agents/${name}`), '/privacy', '/terms',
];
