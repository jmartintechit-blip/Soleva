import type { Auth } from '#lib/server/auth.ts';
import type { Db } from '#lib/server/db/index.ts';
import type { Email } from '#lib/server/email.ts';

declare global {
  namespace App {
    interface Locals {
      auth: () => Auth;
      db: () => Db;
      mail: (email: Email) => Promise<void>;
      // Work that outlives the response (data streamed to the page): the pool waits for it.
      defer: <T>(work: Promise<T>) => Promise<T>;
      // Asked once per request (session.ts).
      session?: ReturnType<Auth['api']['getSession']>;
      userId?: Promise<string>;
    }
  }
}

export {};
