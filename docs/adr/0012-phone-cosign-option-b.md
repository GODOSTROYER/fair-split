# ADR-0012: The Chair checks fs-api's existing batch and line reads

- Status: implementation of the user's binding D2, option B
- Date: 1 Nov 2026 (IST)
- Work package: K1a

The frozen approval-payload response is `{payload, jcs}`. The former mobile shim assumed a `/cosign` route, canonical line preimages in the payload, and a device-key endpoint that fs-api does not serve.

The phone assembles its board view from the run, season, `/batch` and `/lines` reads. It recomputes the batch digest with the existing parity-checked domain digest implementation, and the lines root from every returned `{memberNo, lineSha256}`, including cash lines. The two reads must name the same run and have the same complete membership and line hashes. At release, the payload is fetched with fresh batch and lines reads, and both recomputed digests must still match the batch the Chair opened. A mismatch refuses before asking for a key; no signature is queued offline.

`MemberLineDTO` does not expose canonical preimages (individual credit marks and carried centavos are absent). Option B therefore verifies the stored line-hash root, not a fresh hash of each full canonical line. The labelled local demo retains its full canonical-line checks. No missing preimage is fabricated, and no frozen contract changes.

Browser keys prove possession to `/v1/judge/keys` by signing its canonical registration statement. fs-api assigns the key ID; the phone keeps the local-to-server public key mapping only in memory, scoped to its pairing and token. The approval goes through fs-api's approval route using that assigned ID. Native key enrollment remains a separate protocol; this package fails closed for live native enrollment.

The `/app` export sets `EXPO_PUBLIC_API_ORIGIN=same-origin`. Judge frames show labelled demo data until a same-origin, parent-originated, version-1 IC-12 board token is accepted. Reset returns the frame to demo. The Clerk stays in labelled demo mode; the Member's live statement integration belongs to K1c. K1b's session read supplies the run slug without guessing a seeded run. Browser seals draw through `@fairsplit/seal`, guarded by its golden vectors.

All PayPal execution uses the in-process simulator and board screens label it "Simulated PayPal sandbox". Seeded or replayed reads do not claim a live Claude reading or a Claude-drafted invoice.
