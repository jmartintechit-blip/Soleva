// The deployed worker: SvelteKit's for requests, plus the daily cron (close reminders, market
// data, one engine job per user) and the queue that runs those jobs.
// Built by the adapter (kit.wrangler.jsonc): missing until the first build, so no types before it.
// eslint-disable-next-line @typescript-eslint/ban-ts-comment
// @ts-ignore
import kit from '../.svelte-kit/cloudflare/_worker.js';
import { madridToday } from '#lib/engine/day.ts';
import { type Job, daily, marketDeps, work } from '#lib/server/daily.ts';
import { createNeonDb } from '#lib/server/db/index.ts';
import { sendEmail } from '#lib/server/email.ts';
import { today } from '#lib/server/today.ts';
import { sendReminders } from '#lib/server/reminders.ts';

export default {
  fetch: kit.fetch,
  async scheduled(_controller: ScheduledController, env: Env, ctx: ExecutionContext) {
    const db = createNeonDb(env.DATABASE_URL);
    try {
      const sent = await sendReminders(db, today(), 'https://solevaapp.com', (email) =>
        sendEmail(env.RESEND_API_KEY, email),
      );
      console.log(`reminders sent: ${sent}`);
      const send = (jobs: Job[]) => env.ENGINE.sendBatch(jobs.map((body) => ({ body })));
      console.log('daily', JSON.stringify(await daily(db, marketDeps(env), madridToday(), send)));
    } finally {
      ctx.waitUntil(db.close());
    }
  },
  // One job per message (max_batch_size 1). A throw retries it (max_retries 3).
  async queue(batch: MessageBatch<Job>, env: Env, ctx: ExecutionContext) {
    const db = createNeonDb(env.DATABASE_URL);
    try {
      for (const message of batch.messages) {
        const send = (jobs: Job[]) => env.ENGINE.sendBatch(jobs.map((body) => ({ body })));
        const done = await work(db, marketDeps(env), message.body, madridToday(), send);
        console.log('job', JSON.stringify(message.body), JSON.stringify(done));
        message.ack();
      }
    } finally {
      ctx.waitUntil(db.close());
    }
  },
};
