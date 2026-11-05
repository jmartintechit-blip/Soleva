import { redirect } from '@sveltejs/kit';
import type { z } from 'zod';
import { enterApp } from './ledger-migration.ts';
import { today } from './plan.ts';

type Event = { locals: App.Locals; request: Request };

// The request's session, asked once (the layout and the page both want it).
export const sessionOf = ({ locals, request }: Event) =>
  (locals.session ??= locals.auth().api.getSession({ headers: request.headers }));

// Every page and action of the app asks for the user here: no session, back to /entrar. Once per
// request, and before anything reads the user's data, the way in: a v0 user goes to the ledger,
// and one on it is brought up to today (enterApp). If that fails nothing changed (one
// transaction): the user stays as they were, the error goes to the log and the page still loads.
export function requireUserId(event: Event) {
  return (event.locals.userId ??= (async () => {
    const session = await sessionOf(event);
    if (!session) redirect(303, '/entrar');
    const userId = session.user.id;
    await enterApp(event.locals.db(), userId, today()).catch((e: unknown) =>
      console.error(`enterApp: ${e instanceof Error ? e.message : String(e)}`),
    );
    return userId;
  })());
}

// First message per field, for the form to show under each input.
export const fieldErrors = (error: z.ZodError) =>
  Object.fromEntries(
    [...error.issues].reverse().map((i) => [String(i.path[0] ?? 'form'), i.message]),
  ) as Record<string, string>;
