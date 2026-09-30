import { describe, expect, it } from "vitest";
import { payerAddress, walletIdentity } from "../src/billing/payer";

/** An x402 `exact` payment header: base64 JSON with the signed EIP-3009 authorisation. */
const header = (payload: unknown) => btoa(JSON.stringify({ x402Version: 2, payload }));

describe("who paid with a wallet", () => {
  it("reads the address that signed the payment", () => {
    const h = header({ authorization: { from: "0xAbC1230000000000000000000000000000000001" } });
    expect(payerAddress(h)).toBe("0xabc1230000000000000000000000000000000001");
  });

  it("accepts the flatter shape some versions send", () => {
    expect(payerAddress(header({ from: "0x0000000000000000000000000000000000000abc" }))).toBe(
      "0x0000000000000000000000000000000000000abc",
    );
  });

  it("an unreadable header is an unknown payer, never a crash", () => {
    expect(payerAddress(undefined)).toBeNull();
    expect(payerAddress("not base64 at all !!")).toBeNull();
    expect(payerAddress(btoa("{}"))).toBeNull();
    expect(payerAddress(header({ authorization: {} }))).toBeNull();
  });

  it("anything that is not an address is not something to key on", () => {
    expect(payerAddress(header({ authorization: { from: "vitalik.eth" } }))).toBeNull();
    expect(payerAddress(header({ authorization: { from: "0x123" } }))).toBeNull();
    expect(payerAddress(header({ authorization: { from: 42 } }))).toBeNull();
  });

  it("the identity is the address, lowercased, under a prefix that cannot collide with a uuid", () => {
    expect(walletIdentity("0xABC1230000000000000000000000000000000001")).toBe(
      "wallet:0xabc1230000000000000000000000000000000001",
    );
    // Two spellings of one address are one caller, which is what makes ownership work.
    expect(walletIdentity("0xABC1230000000000000000000000000000000001")).toBe(
      walletIdentity("0xabc1230000000000000000000000000000000001"),
    );
  });
});
