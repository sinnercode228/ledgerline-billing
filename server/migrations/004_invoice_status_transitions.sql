-- An invoice status only moves along the state machine in
-- packages/core/src/invoice.ts (TRANSITIONS); MemoryStore applies the same
-- table, and a shared scenario walks every pair of statuses on both stores.
-- The engine checks each change against the copy it holds; this checks
-- against the stored row, so a stale copy cannot reopen a written-off invoice.
CREATE FUNCTION invoices_status_transition() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF (OLD.status, NEW.status) NOT IN (
    ('draft', 'open'),
    ('open', 'paid'),
    ('open', 'void'),
    ('open', 'uncollectible'),
    ('uncollectible', 'paid')
  ) THEN
    RAISE EXCEPTION 'invoice % cannot move % -> %', OLD.id, OLD.status, NEW.status
      USING ERRCODE = 'check_violation', CONSTRAINT = 'invoices_status_transition';
  END IF;
  RETURN NEW;
END
$$;

CREATE TRIGGER invoices_status_transition BEFORE UPDATE OF status ON invoices
  FOR EACH ROW WHEN (OLD.status IS DISTINCT FROM NEW.status) EXECUTE FUNCTION invoices_status_transition();
