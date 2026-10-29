import { createHash } from 'node:crypto';
import { transactionContentKey, type ValantTxnRow } from './valantTransactions';
import { journalContentKey, type ValantJournalRow } from './valantTransactionJournal';

/** sha256 of the transaction content plus its occurrence among identical rows in the file (server only) */
export function transactionRowHash(row: ValantTxnRow, occurrence: number): string {
  return createHash('sha256').update(`valant-transaction|${transactionContentKey(row)}|#${occurrence}`).digest('hex');
}

/** Same for a Transaction Journal row (distinct prefix, so it never collides with a Transactions row) */
export function journalRowHash(row: ValantJournalRow, occurrence: number): string {
  return createHash('sha256').update(`valant-journal|${journalContentKey(row)}|#${occurrence}`).digest('hex');
}
