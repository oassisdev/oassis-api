/**
 * Todo precio que la puerta del monedero pueda cotizar tiene que poder pagarse.
 *
 * El facilitador rechaza por debajo de `MIN_CHARGE`, y lo rechaza **después** de que
 * el cliente haya firmado: devuelve un 402 pelado, sin motivo. Una ruta por debajo del
 * mínimo no es barata, es incomprable. Pasó con `map` e `includePage: false`, que
 * costaba 300 y no se podía comprar con monedero de ninguna manera.
 */
import { describe, expect, it } from "vitest";
import { MIN_CHARGE, PER_FORMAT, mapPrice, priceOfRequest, scrapePrice } from "../src/billing/prices";
import type { Format } from "../src/types";

const FORMATOS = Object.keys(PER_FORMAT) as Format[];

describe("ningún precio cotizable baja del mínimo", () => {
  it("map, con página y sin ella", () => {
    expect(mapPrice(false)).toBeGreaterThanOrEqual(MIN_CHARGE);
    expect(mapPrice(true)).toBeGreaterThanOrEqual(MIN_CHARGE);
  });

  it("cada formato por separado, que es el scrape más barato posible", () => {
    for (const f of FORMATOS) expect(scrapePrice([f]), f).toBeGreaterThanOrEqual(MIN_CHARGE);
  });

  it("lo que cotiza la puerta en cada ruta, con el cuerpo más escueto que acepta", () => {
    const minimos: Array<[Parameters<typeof priceOfRequest>[0], Record<string, unknown>]> = [
      ["map", { includePage: false }],
      ["map", { includePage: true }],
      ["scrape", {}],
      ["scrape", { formats: ["markdown"] }],
      ["session", {}],
      ["act", { actions: [{}] }],
      ["batch", { urls: ["https://oassis.dev"] }],
      ["crawl", { limit: 1 }],
    ];
    for (const [ruta, cuerpo] of minimos) {
      expect(priceOfRequest(ruta, cuerpo as never), `${ruta} ${JSON.stringify(cuerpo)}`).toBeGreaterThanOrEqual(MIN_CHARGE);
    }
  });
});
