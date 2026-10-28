-- Fair Split: a ratified rate card freezes its season's terms (I2; review major, schema/coop.ts).
--
-- Register §2: the ratified card carries the Chair's co-sign thresholds (any batch over US$300, any line over US$150),
-- the ±2.0% mass-balance tolerance, the 1.6 kg-per-tree yield limit and auto-accept at 0.85. The schema keeps those
-- figures on `seasons`, but only rate_cards and rate_rules were bolted: after ratification an UPDATE of the season
-- could raise cosign_batch_cents until a large batch skipped AWAITING_BOARD, or lower auto_accept_bp. `tz` was open
-- too, and fs_slip_rows_guard reads the ratification day in that zone, so moving the zone moved the day by up to a
-- day and let backdated slips in.
--
-- Once the season's card has ratified_at set, a change to tz, currency, opens_on, closes_on, cosign_batch_cents,
-- cosign_line_cents, mass_balance_tol_bp, kg_per_tree_max_g or auto_accept_bp raises
-- FS409 RATE_CARD_RATIFIED:<card sha256> for every role; only fs_purge_workspace() steps past it. The label and the
-- other columns stay editable, and writing a term's current value again is not a change.
--
-- A change and a ratification never interleave, whichever starts first:
--   * the guard reads the season's card FOR SHARE (as fs_rate_rules_guard does), so a ratification in flight makes
--     the change wait and then see it, and a change in flight makes an UPDATE that ratifies the card wait for it;
--   * a card the guard cannot see yet (inserted, or moved to this season, by a transaction still open) is covered
--     from the other side: that write locks its season FOR SHARE until its transaction ends, so the change waits for
--     it and then finds the card, or the card waits for the change.
-- Lock order: the guard takes the season row, then the card; an UPDATE that ratifies a card takes only the card; an
-- INSERT takes the season before its card exists for anyone else. So a ratification and a change of its own season
-- cannot deadlock. (A transaction that writes several seasons, or moves a card, can still meet another in the opposite
-- order; the repositories take the workspace lock first, which rules that out, and Postgres aborts any such cycle.)

-- ─── I2 · the season's terms are part of its ratified card ────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION fs_season_rules_guard() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  changed text[];
  card record;
BEGIN
  changed := array_remove(ARRAY[
    CASE WHEN NEW.tz IS DISTINCT FROM OLD.tz THEN 'tz' END,
    CASE WHEN NEW.currency IS DISTINCT FROM OLD.currency THEN 'currency' END,
    CASE WHEN NEW.opens_on IS DISTINCT FROM OLD.opens_on THEN 'opens_on' END,
    CASE WHEN NEW.closes_on IS DISTINCT FROM OLD.closes_on THEN 'closes_on' END,
    CASE WHEN NEW.cosign_batch_cents IS DISTINCT FROM OLD.cosign_batch_cents THEN 'cosign_batch_cents' END,
    CASE WHEN NEW.cosign_line_cents IS DISTINCT FROM OLD.cosign_line_cents THEN 'cosign_line_cents' END,
    CASE WHEN NEW.mass_balance_tol_bp IS DISTINCT FROM OLD.mass_balance_tol_bp THEN 'mass_balance_tol_bp' END,
    CASE WHEN NEW.kg_per_tree_max_g IS DISTINCT FROM OLD.kg_per_tree_max_g THEN 'kg_per_tree_max_g' END,
    CASE WHEN NEW.auto_accept_bp IS DISTINCT FROM OLD.auto_accept_bp THEN 'auto_accept_bp' END
  ]::text[], NULL);
  IF cardinality(changed) = 0 OR fs_purging(OLD.workspace_id) THEN
    RETURN NEW;
  END IF;
  -- FOR SHARE: a ratification in flight makes this change wait and then see it; this change makes one wait for it
  SELECT code, sha256, ratified_at INTO card
    FROM rate_cards
   WHERE workspace_id = OLD.workspace_id AND season_id = OLD.id
     FOR SHARE;
  IF FOUND AND card.ratified_at IS NOT NULL THEN
    RAISE EXCEPTION 'RATE_CARD_RATIFIED:%', card.sha256
      USING ERRCODE = 'FS409',
            DETAIL = format('Rate card %s was ratified at %s; season %s''s %s belong to it and are closed.',
                            card.code, card.ratified_at, OLD.code, array_to_string(changed, ', ')),
            HINT = 'A change needs a new Board resolution for the next season.';
  END IF;
  RETURN NEW;
END
$$;
--> statement-breakpoint
CREATE TRIGGER seasons_ratified_guard
  BEFORE UPDATE ON seasons
  FOR EACH ROW EXECUTE FUNCTION fs_season_rules_guard();
--> statement-breakpoint

-- ─── a card holds its season until the transaction that put it there ends ─────────────────────────────────
-- Named to fire after rate_cards_ratified_guard and rate_cards_ratified_now (BEFORE triggers run alphabetically),
-- so a refused write is refused before it locks anything.
CREATE OR REPLACE FUNCTION fs_rate_card_season_lock() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
  IF TG_OP = 'INSERT'
     OR NEW.season_id IS DISTINCT FROM OLD.season_id
     OR NEW.workspace_id IS DISTINCT FROM OLD.workspace_id THEN
    PERFORM 1 FROM seasons WHERE workspace_id = NEW.workspace_id AND id = NEW.season_id FOR SHARE;
  END IF;
  RETURN NEW;
END
$$;
--> statement-breakpoint
CREATE TRIGGER rate_cards_season_lock
  BEFORE INSERT OR UPDATE OF workspace_id, season_id ON rate_cards
  FOR EACH ROW EXECUTE FUNCTION fs_rate_card_season_lock();
