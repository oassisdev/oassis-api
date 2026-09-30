/**
 * The one version number.
 *
 * It was in four places — the MCP handshake, the OpenAPI document, server.json and
 * package.json — and they had already drifted apart: the registry said 1.0.1 while a client
 * connecting to the same server was told 1.0.0. A test fails if they stop agreeing, because
 * nothing else would notice.
 *
 * Raise it here, then republish the registry entry with `mcp-publisher publish`: the
 * registry refuses a version it has already seen.
 */
export const VERSION = "1.0.1";
