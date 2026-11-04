-- B12/REstimado: a product without a public price added as already held grows from the month it
-- was bought, not from the day it was put into Soleva. Null for one bought through Soleva.
alter table estimate_config add column since_on date;
