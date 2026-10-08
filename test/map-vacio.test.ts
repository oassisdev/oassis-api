/**
 * Una lista vacía son dos respuestas distintas, y solo una es un fallo.
 *
 * El sitio que no dio nada se devuelve y contesta 502. El sitio que sí dio sus urls y
 * vio cómo `search` o `includePaths` las descartaba todas es una respuesta completa: el
 * trabajo se hizo, el filtro era del que llama, y "ninguna de tus 7 urls encaja" es algo
 * que merece saberse. Antes las dos contestaban 502, así que filtrar y no encontrar nada
 * parecía una avería del sitio.
 *
 * Salió de pasar la matriz de `map` por las dos puertas.
 */
import { describe, expect, it } from "vitest";
import { mapSite } from "../src/map";
import { mapRequest } from "../src/schema";

const SITEMAP = `<?xml version="1.0"?><urlset>
  <url><loc>https://sitio.test/</loc></url>
  <url><loc>https://sitio.test/precios</loc></url>
  <url><loc>https://sitio.test/legal</loc></url>
</urlset>`;

/** Contesta por el sitio sin salir a la red: robots vacío y el sitemap de arriba. */
const servido = (url: string) =>
  url.endsWith("/robots.txt") ? "" : url.endsWith("/sitemap.xml") ? SITEMAP : null;

const mapear = (cuerpo: Record<string, unknown>) =>
  mapSite(mapRequest.parse({ url: "https://sitio.test", includePage: false, ...cuerpo }), async () => [], servido);

describe("el vacío de map", () => {
  it("un filtro que no encaja con nada: vacío, pero el sitio sí ofreció", async () => {
    const res = await mapear({ search: "zzznoexiste" });
    expect(res.urls).toEqual([]);
    expect(res.offered, "lo que el sitio puso sobre la mesa").toBe(3);
  });

  it("un sitio que no contesta: vacío y sin nada ofrecido, que es lo que se devuelve", async () => {
    const res = await mapSite(
      mapRequest.parse({ url: "https://sitio.test", includePage: false }),
      async () => [],
      () => "",
    );
    expect(res.urls).toEqual([]);
    expect(res.offered, "nada que cobrar").toBe(0);
  });

  it("excludePaths gana cuando los dos filtros se solapan", async () => {
    const res = await mapear({ includePaths: ["/legal"], excludePaths: ["/legal"] });
    expect(res.urls).toEqual([]);
    expect(res.offered).toBe(3);
  });

  it("includePaths vacío no filtra nada", async () => {
    expect((await mapear({ includePaths: [] })).urls).toHaveLength(3);
  });

  it("offered cuenta lo mirado, no lo que el sitio guarda: el límite corta el recuento", async () => {
    expect((await mapear({ limit: 1 })).offered).toBe(1);
  });
});
