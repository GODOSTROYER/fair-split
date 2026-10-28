# Vendored PayPal OpenAPI specifications

These four files are copied **unmodified** from PayPal's official specification repository,
[github.com/paypal/paypal-rest-api-specifications](https://github.com/paypal/paypal-rest-api-specifications),
at commit `90e8041ffe02d80c452d2b476bedd59a8d219bdc` (2026-04-07), fetched on 2026-10-22. They are
licensed under the Apache License, Version 2.0; the licence text is in [`LICENSE`](./LICENSE), copied from the
same commit. [`PROVENANCE.json`](./PROVENANCE.json) records each file's upstream path, SHA-256 and spec version,
and `test/spec.test.ts` fails if a vendored file changes.

| File                             | Spec                | Version | Used for                             |
| -------------------------------- | ------------------- | ------- | ------------------------------------ |
| `invoicing_v2.json`              | Invoices            | 2.6     | Invoicing v2 requests and responses  |
| `payments_payouts_batch_v1.json` | Payouts             | 1.9     | Payouts v1 requests and responses    |
| `notifications_webhooks_v1.json` | Webhooks Management | 1.11    | Webhooks v1, events and verification |
| `reporting_transactions_v1.json` | Transaction Search  | 1.9     | Transaction Search and balances      |

Only the specifications the simulator needs are vendored.

## Supplements (written by Fair Split, not PayPal files)

`supplements/` holds two small OpenAPI documents for operations the Apache-2.0 repository does not contain:
- `invoicing_conditional_rules.json` — `/v2/invoicing/invoices/{id}/conditional-rules` (create, list, get, update,
  delete), transcribed by hand from the public Invoicing v2 reference on developer.paypal.com (field names, enums,
  lengths and patterns only). One deliberate deviation: a listed `rules` array may be empty.
- `oauth2_token.json` — `POST /v1/oauth2/token` (client credentials), from PayPal's public authentication guide.

These two files are part of Fair Split and are covered by the repository's own licence.
