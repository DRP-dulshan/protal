/**
 * The price of a direct holiday-home stay from a unit's rates, worked out the
 * way Airbnb does: Friday and Saturday nights at the weekend rate, and a
 * length-of-stay discount (monthly from 28 nights, else weekly from 7) taken
 * off the nights only - never off the cleaning fee.
 */

export interface UnitRates {
  nightly: number;
  /** Friday and Saturday nights; null or 0 means the nightly rate. */
  weekend?: number | null;
  weeklyDiscountPct?: number | null;
  monthlyDiscountPct?: number | null;
}

export interface StayQuote {
  nights: number;
  weekdayNights: number;
  weekendNights: number;
  /** Nights at their rates, before any discount. */
  nightsTotal: number;
  discountPct: number;
  discount: number;
  /** What the nights cost after the discount: the booking's accommodation. */
  accommodation: number;
}

const round2 = (n: number) => Math.round(n * 100) / 100;

/** The length-of-stay discount a unit gives for this many nights. */
export function stayDiscountPct(nights: number, rates: Pick<UnitRates, "weeklyDiscountPct" | "monthlyDiscountPct">): number {
  if (nights >= 28 && rates.monthlyDiscountPct) return rates.monthlyDiscountPct;
  if (nights >= 7 && rates.weeklyDiscountPct) return rates.weeklyDiscountPct;
  return 0;
}

/**
 * Quotes check-in to check-out (ISO dates, check-out exclusive). `discountPct`
 * overrides the unit's length-of-stay discount when staff agree another.
 */
export function quoteStay(
  checkIn: string,
  checkOut: string,
  rates: UnitRates,
  discountPct?: number
): StayQuote {
  let weekdayNights = 0;
  let weekendNights = 0;
  const end = Date.parse(`${checkOut}T00:00:00Z`);
  for (let t = Date.parse(`${checkIn}T00:00:00Z`); t < end; t += 86_400_000) {
    const day = new Date(t).getUTCDay(); // the night starting on this date
    if (day === 5 || day === 6) weekendNights++;
    else weekdayNights++;
  }
  const nights = weekdayNights + weekendNights;
  const weekend = rates.weekend && rates.weekend > 0 ? rates.weekend : rates.nightly;
  const nightsTotal = round2(weekdayNights * rates.nightly + weekendNights * weekend);
  const pct = Math.min(Math.max(discountPct ?? stayDiscountPct(nights, rates), 0), 99.99);
  const discount = round2((nightsTotal * pct) / 100);
  return {
    nights,
    weekdayNights,
    weekendNights,
    nightsTotal,
    discountPct: pct,
    discount,
    accommodation: round2(nightsTotal - discount),
  };
}
