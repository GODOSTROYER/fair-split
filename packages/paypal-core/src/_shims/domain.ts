// TEMPORARY SHIM: replace with @fairsplit/contracts|domain after WS-CORE merges.
//
// Mirrors the decision register §7 rank table that `fsm.item` (IC-02) will own:
// PENDING 10, ONHOLD 20, UNCLAIMED 30, RETURNED 40, FAILED and BLOCKED 50, SUCCESS 60,
// REFUNDED and REVERSED 70. A status is applied only if its rank is higher than the current one.

import type { ItemStatus } from "./contracts.js";

export const ITEM_STATUS_RANK: Readonly<Record<ItemStatus, number>> = Object.freeze({
  PENDING: 10,
  ONHOLD: 20,
  UNCLAIMED: 30,
  RETURNED: 40,
  FAILED: 50,
  BLOCKED: 50,
  SUCCESS: 60,
  REFUNDED: 70,
  REVERSED: 70,
});
