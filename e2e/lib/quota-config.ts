// The private stack's hourly cap leaves room for every independent live-payout spec while the daily cap stays 40.
// Production still uses three; apps/api accepts this override only in test+simulator mode outside Render.
export const E2E_HOURLY_CAP = 24;
