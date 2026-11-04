-- What a rule is about (b12): the home, car or good its IBI, insurance or rent belongs to. When
-- that is given up, the rule stops with it. Deleting it leaves the rule about nothing in particular.
alter table auto_rule
  add column asset_account_id text references money_account (id) on delete set null;

create or replace function auto_rule_access() returns trigger language plpgsql as $$
begin
  if exists (
    select 1 from unnest(array[new.from_account_id, new.to_account_id, new.shortfall_account_id,
                               new.asset_account_id]) as a(id)
    where a.id is not null and not exists (
      select 1 from account_access x
      where x.account_id = a.id and x.user_id = new.user_id and x.role in ('propietario', 'editor')
    )
  ) then
    raise exception 'rule % uses an account its user cannot change', new.id using errcode = 'P0001';
  end if;
  return new;
end $$;

-- What a baja did, so «Deshacer la baja» can put it back: when (its voids carry that instant), how
-- far the engine was, what else it closed (a mortgage paid off with the home), the rules it
-- stopped, a link it removed, what it was sold for and what it was worth that day. On an account
-- closed along with another: {"main": <that one>}.
alter table money_account add column closing jsonb;
