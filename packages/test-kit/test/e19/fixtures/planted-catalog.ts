// Planted copy for the E-19 scanner. A comment that says sandbox is code, not copy; so are keys,
// code values and enum values.
export const planted = {
  "W-PF-01.footer.sandbox": "A sandbox prototype on a synthetic co-op.",
  "money.sandbox": "Amounts in the simulated PayPal sandbox are in US dollars.",
  mode: "sandbox",
  tool: "APIMatic",
  key: "W-JG-01.markPaid",
  kind: "CERTIFIED",
} as const;

export const row = (payer: string): string => `Claude drafted ${payer}'s invoice; policy allowed it`;
