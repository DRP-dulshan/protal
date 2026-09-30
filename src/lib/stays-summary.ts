import { nightsBetween, nightsWithin } from "@/lib/calendar";

export interface StayForSummary {
  check_in: string;
  check_out: string;
  payout_expected_aed: number | string | null;
  gross_total_aed: number | string | null;
}

export interface StaysSummary {
  /** Nights booked inside the window. */
  nights: number;
  /** Payout for those nights: a stay across the window edge counts pro rata. */
  payout: number;
  /** Stays in the window with no price yet, so missing from `payout`. */
  unpriced: number;
}

/** Holiday-home stays over [from, to] inclusive, for the dashboard. */
export function summariseStays(stays: StayForSummary[], from: string, to: string): StaysSummary {
  let nights = 0;
  let payout = 0;
  let unpriced = 0;
  for (const s of stays) {
    const inside = nightsWithin(s.check_in, s.check_out, from, to);
    if (inside === 0) continue;
    nights += inside;
    const amount = Number(s.payout_expected_aed) || Number(s.gross_total_aed) || 0;
    const total = nightsBetween(s.check_in, s.check_out);
    if (amount === 0 || total === 0) unpriced++;
    else payout += (amount * inside) / total;
  }
  return { nights, payout: Math.round(payout * 100) / 100, unpriced };
}
