/**
 * El catálogo tiene que enseñar lo que el servidor acepta.
 *
 * `tools/list` es la API para un agente: solo puede pedir lo que la ficha le enseña. Esa
 * ficha estaba escrita a mano, al lado de —pero no desde— los esquemas que validan cada
 * llamada, y las dos se separaron: `web_scrape` declaraba 7 propiedades de 16 y
 * `web_crawl` 8 de 17. Nueve opciones de cada una estaban construidas, pagadas,
 * funcionando y invisibles.
 *
 * Ahora la forma se genera desde el esquema (`src/mcp-schema.ts`). Esta prueba es la red:
 * compara las dos listas herramienta por herramienta y falla si alguna vuelve a aceptar
 * algo que no enseña.
 *
 * Salió de pasar la matriz de parámetros de HTTP una segunda vez por MCP.
 */
import { describe, expect, it } from "vitest";
import type { ZodTypeAny } from "zod";
import { mcp } from "../src/mcp";
import { feedbackRequest } from "../src/feedback";
import {
  LIGHT_FORMATS,
  actRequest,
  batchRequest,
  crawlRequest,
  mapRequest,
  scrapeRequest,
  searchRequest,
  sessionRequest,
} from "../src/schema";

const env = {
  BILLING: { prepare: () => ({ bind: () => ({ first: async () => null, run: async () => ({ meta: { changes: 0 } }) }) }) },
} as unknown as Parameters<typeof mcp.request>[2];

const tools = async () => {
  const r = await mcp.request(
    "/mcp",
    { method: "POST", body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list" }), headers: { "content-type": "application/json" } },
    env,
  );
  const { result } = (await r.json()) as { result: { tools: { name: string; inputSchema: { properties: Record<string, unknown> } }[] } };
  return result.tools;
};

/** Las claves que un esquema acepta de verdad, cruzando sus envoltorios. */
function aceptadas(schema: ZodTypeAny): string[] {
  const def = (schema as unknown as { _def: Record<string, unknown> })._def;
  const dentro = (def.schema ?? def.innerType ?? schema) as unknown as { shape?: object };
  return Object.keys(dentro.shape ?? {});
}

/**
 * Lo que cada herramienta valida, y lo que deja fuera de la ficha a propósito.
 *
 * `web_act` valida con `passthrough()` y le pasa el resto del cuerpo al esquema de
 * sesión, así que lo que acepta es lo suyo más lo de la sesión. `html` se omite en las
 * dos herramientas de sesión porque las dos lo rechazan por su nombre: una sesión navega,
 * no hay html crudo al que aplicarle nada.
 */
const TOOLS: Array<[string, string[], string[]]> = [
  ["web_scrape", aceptadas(scrapeRequest), []],
  ["web_session_open", aceptadas(sessionRequest), ["html"]],
  ["web_act", [...aceptadas(actRequest), ...aceptadas(sessionRequest)], ["html"]],
  ["web_scrape_batch", aceptadas(batchRequest), []],
  ["web_map", aceptadas(mapRequest), []],
  ["web_crawl", aceptadas(crawlRequest), []],
  ["web_search_exa", aceptadas(searchRequest), []],
  ["web_feedback", aceptadas(feedbackRequest), []],
];

describe("el catálogo MCP contra el esquema real", () => {
  it.each(TOOLS)("%s no acepta nada que no enseñe", async (nombre, acepta, omitidas) => {
    const tool = (await tools()).find((t) => t.name === nombre);
    expect(tool, `${nombre} no está en el catálogo`).toBeDefined();
    const declaradas = new Set(Object.keys(tool!.inputSchema.properties));
    const invisibles = acepta.filter((k) => !declaradas.has(k) && !omitidas.includes(k));
    expect(invisibles, "el servidor los acepta y el catálogo no los enseña").toEqual([]);
  });

  it("ninguna ficha promete un formato que la ruta rechaza", async () => {
    const lista = await tools();
    for (const nombre of ["web_crawl", "web_scrape_batch"]) {
      const formats = lista.find((t) => t.name === nombre)!.inputSchema.properties.formats as { items: { enum: string[] } };
      expect(formats.items.enum, `${nombre} ofrece algo que luego refusa`).toEqual([...LIGHT_FORMATS]);
    }
  });

  it("describe las opciones que más fácil es escribir mal", async () => {
    const scrape = (await tools()).find((t) => t.name === "web_scrape")!;
    const block = JSON.stringify(scrape.inputSchema.properties.block);
    expect(block, "nadie adivina que son regex y no comodines").toContain("regular expressions");
  });

  it("cada propiedad declarada lleva su explicación", async () => {
    const sin: string[] = [];
    for (const tool of await tools()) {
      for (const [clave, campo] of Object.entries(tool.inputSchema.properties)) {
        if (!(campo as { description?: string }).description) sin.push(`${tool.name}.${clave}`);
      }
    }
    expect(sin, "un agente elige leyendo: una propiedad sin explicación no se usa").toEqual([]);
  });
});
