-- RBien: a good loses a yearly percentage of what it is worth (editable, a default per kind), and
-- a watch is a kind of its own. Each value put in follows that loss from its day.
alter table asset
  add column annual_loss_bp integer not null default 1000 check (annual_loss_bp between 0 and 10000),
  drop constraint asset_category_check,
  add constraint asset_category_check
    check (category in ('electronica', 'moto', 'mobiliario', 'joyas', 'reloj', 'otro'));
