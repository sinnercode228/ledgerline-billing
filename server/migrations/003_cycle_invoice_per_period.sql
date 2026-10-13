-- Only a cycle invoice bills a period, so only cycle invoices are unique per
-- period start. A proration invoice starts at the moment of a plan change, and
-- two changes can share that moment (the test clock does not move between
-- requests), so they must not collide.
ALTER TABLE invoices DROP CONSTRAINT invoices_one_per_period;
CREATE UNIQUE INDEX invoices_one_per_period ON invoices (subscription_id, period_start) WHERE kind = 'cycle';
