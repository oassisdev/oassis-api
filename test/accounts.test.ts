import {createRequire} from 'node:module';
import {readFileSync,readdirSync} from 'node:fs';
const {DatabaseSync}=createRequire(import.meta.url)('node:sqlite');
import { describe, expect, it } from "vitest";
import { charge, recordWalletPayment, generateKey, hashKey, KEY_PREFIX, sessionAccess } from "../src/billing/accounts";

/**
 * Fake D1: only enough to exercise the charging logic, which is what decides
 * whether an account can go negative. The conditional UPDATE is imitated with its
 * own rule: it changes rows only when the balance covers the charge.
 */
function fakeD1(startingBalance: number, active = true) {
 const sql=new DatabaseSync(':memory:');
 for(const file of readdirSync('migrations').filter(f=>f.endsWith('.sql')).sort())sql.exec(readFileSync('migrations/'+file,'utf8'));
 sql.prepare('INSERT INTO accounts(id,created_at,balance_micros,active) VALUES(?,?,?,?)').run('a1',Date.now(),startingBalance,active?1:0);
 const wrap=(query:string,args:unknown[]=[])=>({bind:(...a:unknown[])=>wrap(query,a),run:async()=>({meta:sql.prepare(query).run(...args)}),first:async()=>sql.prepare(query).get(...args)||null});
 const db={prepare:wrap} as unknown as D1Database;
 const state={get balance(){return sql.prepare('SELECT balance_micros n FROM accounts').get().n;},get entries(){return sql.prepare('SELECT micros,route AS concept FROM transactions').all().map((x:any)=>({...x}));}};
 return {db,state};
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

describe('wallet settlement receipts',()=>{
 it('stores the settlement transaction without changing prepaid balances',async()=>{
  const {db,state}=fakeD1(50000);const tx='0x'+'ab'.repeat(32);
  const headers=new Headers({'payment-response':btoa(JSON.stringify({success:true,transaction:tx,network:'eip155:8453'}))});
  await recordWalletPayment(db,'wallet:0x123',2000,'/web/v1/scrape',headers);
  expect(await db.prepare('SELECT reference,micros FROM transactions').first()).toEqual({reference:tx,micros:-2000});expect(state.balance).toBe(50000);
  await recordWalletPayment(db,'wallet:0x123',2000,'/web/v1/scrape',headers);expect(state.entries).toHaveLength(1);
 });
 it.each([null,{success:false,transaction:'0x'+'ab'.repeat(32)},{success:true,transaction:'invalid'}])('does not create a confirmed charge for an absent or failed receipt: %j',async(receipt)=>{
  const {db,state}=fakeD1(50000);const headers=new Headers();if(receipt)headers.set('x-payment-response',btoa(JSON.stringify(receipt)));
  await expect(recordWalletPayment(db,'wallet:0x123',2000,'/web/v1/scrape',headers)).rejects.toThrow(/receipt/);expect(state.entries).toEqual([]);
 });
});
