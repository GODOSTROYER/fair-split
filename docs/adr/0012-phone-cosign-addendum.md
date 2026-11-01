# ADR-0012 addendum: verify every displayed cash line before signing

- Status: K1a round 3, implementing the builder brief
- Date: 1 Nov 2026 (IST)

This addendum supersedes ADR-0012's stored-hash-only limitation. The frozen `MemberLineDTO` and approval contracts remain unchanged. The run's `/lines` read now adds `canonical: LineCanonical` to every member line. The existing Proof reconstruction supplies individual credit marks, carried centavos, slip serials and engine version; api-client mirrors this additive response, with schema parity tests. No new dependency is required.

The phone hashes every preimage, checks its member, rail, net and rate-card hash against the displayed values, and cross-checks the stored hash with `/batch`. Missing preimages and changed cash amounts or rails fail closed. Both roots and the season the Chair first opened remain fixed until an explicit review. At release the approval must also name the paired persona, before signing or registering any key.

Live native signing is refused before presence or signature because native enrollment is a separate protocol. Browser keys remain labelled demo keys. A reused pairing token has explicit new-code recovery, and a declined approval returns `{runState: "IN_REVIEW"}`.

All accepted IC-12 frame personas select their own origin's fs-api, even when the export's API variable is unset or points elsewhere. Before a token the frame is labelled demo data. A token/workspace transition remounts role state and clears preview navigation; reset returns to demo. Selecting HTTP does not supply any still-unimplemented role endpoint. The console must perform the IC-12 handoff described below; this package does not edit the console.

The console must receive version-1 `fs.ready` from the actual same-origin iframe, mint `POST /v1/judge/sessions/:sid/frames` with `{persona: "board:ernesto"}`, and send `{v: 1, t: "fs.token", token, exp: Date.parse(expiresAt), persona: role + ":" + persona, ws: workspaceId}` to that frame with its exact origin. The mint response separates `role: "board"` and `persona: "ernesto"`. It must send `fs.prefs`, send `fs.reset` on reset, and replace tokens for the new workspace. Tokens stay out of URLs.

PayPal execution remains solely the labelled in-process simulator. Seeded statements use T1's seeded AI_NOTE, including named, unnamed and checking forms in all three languages. No seeded reading is presented as live Claude output, and no invoice is presented as drafted by Claude.
