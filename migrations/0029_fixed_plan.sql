-- «Fijar como mi plan» v2 (b13): a photo of the projection on the day it was fixed — its scenario,
-- horizon and unit, the path month by month in euros of then ({"day", "totalCents",
-- "contributedCents"} per step, step 0 being that day) and the figure at its end in its unit. One
-- per user; fixing again replaces it. Built on the server from stored data, never from the browser.
-- The v0 photo (settings.plan_baseline) stays until the v0 projection is retired.
create table fixed_plan (
  user_id text primary key references "user" (id) on delete cascade,
  fixed_on date not null,
  scenario text not null check (scenario in ('prudente', 'base', 'optimista')),
  months integer not null check (months in (60, 120, 240, 360)),
  unit text not null check (unit in ('hoy', 'entonces')),
  path jsonb not null check (jsonb_typeof(path) = 'array' and jsonb_array_length(path) = months + 1),
  final_cents bigint not null,
  updated_at timestamptz not null default now()
);
