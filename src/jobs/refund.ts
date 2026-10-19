/** Apply only the increase in the cumulative refund, atomically with its ledger entry.
 * The initial baseline also supports jobs partially refunded before this migration.
 */
export async function refundJob(db: D1Database, account: string, reference: string, alreadyRefunded: number, micros: number, concept: string): Promise<void> {
  const at = Date.now();
  await db.batch([
    db.prepare("INSERT OR IGNORE INTO job_refunds(id,account,micros,concept,reference,at) VALUES(?,?,?,?,?,?)")
      .bind(reference, account, alreadyRefunded, concept, reference, at),
    db.prepare("UPDATE job_refunds SET micros=MAX(micros,?),concept=?,at=? WHERE id=? AND account=?")
      .bind(alreadyRefunded + micros, concept, at, reference, account),
  ]);
}
