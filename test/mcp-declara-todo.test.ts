import { describe, expect, it } from "vitest";
import { mcp } from "../src/mcp";
import { scrapeRequest } from "../src/schema";

/**
 * El catálogo tiene que enseñar lo que el servidor acepta.
 *
 * `tools/list` declaraba siete propiedades de las dieciséis que valida el esquema. Las
 * otras nueve funcionaban —el servidor usa el mismo esquema venga por donde venga— pero
 * eran invisibles: un agente solo puede pedir lo que el catálogo le enseña, así que nadie
 * podía pedir una captura de página completa, un PDF en A4 o bloquear imágenes.
 *
 * Salió de pasar la matriz de parámetros de HTTP una segunda vez por MCP.
 */
const env = {
  BILLING: { prepare: () => ({ bind: () => ({ first: async () => null, run: async () => ({ meta: { changes: 0 } }) }) }) },
} as unknown as Parameters<typeof mcp.request>[2];

const tools = async () => {
  const r = await mcp.request(
    "/mcp",
    { method: "POST", body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list" }), headers: { "content-type": "application/json" } },
    env,
  );
  return (await r.json()).result.tools as { name: string; inputSchema: { properties: Record<string, unknown> } }[];
};

describe("el catálogo MCP contra el esquema real", () => {
  it("declara en web_scrape todo lo que el esquema acepta", async () => {
    const scrape = (await tools()).find((t) => t.name === "web_scrape")!;
    const declarados = new Set(Object.keys(scrape.inputSchema.properties));
    const aceptados = Object.keys((scrapeRequest as unknown as { _def: { schema: { shape: object } } })._def.schema.shape);
    const invisibles = aceptados.filter((k) => !declarados.has(k));
    expect(invisibles, "el servidor los acepta y el catálogo no los enseña").toEqual([]);
  });

  it("describe las opciones que más fácil es escribir mal", async () => {
    const scrape = (await tools()).find((t) => t.name === "web_scrape")!;
    const block = JSON.stringify(scrape.inputSchema.properties.block);
    expect(block, "nadie adivina que son regex y no comodines").toContain("regular expressions");
  });
});
