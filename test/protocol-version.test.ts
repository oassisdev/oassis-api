import { describe, expect, it } from "vitest";
import { mcp } from "../src/mcp";

/**
 * El servidor contestaba `2025-06-18` a todo el mundo. La especificación dice que si
 * soportas la versión pedida tienes que devolver **esa misma**, y solo si no, una tuya.
 * Un cliente que pedía `2025-03-26` recibía una que no había pedido y, según el
 * protocolo, debe colgar — aunque aquí nada necesite la nueva.
 *
 * Salió de un validador externo que hizo justo esa llamada.
 */
const env = {
  BILLING: { prepare: () => ({ bind: () => ({ first: async () => null, run: async () => ({ meta: { changes: 0 } }) }) }) },
} as unknown as Parameters<typeof mcp.request>[2];

const initialize = async (protocolVersion?: string) => {
  const r = await mcp.request(
    "/mcp",
    {
      method: "POST",
      body: JSON.stringify({
        jsonrpc: "2.0", id: 1, method: "initialize",
        params: protocolVersion ? { protocolVersion, capabilities: {} } : { capabilities: {} },
      }),
      headers: { "content-type": "application/json" },
    },
    env,
  );
  return (await r.json()) as any;
};

describe("negociación de versión", () => {
  it("devuelve la versión que el cliente pidió, cuando la hablamos", async () => {
    for (const v of ["2025-06-18", "2025-03-26", "2024-11-05"]) {
      const { result } = await initialize(v);
      expect(result.protocolVersion, `pidió ${v}`).toBe(v);
    }
  });

  it("devuelve la nuestra cuando pide una que no hablamos", async () => {
    const { result } = await initialize("1999-01-01");
    expect(result.protocolVersion).toBe("2025-06-18");
  });

  it("devuelve la nuestra cuando no pide ninguna", async () => {
    const { result } = await initialize();
    expect(result.protocolVersion).toBe("2025-06-18");
  });
});
