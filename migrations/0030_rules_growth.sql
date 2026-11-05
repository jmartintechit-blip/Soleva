-- «Tus ingresos y gastos» (b13): how the rules' incomes and expenses grow a year in the projection.
-- Null follows the inflation, so they stay the same in euros of today.
alter table settings
  add column rules_growth_bp integer check (rules_growth_bp between -2000 and 5000);
