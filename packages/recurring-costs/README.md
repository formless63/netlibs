# @formless63/recurring-costs

Monthly and yearly figures for prices billed per cycle, totals per currency, and the next renewal dates.
Exact money, no floating point, no dependencies, runs in a browser.

```ts
import { normalizeCost, formatScaled, totalCosts, projectRenewal, renewalsWithin, isoDateIn } from '@formless63/recurring-costs';

formatScaled(normalizeCost('34.82', 'biennial')!.monthly);           // '1.45'
totalCosts([
  { price: '62.49', currency: 'USD', billingCycle: 'annual' },
  { price: '5.00', currency: 'EUR', billingCycle: 'monthly' },
  { price: null, currency: 'USD', billingCycle: 'unknown' }
]);
// [{ currency: 'USD', monthly: '5.21', yearly: '62.49', counted: 1, unknown: 1 },
//  { currency: 'EUR', monthly: '5.00', yearly: '60.00', counted: 1, unknown: 0 }]

const today = isoDateIn(new Date(), 'Europe/Berlin');
projectRenewal('2025-01-16', 'annual', today);    // { date: '2027-01-16', daysUntil, projected: true, stored }
renewalsWithin('2026-12-01', 'monthly', today, 90);
```

- **Cycles:** `monthly`, `quarterly`, `semiannual`, `annual`, `biennial`, `triennial`, `free`, `unknown`.
  `free` costs zero; `unknown`, a missing price or a malformed one is unknown, not zero, and is counted
  separately in totals.
- **Money:** `parseMoney` accepts a non-negative decimal with at most two places and returns `bigint`
  hundred-thousandths (`MONEY_SCALE`). Figures are divided once, summed unrounded and rounded half away from
  zero only by `formatScaled`. Currencies are never added together; they are grouped as given.
- **Dates:** ISO calendar dates without a time zone. `addMonths` clamps to the month end (`01-31` + 1 →
  `02-28`). A passed renewal is rolled forward by whole cycles from the stored date, so it does not drift
  after a short month, and `projected: true` tells you to confirm it with the provider. With no cycle a
  passed date stays in the past (`daysUntil < 0`).

Errors: invalid input to the money and projection functions gives `null`. `addMonths` throws `RangeError`
for a malformed date or fractional months, `renewalsWithin` for a non-finite horizon, `isoDateIn` for an
unknown time zone.

Limitations: no currencies with three decimals or none, no proration, taxes, discounts or exchange rates, and
no cycles other than the eight above.
