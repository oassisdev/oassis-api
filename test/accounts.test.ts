import { describe, expect, it } from "vitest";
import { charge, generateKey, hashKey, KEY_PREFIX, sessionAccess } from "../src/billing/accounts";

/**
 * Fake D1: only enough to exercise the charging logic, which is what decides
 * whether an account can go negative. The conditional UPDATE is imitated with its
 * own rule: it changes rows only when the balance covers the charge.
 */
function fakeD1(startingBalance: number, active = true) {
  const state = { balance: startingBalance, entries: [] as { micros: number; concept: string }[] };
  const db = {
    prepare(sql: string) {
      return {
        bind(...args: unknown[]) {
          return {
            async run() {
              if (sql.includes("UPDATE accounts SET balance_micros = balance_micros - ")) {
                const micros = args[0] as number;
                if (!active || state.balance < micros) return { meta: { changes: 0 } };
                state.balance -= micros;
                return { meta: { changes: 1 } };
              }
              if (sql.includes("INSERT INTO transactions")) {
                state.entries.push({ micros: args[2] as number, concept: args[3] as string });
                return { meta: { changes: 1 } };
              }
              return { meta: { changes: 0 } };
            },
            async first() {
              if (sql.includes("SELECT balance_micros")) return { balance: state.balance };
              return null;
            },
          };
        },
      };
    },
  } as unknown as D1Database;
  return { db, state };
}

describe("charge", () => {
  it("debits and leaves a transaction", async () => {
    const { db, state } = fakeD1(50_000);
    const balance = await charge(db, "a1", { concept: "scrape", micros: 4_000 });
    expect(balance).toBe(46_000);
    expect(state.entries).toEqual([{ micros: -4_000, concept: "scrape" }]);
  });

  it("charges nothing when the balance falls short, and says so with null", async () => {
    const { db, state } = fakeD1(3_000);
    expect(await charge(db, "a1", { concept: "scrape", micros: 4_000 })).toBeNull();
    expect(state.balance).toBe(3_000);
    expect(state.entries).toEqual([]);
  });

  it("an exact balance is enough", async () => {
    const { db } = fakeD1(4_000);
    expect(await charge(db, "a1", { concept: "scrape", micros: 4_000 })).toBe(0);
  });

  it("a disabled account neither pays nor consumes", async () => {
    const { db, state } = fakeD1(100_000, false);
    expect(await charge(db, "a1", { concept: "scrape", micros: 4_000 })).toBeNull();
    expect(state.balance).toBe(100_000);
  });

  it("a zero or negative amount never touches the balance", async () => {
    const { db, state } = fakeD1(10_000);
    expect(await charge(db, "a1", { concept: "nothing", micros: 0 })).toBeNull();
    expect(await charge(db, "a1", { concept: "nothing", micros: -5_000 })).toBeNull();
    expect(state.balance).toBe(10_000);
  });
});

describe("keys", () => {
  it("carry a recognisable prefix and do not repeat", () => {
    const a = generateKey();
    expect(a.startsWith(KEY_PREFIX)).toBe(true);
    expect(a).not.toBe(generateKey());
  });

  it("the hash is stable and does not contain the key", async () => {
    const key = "oas_example";
    const h = await hashKey(key);
    expect(h).toBe(await hashKey(key));
    expect(h).toHaveLength(64);
    expect(h).not.toContain("example");
  });
});

describe("session access", () => {
  const keySession = { account: "acct-1" };
  const walletSession = { account: null };

  it("the owner gets in", () => {
    expect(sessionAccess(keySession, "acct-1")).toBe("ok");
    expect(sessionAccess(walletSession, null)).toBe("ok");
  });

  it("another account is denied even with a valid key", () => {
    expect(sessionAccess(keySession, "acct-2")).toBe("denied");
  });

  it("a key holder cannot walk into a wallet session, nor the other way round", () => {
    expect(sessionAccess(walletSession, "acct-1")).toBe("denied");
    expect(sessionAccess(keySession, null)).toBe("denied");
  });

  it("an unknown or already closed session is not found", () => {
    expect(sessionAccess(null, "acct-1")).toBe("not_found");
    expect(sessionAccess(null, null)).toBe("not_found");
  });
});
