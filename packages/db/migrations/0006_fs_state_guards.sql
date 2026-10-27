-- Fair Split: I5 (state only moves forward) in the database (review major, repos/scoped.ts).
--
-- The generic scoped `update` could write a run's or line's state directly: after DRAFT → QUOTED, setting state back
-- to DRAFT, or jumping to CLOSED, succeeded, and nothing in SQL guarded pay_runs or member_lines. The repositories now
-- refuse those columns, and this migration is the backstop for every role and every code path:
--   * fs_private.state_edges holds the run, line and hold machines edge for edge (the same tables as the transition
--     policy in src/_shims/domain.ts and WS-CORE's fsm; test/state-guards.test.ts fails if they ever differ);
--   * a state change must be one of those edges and must count version up by exactly one, and version never moves
--     otherwise (FS409 ILLEGAL_TRANSITION / VERSION_MISMATCH). Inserts are free: a seeded clone places rows anywhere;
--   * a payout item's cancel stamp is written once, on an UNCLAIMED item, and RETURNED needs it from an earlier
--     statement, so the RETURNED guard cannot be satisfied by a stamp forged in the same UPDATE;
--   * a signed approval never changes; it can be voided once (I4, I6).

CREATE TABLE fs_private.state_edges (
  machine text NOT NULL,
  from_state text NOT NULL,
  to_state text NOT NULL,
  CONSTRAINT state_edges_pk PRIMARY KEY (machine, from_state, to_state),
  CONSTRAINT state_edges_machine_ck CHECK (machine IN ('run', 'line', 'hold')),
  CONSTRAINT state_edges_no_loop_ck CHECK (from_state <> to_state)
);
--> statement-breakpoint
REVOKE ALL ON fs_private.state_edges FROM PUBLIC;
--> statement-breakpoint
INSERT INTO fs_private.state_edges (machine, from_state, to_state) VALUES
  -- pay run (register §7, S3.5): the forward path …
  ('run', 'DRAFT', 'QUOTED'),
  ('run', 'QUOTED', 'INVOICED'),
  ('run', 'INVOICED', 'FUNDED'),
  ('run', 'FUNDED', 'EXTRACTING'),
  ('run', 'EXTRACTING', 'COMPUTED'),
  ('run', 'COMPUTED', 'IN_REVIEW'),
  ('run', 'IN_REVIEW', 'TREASURER_APPROVED'),
  ('run', 'TREASURER_APPROVED', 'APPROVED'),
  ('run', 'TREASURER_APPROVED', 'AWAITING_BOARD'),
  ('run', 'AWAITING_BOARD', 'APPROVED'),
  ('run', 'APPROVED', 'POSTING'),
  ('run', 'POSTING', 'POSTED'),
  ('run', 'POSTED', 'SETTLING'),
  ('run', 'SETTLING', 'NEEDS_FOLLOW_UP'),
  ('run', 'SETTLING', 'SETTLED'),
  ('run', 'NEEDS_FOLLOW_UP', 'SETTLED'),
  ('run', 'SETTLED', 'CLOSED'),
  -- … the send-back that voids approvals (a line edit, a decline, a digest mismatch) …
  ('run', 'TREASURER_APPROVED', 'IN_REVIEW'),
  ('run', 'AWAITING_BOARD', 'IN_REVIEW'),
  ('run', 'APPROVED', 'IN_REVIEW'),
  -- … and the exits
  ('run', 'INVOICED', 'CANCELLED'),
  ('run', 'POSTING', 'DENIED'),
  ('run', 'POSTED', 'DENIED'),
  ('run', 'SETTLING', 'DENIED'),
  ('run', 'DRAFT', 'HALTED'),
  ('run', 'QUOTED', 'HALTED'),
  ('run', 'INVOICED', 'HALTED'),
  ('run', 'FUNDED', 'HALTED'),
  ('run', 'EXTRACTING', 'HALTED'),
  ('run', 'COMPUTED', 'HALTED'),
  ('run', 'IN_REVIEW', 'HALTED'),
  ('run', 'TREASURER_APPROVED', 'HALTED'),
  ('run', 'AWAITING_BOARD', 'HALTED'),
  ('run', 'APPROVED', 'HALTED'),
  -- member line (register §7, S3.5); LOCKED → READY unlocks after voided approvals, REROUTED → SUBMITTED retries
  ('line', 'COMPUTED', 'READY'),
  ('line', 'COMPUTED', 'HELD'),
  ('line', 'HELD', 'READY'),
  ('line', 'HELD', 'EXCLUDED'),
  ('line', 'READY', 'OFF_RAIL_DUE'),
  ('line', 'READY', 'LOCKED'),
  ('line', 'LOCKED', 'SUBMITTED'),
  ('line', 'LOCKED', 'READY'),
  ('line', 'SUBMITTED', 'PAYPAL_PENDING'),
  ('line', 'SUBMITTED', 'NEEDS_ACTION'),
  ('line', 'PAYPAL_PENDING', 'PAYPAL_HELD'),
  ('line', 'PAYPAL_PENDING', 'UNCLAIMED'),
  ('line', 'PAYPAL_PENDING', 'NEEDS_ACTION'),
  ('line', 'PAYPAL_PENDING', 'PAID'),
  ('line', 'PAYPAL_PENDING', 'REVERSED'),
  ('line', 'PAYPAL_HELD', 'UNCLAIMED'),
  ('line', 'PAYPAL_HELD', 'NEEDS_ACTION'),
  ('line', 'PAYPAL_HELD', 'PAID'),
  ('line', 'PAYPAL_HELD', 'REVERSED'),
  ('line', 'UNCLAIMED', 'RETURNED'),
  ('line', 'UNCLAIMED', 'NEEDS_ACTION'),
  ('line', 'UNCLAIMED', 'PAID'),
  ('line', 'UNCLAIMED', 'REVERSED'),
  ('line', 'RETURNED', 'OFF_RAIL_DUE'),
  ('line', 'RETURNED', 'REROUTED'),
  ('line', 'REROUTED', 'SUBMITTED'),
  ('line', 'NEEDS_ACTION', 'PAID'),
  ('line', 'NEEDS_ACTION', 'REVERSED'),
  ('line', 'PAID', 'REVERSED'),
  ('line', 'OFF_RAIL_DUE', 'OFF_RAIL_PAID'),
  -- hold (register §7): OPEN → (ASKED_CHAIR) → RESOLVED | EXCLUDED
  ('hold', 'OPEN', 'ASKED_CHAIR'),
  ('hold', 'OPEN', 'RESOLVED'),
  ('hold', 'OPEN', 'EXCLUDED'),
  ('hold', 'ASKED_CHAIR', 'RESOLVED'),
  ('hold', 'ASKED_CHAIR', 'EXCLUDED');
--> statement-breakpoint

-- ─── I5 · a state moves only along an edge, and version counts every move ────────────────────────────────
CREATE OR REPLACE FUNCTION fs_state_guard() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  v_machine text := TG_ARGV[0];
BEGIN
  IF NEW.state IS DISTINCT FROM OLD.state THEN
    IF NOT EXISTS (SELECT 1 FROM fs_private.state_edges e
                    WHERE e.machine = v_machine AND e.from_state = OLD.state AND e.to_state = NEW.state) THEN
      RAISE EXCEPTION 'ILLEGAL_TRANSITION:%:%->%', TG_TABLE_NAME, OLD.state, NEW.state
        USING ERRCODE = 'FS409',
              DETAIL = format('%s → %s is not an edge of the %s machine: state only moves forward (I5).',
                              OLD.state, NEW.state, v_machine);
    END IF;
    IF NEW.version IS DISTINCT FROM OLD.version + 1 THEN
      RAISE EXCEPTION 'VERSION_MISMATCH:%', TG_TABLE_NAME
        USING ERRCODE = 'FS409',
              DETAIL = format('%s → %s must set version %s (it set %s): every state change counts one version.',
                              OLD.state, NEW.state, OLD.version + 1, NEW.version);
    END IF;
  ELSIF NEW.version IS DISTINCT FROM OLD.version AND NEW.version IS DISTINCT FROM OLD.version + 1 THEN
    RAISE EXCEPTION 'VERSION_MISMATCH:%', TG_TABLE_NAME
      USING ERRCODE = 'FS409',
            DETAIL = format('version moves only up by one (from %s, not to %s).', OLD.version, NEW.version);
  END IF;
  RETURN NEW;
END
$$;
--> statement-breakpoint
CREATE TRIGGER pay_runs_state_guard BEFORE UPDATE OF state, version ON pay_runs
  FOR EACH ROW EXECUTE FUNCTION fs_state_guard('run');
--> statement-breakpoint
CREATE TRIGGER member_lines_state_guard BEFORE UPDATE OF state, version ON member_lines
  FOR EACH ROW EXECUTE FUNCTION fs_state_guard('line');
--> statement-breakpoint
CREATE TRIGGER holds_state_guard BEFORE UPDATE OF state, version ON holds
  FOR EACH ROW EXECUTE FUNCTION fs_state_guard('hold');
--> statement-breakpoint

-- ─── payout items: ranks only climb; our own cancel is stamped once, on an UNCLAIMED item ─────────────────
CREATE OR REPLACE FUNCTION fs_payout_item_rank_guard() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.cancel_requested_at IS DISTINCT FROM OLD.cancel_requested_at
     AND (OLD.cancel_requested_at IS NOT NULL OR NEW.cancel_requested_at IS NULL OR OLD.status <> 'UNCLAIMED') THEN
    RAISE EXCEPTION 'FROZEN_COLUMN:payout_items.cancel_requested_at'
      USING ERRCODE = 'FS409',
            DETAIL = format('Item %s: our own cancel is stamped once, on an UNCLAIMED item (it is %s), and never changes.',
                            OLD.sender_item_id, OLD.status);
  END IF;
  IF NEW.status IS DISTINCT FROM OLD.status THEN
    IF NEW.status_rank <= OLD.status_rank THEN
      RAISE EXCEPTION 'ITEM_STATUS_REGRESSION:%', NEW.sender_item_id
        USING ERRCODE = 'FS409',
              DETAIL = format('%s (rank %s) cannot follow %s (rank %s).',
                              NEW.status, NEW.status_rank, OLD.status, OLD.status_rank);
    END IF;
    -- OLD, not NEW: the cancel must precede RETURNED, never arrive with it
    IF NEW.status = 'RETURNED' AND (OLD.cancel_requested_at IS NULL OR OLD.status <> 'UNCLAIMED') THEN
      RAISE EXCEPTION 'RETURN_WITHOUT_CANCEL:%', NEW.sender_item_id
        USING ERRCODE = 'FS409', DETAIL = 'RETURNED is accepted only after our own cancel of an UNCLAIMED item.';
    END IF;
  END IF;
  RETURN NEW;
END
$$;
--> statement-breakpoint
DROP TRIGGER payout_items_rank_guard ON payout_items;
--> statement-breakpoint
CREATE TRIGGER payout_items_rank_guard BEFORE UPDATE OF status, status_rank, cancel_requested_at ON payout_items
  FOR EACH ROW EXECUTE FUNCTION fs_payout_item_rank_guard();
--> statement-breakpoint

-- ─── approvals: a signature never changes; it is voided at most once ─────────────────────────────────────
CREATE OR REPLACE FUNCTION fs_approvals_guard() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF (to_jsonb(NEW) - 'voided_at' - 'void_reason') IS DISTINCT FROM (to_jsonb(OLD) - 'voided_at' - 'void_reason') THEN
    RAISE EXCEPTION 'FROZEN_COLUMN:approvals'
      USING ERRCODE = 'FS409',
            DETAIL = format('Approval %s is a signed record: only voiding it is allowed.', OLD.id);
  END IF;
  IF OLD.voided_at IS NOT NULL
     AND (NEW.voided_at IS DISTINCT FROM OLD.voided_at OR NEW.void_reason IS DISTINCT FROM OLD.void_reason) THEN
    RAISE EXCEPTION 'FROZEN_COLUMN:approvals.voided_at'
      USING ERRCODE = 'FS409', DETAIL = format('Approval %s was voided at %s; a void is final.', OLD.id, OLD.voided_at);
  END IF;
  IF OLD.voided_at IS NULL AND NEW.voided_at IS NULL AND NEW.void_reason IS DISTINCT FROM OLD.void_reason THEN
    RAISE EXCEPTION 'FROZEN_COLUMN:approvals.void_reason'
      USING ERRCODE = 'FS409', DETAIL = 'A void reason is written only together with the void.';
  END IF;
  RETURN NEW;
END
$$;
--> statement-breakpoint
CREATE TRIGGER approvals_guard BEFORE UPDATE ON approvals
  FOR EACH ROW EXECUTE FUNCTION fs_approvals_guard();
