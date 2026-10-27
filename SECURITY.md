# Security policy

Fair Split: co-op payroll is a hackathon project. It runs only against the PayPal **sandbox**, and every co-op,
member and document in it is synthetic. No real money moves and no real personal data is stored.

## Supported versions

Only the latest commit on `main` and the hosted Judge Mode deployment are maintained.

## Reporting a vulnerability

Please report privately through GitHub: on this repository, open **Security → Report a vulnerability**
(private vulnerability reporting). Do not open a public issue for a security problem.

Useful details: what you found, how to reproduce it, and what an attacker could do with it. We aim to reply
within 3 days during the hackathon (until 12 Nov 2026) and within 7 days after it.

In scope:
- A secret, token or real email address in the repository, its history, fixtures, releases or the film.
- Ways to move sandbox money without the two human approvals, or to change an approved batch (invariants I4, I6).
- Webhook verification bypasses, auth or frame-token issues, injection through slip images.

Out of scope: PayPal's, Anthropic's or Render's own services (report to them), and denial of service against the
shared sandbox rate limit.

## If you find a leaked secret

Tell us privately as above. We rotate first, then rewrite history; see [`docs/security.md`](docs/security.md).
