/** Delay before inserting clock-hour quota rows, in milliseconds. */
export function quotaHourDelay(now: number): number {
  const hour = 60 * 60_000;
  const remaining = hour - (now % hour);
  return remaining <= 3 * 60_000 ? remaining + 1_000 : 0;
}
