-- Integrity rules the database enforces on its own, whatever code writes to it.

-- A journal transaction must have at least two entries summing to zero. The
-- check is deferred to COMMIT so entries can be inserted one by one. That the
-- entries share one currency is structural: see the composite foreign keys on
-- journal_entries in 001_schema.sql.
CREATE FUNCTION ledger_assert_balanced(p_transaction_id text) RETURNS void
LANGUAGE plpgsql SET search_path FROM CURRENT AS $$
DECLARE
  entry_count integer;
  total numeric;
BEGIN
  SELECT count(*), coalesce(sum(amount), 0) INTO entry_count, total
  FROM journal_entries WHERE transaction_id = p_transaction_id;
  IF entry_count < 2 THEN
    RAISE EXCEPTION 'journal transaction % has % entries, at least two are required', p_transaction_id, entry_count
      USING ERRCODE = 'check_violation', CONSTRAINT = 'journal_transaction_balanced';
  END IF;
  IF total <> 0 THEN
    RAISE EXCEPTION 'journal transaction % does not balance: entries sum to %', p_transaction_id, total
      USING ERRCODE = 'check_violation', CONSTRAINT = 'journal_transaction_balanced';
  END IF;
END
$$;

CREATE FUNCTION journal_entries_check_balanced() RETURNS trigger
LANGUAGE plpgsql SET search_path FROM CURRENT AS $$
BEGIN
  PERFORM ledger_assert_balanced(NEW.transaction_id);
  RETURN NULL;
END
$$;

CREATE FUNCTION journal_transactions_check_balanced() RETURNS trigger
LANGUAGE plpgsql SET search_path FROM CURRENT AS $$
BEGIN
  PERFORM ledger_assert_balanced(NEW.id);
  RETURN NULL;
END
$$;

CREATE CONSTRAINT TRIGGER journal_entries_balanced
  AFTER INSERT ON journal_entries
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION journal_entries_check_balanced();

CREATE CONSTRAINT TRIGGER journal_transactions_balanced
  AFTER INSERT ON journal_transactions
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION journal_transactions_check_balanced();

-- The ledger is append-only: corrections are reversing transactions.
CREATE FUNCTION ledger_reject_change() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION '% on % is not allowed: the ledger is append-only, post a reversing transaction instead', TG_OP, TG_TABLE_NAME
    USING ERRCODE = 'restrict_violation';
END
$$;

CREATE TRIGGER journal_entries_append_only BEFORE UPDATE OR DELETE ON journal_entries
  FOR EACH ROW EXECUTE FUNCTION ledger_reject_change();
CREATE TRIGGER journal_entries_no_truncate BEFORE TRUNCATE ON journal_entries
  FOR EACH STATEMENT EXECUTE FUNCTION ledger_reject_change();
CREATE TRIGGER journal_transactions_append_only BEFORE UPDATE OR DELETE ON journal_transactions
  FOR EACH ROW EXECUTE FUNCTION ledger_reject_change();
CREATE TRIGGER journal_transactions_no_truncate BEFORE TRUNCATE ON journal_transactions
  FOR EACH STATEMENT EXECUTE FUNCTION ledger_reject_change();

-- Invoice lines are written once and must add up to the invoice total.
CREATE FUNCTION invoice_assert_lines_match(p_invoice_id text) RETURNS void
LANGUAGE plpgsql SET search_path FROM CURRENT AS $$
DECLARE
  invoice_total bigint;
  lines_total numeric;
BEGIN
  SELECT total INTO invoice_total FROM invoices WHERE id = p_invoice_id;
  SELECT coalesce(sum(amount), 0) INTO lines_total FROM invoice_lines WHERE invoice_id = p_invoice_id;
  IF invoice_total IS DISTINCT FROM lines_total THEN
    RAISE EXCEPTION 'invoice % lines sum to %, total is %', p_invoice_id, lines_total, invoice_total
      USING ERRCODE = 'check_violation', CONSTRAINT = 'invoice_lines_match_total';
  END IF;
END
$$;

CREATE FUNCTION invoices_check_lines() RETURNS trigger
LANGUAGE plpgsql SET search_path FROM CURRENT AS $$
BEGIN
  PERFORM invoice_assert_lines_match(NEW.id);
  RETURN NULL;
END
$$;

CREATE FUNCTION invoice_lines_check_total() RETURNS trigger
LANGUAGE plpgsql SET search_path FROM CURRENT AS $$
BEGIN
  PERFORM invoice_assert_lines_match(NEW.invoice_id);
  RETURN NULL;
END
$$;

CREATE CONSTRAINT TRIGGER invoices_lines_match_total
  AFTER INSERT OR UPDATE OF total ON invoices
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION invoices_check_lines();

CREATE CONSTRAINT TRIGGER invoice_lines_match_total
  AFTER INSERT ON invoice_lines
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION invoice_lines_check_total();

CREATE FUNCTION invoice_lines_reject_change() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'invoice lines are immutable once written' USING ERRCODE = 'restrict_violation';
END
$$;

CREATE TRIGGER invoice_lines_immutable BEFORE UPDATE OR DELETE ON invoice_lines
  FOR EACH ROW EXECUTE FUNCTION invoice_lines_reject_change();

-- Payment status only moves forward: pending -> failed -> succeeded.
CREATE FUNCTION payments_status_forward_only() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF (OLD.status = 'succeeded' AND NEW.status <> 'succeeded') OR (OLD.status = 'failed' AND NEW.status = 'pending') THEN
    RAISE EXCEPTION 'payment % cannot go from % back to %', OLD.id, OLD.status, NEW.status
      USING ERRCODE = 'check_violation', CONSTRAINT = 'payments_status_forward_only';
  END IF;
  RETURN NEW;
END
$$;

CREATE TRIGGER payments_status_forward_only BEFORE UPDATE OF status ON payments
  FOR EACH ROW EXECUTE FUNCTION payments_status_forward_only();
