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

## Round 3 (1 Nov 2026): verify every displayed cash line before signing

This addendum supersedes ADR-0012's stored-hash-only limitation. The frozen `MemberLineDTO` and approval contracts remain unchanged. The run's `/lines` read now adds `canonical: LineCanonical` to every member line. The existing Proof reconstruction supplies individual credit marks, carried centavos, slip serials and engine version; api-client mirrors this additive response, with schema parity tests. No new dependency is required.

The phone hashes every preimage, checks its member, rail, net and rate-card hash against the displayed values, and cross-checks the stored hash with `/batch`. Missing preimages and changed cash amounts or rails fail closed. Both roots and the season the Chair first opened remain fixed until an explicit review. At release the approval must also name the paired persona, before signing or registering any key.

Live native signing is refused before presence or signature because native enrollment is a separate protocol. Browser keys remain labelled demo keys. A reused pairing token has explicit new-code recovery, and a declined approval returns `{runState: "IN_REVIEW"}`.

All accepted IC-12 frame personas select their own origin's fs-api, even when the export's API variable is unset or points elsewhere. Before a token the frame is labelled demo data. A token/workspace transition remounts role state and clears preview navigation; reset returns to demo. Selecting HTTP does not supply any still-unimplemented role endpoint. The console must perform the IC-12 handoff described below; this package does not edit the console.

The console must receive version-1 `fs.ready` from the actual same-origin iframe, mint `POST /v1/judge/sessions/:sid/frames` with `{persona: "board:ernesto"}`, and send `{v: 1, t: "fs.token", token, exp: Date.parse(expiresAt), persona: role + ":" + persona, ws: workspaceId}` to that frame with its exact origin. The mint response separates `role: "board"` and `persona: "ernesto"`. It must send `fs.prefs`, send `fs.reset` on reset, and replace tokens for the new workspace. Tokens stay out of URLs.

PayPal execution remains solely the labelled in-process simulator. Seeded statements use T1's seeded AI_NOTE, including named, unnamed and checking forms in all three languages. No seeded reading is presented as live Claude output, and no invoice is presented as drafted by Claude.
