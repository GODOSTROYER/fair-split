// Proof's face from the first layout (S2.11: Proof's fonts ≤80 KB). The browser fetches the root element's face as
// soon as the stylesheet applies, long before main.tsx runs, so on Proof's two surfaces (`/proof/:runSlug` and
// `/b/:token`, src/lib/face.ts isProofPath) this flags <html data-face="proof"> first. index.html loads it as a
// classic, blocking script ahead of the stylesheet; fs-api's CSP (script-src 'self') allows no inline script.
if (/^\/(?:proof|b)\/[^/]+\/?$/.test(location.pathname)) document.documentElement.dataset.face = "proof";
