import type { Month } from '#lib/engine/dates.ts';
import { monthToClose } from './closes.ts';
import type { Db } from './db/index.ts';
import type { Email } from './email.ts';

export const reminderEmail = (to: string, month: Month, url: string): Email => {
  const name = new Date(`${month}-15`).toLocaleDateString('es-ES', { month: 'long' });
  return {
    to,
    subject: `Cierra ${name} en Soleva`,
    text: `Tus reglas ya tienen propuestos los saldos de ${name}. Revísalos y confírmalos en menos de un minuto:\n${url}/cierre\n\nPuedes cambiar el día de este aviso o desactivarlo en Ajustes.`,
  };
};

// On the ledger (B12 tarea 11) there is no month to close: once a month, a nudge to square the
// accounts against the bank's figures.
export const cuadreEmail = (to: string, url: string): Email => ({
  to,
  subject: 'Cuadra tus cuentas en Soleva',
  text: `Soleva lleva tus saldos sola con tus reglas y planes. Una vez al mes, compáralos con lo que dice tu banco y cuadra lo que no coincida en menos de un minuto:
${url}/cuentas

Puedes cambiar el día de este aviso o desactivarlo en Ajustes.`,
});

// Today's reminders (YYYY-MM-DD, Spain): users whose day it is, with a live account and a month
// still open (on the ledger, this month), not yet reminded about it. Returns how many went out.
// shortcut: one email at a time inside one cron run; batch with Resend's batch API past ~100 users.
export async function sendReminders(
  db: Db,
  today: string,
  url: string,
  mail: (email: Email) => Promise<void>,
): Promise<number> {
  const due = await db.query<{
    id: string;
    email: string;
    last: Month | null;
    reminded: Month | null;
    ledger: boolean;
  }>(
    `select u.id, u.email,
       exists (select 1 from engine_state e where e.user_id = u.id) as ledger,
       (select to_char(max(c.month), 'YYYY-MM') from month_close c
         where c.user_id = u.id and c.status = 'confirmado') as last,
       to_char(s.reminded_month, 'YYYY-MM') as reminded
     from "user" u left join settings s on s.user_id = u.id
     where coalesce(s.reminder_enabled, true) and coalesce(s.reminder_day, 1) = $1
       and exists (select 1 from money_account a where a.user_id = u.id and a.archived_at is null)`,
    [Number(today.slice(8, 10))],
  );
  let sent = 0;
  for (const u of due) {
    // On the ledger, once in the current month; in v0, the month still to close.
    const month = u.ledger ? today.slice(0, 7) : monthToClose(today, u.last ?? undefined);
    // Days 1–10 with last month closed: the current one has barely begun, nothing is pending.
    const early = !u.ledger && month === today.slice(0, 7) && Number(today.slice(8, 10)) <= 10;
    if (!month || early || u.reminded === month) continue;
    // Marked first: a failed send is not retried, never doubled.
    await db.query(
      `insert into settings (user_id, reminded_month) values ($1, $2)
       on conflict (user_id) do update set reminded_month = $2, updated_at = now()`,
      [u.id, `${month}-01`],
    );
    await mail(u.ledger ? cuadreEmail(u.email, url) : reminderEmail(u.email, month, url));
    sent++;
  }
  return sent;
}
