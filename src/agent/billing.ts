/**
 * Money for agent tasks. Each function is one D1 batch, and a D1 batch is one transaction:
 * either every statement lands or none does. Each statement is guarded by the state the
 * previous one leaves, so a retry after a crash finds nothing left to do and changes nothing.
 */

export interface ReserveInput {
  taskId: string;
  account: string;
  micros: number;
  now: number;
  task: {
    mode: string;
    request: string;
    requestHash: string;
    idempotencyKey: string | null;
    document: string;
  };
}

/**
 * Holds `micros` from the account's available balance and creates the task in the same
 * transaction. Returns false when the balance cannot cover it, or when the idempotency key
 * is already used: in both cases nothing was written.
 */
export async function reserveTask(db: D1Database, input: ReserveInput): Promise<"reserved" | "insufficient" | "duplicate"> {
  const { taskId, account, micros, now, task } = input;
  try {
    const res = await db.batch([
      db
        .prepare(
          `INSERT INTO agent_holds (task_id, account, micros, state)
           SELECT ?1, a.id, ?3, 'held' FROM accounts a
            WHERE a.id = ?2 AND a.active = 1 AND a.balance_micros - a.reserved_micros >= ?3`,
        )
        .bind(taskId, account, micros),
      db
        .prepare(
          `UPDATE accounts SET reserved_micros = reserved_micros + ?2
            WHERE id = ?1 AND EXISTS (SELECT 1 FROM agent_holds WHERE task_id = ?3 AND state = 'held')`,
        )
        .bind(account, micros, taskId),
      db
        .prepare(
          `INSERT INTO agent_tasks
             (id, account, status, mode, request, request_hash, idempotency_key, created_at, updated_at,
              reserved_micros, document)
           SELECT ?1, ?2, 'queued', ?3, ?4, ?5, ?6, ?7, ?7, ?8, ?9
            WHERE EXISTS (SELECT 1 FROM agent_holds WHERE task_id = ?1 AND state = 'held')`,
        )
        .bind(taskId, account, task.mode, task.request, task.requestHash, task.idempotencyKey, now, micros, task.document),
    ]);
    const inserted = res[2]?.meta?.changes ?? 0;
    if (inserted === 1) return "reserved";
    return "insufficient";
  } catch (e) {
    if (e instanceof Error && /UNIQUE/i.test(e.message)) return "duplicate";
    throw e;
  }
}

export interface SettleInput {
  taskId: string;
  account: string;
  spentMicros: number;
  now: number;
  finalStatus: string;
  finishedAt: number;
  document: string;
  errorCode: string | null;
  errorMessage: string | null;
}

/**
 * Charges what was spent, releases the rest of the hold, and marks the task settled. Runs
 * once: the hold moves from held to settled inside the transaction, and every statement is
 * guarded by 'held', so a second call changes nothing.
 */
export async function settleTask(db: D1Database, input: SettleInput): Promise<"settled" | "already_settled"> {
  const { taskId, account, spentMicros, now, finalStatus, finishedAt, document, errorCode, errorMessage } = input;
  const heldBy = (param: string) => `EXISTS (SELECT 1 FROM agent_holds WHERE task_id = ${param} AND state = 'held')`;
  const [hold] = await db
    .prepare(`SELECT micros FROM agent_holds WHERE task_id = ?1 AND state = 'held'`)
    .bind(taskId)
    .all<{ micros: number }>()
    .then((r) => r.results ?? []);
  if (!hold) return "already_settled";
  if (spentMicros < 0 || spentMicros > hold.micros) throw new Error("spent exceeds the hold");

  await db.batch([
    db
      .prepare(
        `UPDATE accounts
            SET balance_micros = balance_micros - ?2,
                reserved_micros = reserved_micros - (SELECT micros FROM agent_holds WHERE task_id = ?3)
          WHERE id = ?1 AND ${heldBy("?3")}`,
      )
      .bind(account, spentMicros, taskId),
    db
      .prepare(
        `INSERT INTO transactions (account, at, micros, concept, route, reference)
         SELECT ?1, ?2, -?3, 'agent_task', '/agent/v1/tasks', ?4 WHERE ?3 > 0 AND ${heldBy("?4")}`,
      )
      .bind(account, now, spentMicros, taskId),
    db
      .prepare(`UPDATE agent_holds SET state = 'settled' WHERE task_id = ?1 AND state = 'held'`)
      .bind(taskId),
    db
      .prepare(
        `UPDATE agent_tasks
            SET status = ?2, updated_at = ?3, finished_at = ?4, spent_micros = ?5,
                released_micros = reserved_micros - ?5, settlement = 'settled',
                document = ?6, error_code = ?7, error_message = ?8
          WHERE id = ?1 AND settlement = 'pending'`,
      )
      .bind(taskId, finalStatus, now, finishedAt, spentMicros, document, errorCode, errorMessage),
  ]);
  return "settled";
}
