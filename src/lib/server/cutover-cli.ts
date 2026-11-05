import { createNeonDb } from './db/index.ts';
import { rehearseCutOver } from './ledger-migration.ts';
import { today } from './plan.ts';

// The cut-over to the ledger as a rehearsal on the database in DATABASE_URL: each v0 user in a
// transaction that is rolled back. Prints, per user and without names or ids, how many accounts,
// the net worth before and what would differ. Exits 1 if anything would.
const url = process.env.DATABASE_URL;
if (!url) {
  console.error('DATABASE_URL is not set');
  process.exit(1);
}
const db = createNeonDb(url);
try {
  const report = await rehearseCutOver(db, today());
  report.forEach((r, i) =>
    console.log(
      `Usuario ${i + 1}: ${r.accounts} cuentas, patrimonio ${(r.total / 100).toFixed(2)} €, ` +
        (r.diffs.length
          ? `NO CUADRA: ${JSON.stringify(r.diffs)}`
          : 'cuadra cuenta a cuenta y en total'),
    ),
  );
  console.log(
    `${report.length} usuarios en v0; ${report.filter((r) => r.diffs.length).length} no cuadran`,
  );
  if (report.some((r) => r.diffs.length)) process.exitCode = 1;
} finally {
  await db.close();
}
