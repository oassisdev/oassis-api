import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";

/**
 * Las dos puertas tienen que decir lo mismo.
 *
 * Cada operación está escrita dos veces: la ruta HTTP en `index.ts` y la tool MCP en
 * `mcp.ts`. El precio sí es común —las dos llaman a `priceOfRequest`— pero **las
 * decisiones de devolver el dinero están duplicadas**, y ahí es donde se separan.
 *
 * Cuatro de los cinco fallos de cobro que aparecieron probando los siete endpoints eran
 * esto: una puerta devolvía y la otra no. El último, una sesión que no abre, se encontró
 * justo comparando esta lista, no llamando a la API.
 */
const http = readFileSync("src/index.ts", "utf8");
const mcp = readFileSync("src/mcp.ts", "utf8");

const motivos = (src: string) =>
  new Set((src.match(/"refund: [^"]*"/g) ?? []).map((m) => m.slice(9, -1)));

describe("las dos puertas", () => {
  /**
   * `the request was not valid` solo existe en MCP a propósito: el guardia de HTTP valida
   * antes de cobrar, así que allí no hay nada que devolver.
   */
  const SOLO_MCP = new Set(["the request was not valid"]);

  it("devuelven el dinero por los mismos motivos", () => {
    const enHttp = motivos(http);
    const enMcp = motivos(mcp);
    const faltanEnMcp = [...enHttp].filter((m) => !enMcp.has(m));
    const faltanEnHttp = [...enMcp].filter((m) => !enHttp.has(m) && !SOLO_MCP.has(m));
    expect(faltanEnMcp, "HTTP devuelve por esto y MCP no").toEqual([]);
    expect(faltanEnHttp, "MCP devuelve por esto y HTTP no").toEqual([]);
  });

  it("cierran la sesión que no llegó a abrirse, las dos", () => {
    for (const [nombre, src] of [["HTTP", http], ["MCP", mcp]] as const) {
      expect(src, `${nombre} deja la fila abierta`).toContain("closeSession");
      expect(src, `${nombre} no devuelve la sesión fallida`).toContain("session did not open");
    }
  });

  it("devuelven las acciones que nunca corrieron, las dos", () => {
    for (const [nombre, src] of [["HTTP", http], ["MCP", mcp]] as const) {
      expect(src, `${nombre} cobra acciones que no se ejecutaron`).toContain("action(s) never ran");
    }
  });

  /** El precio sí es común. Si dejara de serlo, las dos puertas podrían cobrar distinto. */
  it("calculan el precio con la misma función", () => {
    expect(mcp).toContain("priceOfRequest");
    expect(readFileSync("src/billing/index.ts", "utf8")).toContain("priceOfRequest");
  });
});
