# Seed conflicts and interpretations (WS-CORE)

The seed reproduces every figure in decision register §2 to the cent; `src/canonical.test.ts` checks
them. Where two sources disagree, or a figure only works under one reading, the choice made is
recorded here. The register wins every conflict; within it, the per-member table and the batch
figures are kept exact.

## Conflicts

1. **Hauling on Nong Tidoy's line (M-018).** Register: net US$55.63, "₱200 multa returned as +3.20.
   Hauling ₱91.20 stays". If R2 hauling (₱91.20 = US$1.46) were deducted from his US line, no
   rounding of 120.4 kg could reach 55.63 (the most is 54.18). The design's H3 engine line settles
   it: the multa "was netted from Nong Tidoy's cash at the bodega … Hauling ₱91.20 (R2) stays".
   **Decision:** box-13 marks are deductions already netted from the member's cash at the bodega.
   The engine audits them: a ruled mark (R2 at a purok pickup, exact amount) stays and does not
   touch the US line; an unruled mark raises NO_RULE, and "Return as a credit" adds a credit the
   co-op pays. Pay-time deductions on the US line are R1 (CBU), R3 (loan) and R4 (advance) only.
   "Ruled deductions retained by the co-op: 58.53" is their sum.

2. **"Returned to 63 members: US$17.94" (design MM-3 copy).** The register's redirected US$17.94 is
   Nong Dioning's line with the duplicate (80.65) minus without (62.71). The other 63 members'
   nets rise by **US$18.06** in total, not 17.94, because counting once also moves deductions:
   his CBU falls by 0.31 while the others' CBU and the 50%/30% caps rise by 0.19.
   **Decision:** `figures.redirectedDuplicateCents` = 1794 (the register's figure, defined as the
   holder's difference) and the H1 card prints US$17.94; `figures.othersGainOnCountOnceCents` =
   1806 is published too, so a UI that sums the 63 rows can label it honestly.
   **Pending ADR (raised 23 Oct by review).** The design copy is kept until the user decides,
   because it is design copy: the H1 engine line ("Counting both moves US$17.94 from 63 members to
   Nong Dioning") and the MM-3 line ("Returned to 63 members: US$17.94.") both contradict a judge
   who sums the 63 rows (18.06). Proposed wording: "Counting both adds US$17.94 to Nong Dioning's
   line and puts shrink at 2.05%, over the 2.0% limit." and "Returned to 63 members: US$18.06.";
   the alternative keeps the sentences and prints 18.06 for the 63 members.

3. **Auto-cancel date.** C-27: invoice date + 25 days. S1/design showcase copy: "Auto-cancels
   30 Nov 2026" with the cash day on 30 Oct. A 30 Nov auto-cancel needs a 5 Nov invoice, which is
   after the cash day. **Decision:** the showcase run r37 is invoiced on 29 Oct 2026 (the hero
   recording date), auto-cancel is computed as 23 Nov 2026, the due date is NET_15 (13 Nov) and
   the cash day stays 30 Oct. S3 deviation 13 already treats "30 Nov" as copy.

4. **Serial range of the replay set.** S4.10 suggests starting serials at 0209; the register fixes
   0301–0563. **Decision:** register. A–L hold 0425–0471 plus the pink 0457 (B has the white 0457,
   D the pink); P01–P31 hold 0301–0424 and P32–P54 hold 0472–0563, four per photo.

5. **HALTED.** S3 narrows the kill-switch exit to TREASURER_APPROVED…APPROVED; register §7 adopts
   architecture §4 ("any state below POSTING"). **Decision:** `fsm.run` allows HALT from every
   state below POSTING. DENIED is allowed from POSTING (synchronous 4xx, S3) as well as POSTED and
   SETTLING.

6. **Routes and test hooks.** S1 uses `/console/…`, `/p/:runId` and `data-testid="<ID>/<control>"`;
   register §4 uses `/season/…`, `/runs/…`, `/proof/:runSlug` and `{screenId}.{element}`.
   **Decision:** register (contracts `webRoutes`, `appRoutes`, `testId`).

7. **Key IDs on Proof plate 5.** S1 shows `fs-analyn-a1` and `fs-ernesto-a1` on the two-keys
   plate, and S3.8 makes `fs-ernesto-a1` the showcase Chair's SecureStore key on the phone. A key
   whose private half derives from public text must never carry a device key ID, or a workspace that
   registers keys from the snapshot would accept a Chair co-sign anyone can forge (I6).
   **Decision:** the seeded run r37 is signed with seeded keys `fs-analyn-s1` and `fs-ernesto-s1`
   (`SeededKeyId`, `fs-{persona}-s{n}`), registered only in the seeded ledger as kind `seeded`.
   `officers[].keyId` keeps the device IDs as identity metadata; no public key for them is in the
   snapshot. `device_keys` and the API accept only `DeviceKeyId` (`a` or `w`), and `checkApproval`
   refuses seeded keys. A recorded live run shows the device keys on plate 5.

## Interpretations (no conflict, but a choice had to be made)

- **M-018's rounding.** 55.63 is reachable as 35.55 + 17.77 − 0.89 + 3.20 or 35.54 + 17.78 − 0.89
  - 3.20. The tuner targets the first. All nine named members' premium and bonus shares are listed
    in `src/named.ts` (`NAMED_SHARE_TARGETS`); the background tuner searches until largest-remainder
    rounding lands on them in both the final scenario and with 0457 counted twice (80.65).
- **Verified kilos** are box 11 (payable) kilos. Every seed slip has moisture at or below 7.0%, so
  the moisture deduction is 0.00 and payable = net (slip 0403 reads 38.45 in boxes 8 and 11).
- **The dial before slip 0462 is entered.** "Seed holds, exactly these five items" lists the dial.
  While 0462's kilos are unentered the dial is PENDING (unentered kilos block approval, C-17);
  after entry it reads 2.05% and raises MASS_BALANCE; "Count it once" clears it at 1.62%. This is
  the Judge order (0462 by hand at 0:42, H1 at 0:44). The snapshot carries all three checkpoints.
- **Rate-card hash inputs.** S4.3 hashes the BR 2026-04 page images too. Those files belong to
  WS-MEDIA and are not in the repo yet, so v1 binds the text layer, which the seed defines
  verbatim (S4.3 wording) and hashes. When the page files land, add their sha256 to
  `documents` before the 29 Oct recording; rc8 will change, and everything downstream reads it
  from the snapshot. After the 24 Oct freeze this needs an ADR.
- **Photo hashes.** The images (IC-11) do not exist yet. `photos[].manifestSha256` is the sha256
  of each photo's canonical slip manifest and is what the seed's Proof bundle chains;
  `documents.sha256` in the database is the image file's hash, taken at ingestion.
- **Synthetic PayPal IDs.** Seeded payout item IDs (`SEED…`) and event IDs (`WH-SEED-…`) are
  labelled seeded. Receivers are `.example` aliases; the runtime maps member numbers to
  `PP_RECEIVERS` from env, so live batch digests differ from the seeded one.
- **Seeded keys** (conflict 7). `fs-analyn-s1` and `fs-ernesto-s1` derive from public labels so the
  seeded Proof verifies. They are labelled seeded, never secrets, and never trusted. Real keys live
  on devices.
- **The Proof ledger** follows the contracts' `LedgerPayloads`: `rate_card.ratified` (card hash),
  `rows.accepted` (photo hash and slip dates), `key.registered` (the seeded keys, at the run's
  creation), `invoice.funded`, `lines.computed` (lines root, pools, on-rail net),
  `approval.signed`, `payout.submitting` (batch hash, sender_batch_id, note), `payout.cancel` and
  `webhook.applied`. Seeded webhook entries carry `provenance: "seeded"` and synthetic `WH-SEED-…`
  IDs. `verifyChain` checks every plate against these entries, never against the bundle alone.
- **Unconfirmed kilos** (engine). Kilos no person has confirmed never count, even when their line is
  excluded (C-17: the run waits for them). A pool with no verified kilos to share it by (no Grade-1
  slips while the lot shipped Grade 1) leaves conservation unbalanced and blocks approval. Neither
  case occurs in the seed, so no figure moves.
- **The 9 sandbox accounts.** The seed confirms S5's list: seven on-rail members with sandbox
  personal accounts (M-014, M-007, M-060, M-018, M-039, M-022, M-002), Rhea (M-031) on an address
  with no PayPal account, Merlyn (M-053) and the 55 background members in cash. With the co-op's
  business account and Lantern Bay's personal account that is 9 sandbox accounts (plus S5's
  optional standby "co-op B"). None are real accounts.
- **Officers** are not among the 64 members.
- **`cancelUnclaimed` task argument** is `afterCancel: "cash" | "reroute"` (S3 writes `then`, which
  Biome forbids as a property name).
- **Item status `SUBMITTED`** (rank 0) is ours: batch and item rows are written before the POST.
