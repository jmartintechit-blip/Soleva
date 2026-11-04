-- Baja (B12): the day a home, car, good or debt stopped being the user's (sold, given away, paid
-- off). From that day on the engine leaves it out of net worth; the days before keep what it was
-- worth. It is archived the same moment, so the lists drop it.
alter table money_account add column closed_on date;
