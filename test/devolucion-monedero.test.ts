/**
 * Lo que no se puede devolver, hay que decirlo donde el que paga lo lee.
 *
 * `crawl` y `batch` cobran por adelantado las páginas o urls *permitidas* y devuelven las
 * que nunca se leen. Pero una devolución es un apunte en una cuenta, y un pago con
 * monedero se liquida en cadena: no hay cuenta donde ingresarlo. Comprobado con dinero
 * real — $0.02 por 10 páginas permitidas, leyó 4, no volvió nada — mientras el README
 * prometía la devolución a todo el mundo.
 *
 * El 402 lleva el documento de la ruta como cuerpo, así que decirlo en `docs.ts` es
 * decirlo en el momento de pagar, que es el único que sirve.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { batchDoc, crawlDoc } from "../src/docs";

const c = { env: { BASE_URL: "https://api.oassis.dev" }, req: { path: "/web/v1/crawl" } } as never;

describe("el límite de la devolución", () => {
  it.each([
    ["crawl", crawlDoc],
    ["batch", batchDoc],
  ])("%s lo avisa en el documento que viaja dentro del 402", (_n, doc) => {
    const notas = (doc(c).notes as string[]).join(" ");
    expect(notas, "quien paga con monedero tiene que saberlo antes de firmar").toMatch(/wallet payment is settled on-chain/);
    expect(notas).toMatch(/cannot be reversed/);
  });

  it("el README no promete una devolución que el monedero no recibe", () => {
    const readme = readFileSync("README.md", "utf8");
    expect(readme).toMatch(/needs an API key/);
    expect(readme).toMatch(/with x402 you pay for what you ask for/);
  });
});
