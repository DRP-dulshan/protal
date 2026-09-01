/**
 * Money and VAT.
 *
 * AED is the base currency for every stored amount. Other currencies exist
 * only for display to guests; they never enter the ledger.
 */

export const BASE_CURRENCY = "AED";

/** UAE standard rate. The live value comes from company_settings.vat_rate. */
export const DEFAULT_VAT_RATE = 0.05;

export function formatAED(
  amount: number | string | null | undefined,
  options: { decimals?: boolean; compact?: boolean } = {}
): string {
  const value = typeof amount === "string" ? Number(amount) : amount;
  if (value === null || value === undefined || Number.isNaN(value)) return "—";

  const { decimals = true, compact = false } = options;

  if (compact && Math.abs(value) >= 1_000_000) {
    return `AED ${(value / 1_000_000).toFixed(1)}M`;
  }
  if (compact && Math.abs(value) >= 10_000) {
    return `AED ${(value / 1_000).toFixed(0)}K`;
  }

  return new Intl.NumberFormat("en-AE", {
    style: "currency",
    currency: "AED",
    minimumFractionDigits: decimals ? 2 : 0,
    maximumFractionDigits: decimals ? 2 : 0,
  }).format(value);
}

/** Display-only conversion for guest-facing pages. Never used in accounting. */
export function formatCurrency(
  amountAed: number,
  currency: string,
  rateToAed: number
): string {
  const converted = rateToAed > 0 ? amountAed / rateToAed : amountAed;
  return new Intl.NumberFormat("en-AE", {
    style: "currency",
    currency,
    maximumFractionDigits: 0,
  }).format(converted);
}

/** Round the way the database does, so UI totals match stored totals exactly. */
export function round2(value: number): number {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

export interface VatBreakdown {
  net: number;
  vat: number;
  gross: number;
  rate: number;
  applicable: boolean;
}

/**
 * VAT is decided per line item, not per document: long-term residential rent is
 * exempt while the management fee on that same statement is standard-rated.
 */
export function applyVat(
  netAmount: number,
  vatApplicable: boolean,
  rate: number = DEFAULT_VAT_RATE
): VatBreakdown {
  if (!vatApplicable) {
    return { net: netAmount, vat: 0, gross: netAmount, rate: 0, applicable: false };
  }
  const vat = round2(netAmount * rate);
  return { net: netAmount, vat, gross: round2(netAmount + vat), rate, applicable: true };
}

/** Split a gross figure that already includes VAT back into net + tax. */
export function extractVat(
  grossAmount: number,
  rate: number = DEFAULT_VAT_RATE
): VatBreakdown {
  const net = round2(grossAmount / (1 + rate));
  return {
    net,
    vat: round2(grossAmount - net),
    gross: grossAmount,
    rate,
    applicable: true,
  };
}

export function formatPercent(value: number | null | undefined, decimals = 2): string {
  if (value === null || value === undefined) return "—";
  return `${Number(value).toFixed(decimals)}%`;
}

/**
 * Owner payout, mirroring generate_owner_statement() in SQL. Used to preview a
 * statement before it is generated; the database figure remains authoritative.
 */
export function calculateOwnerPayout(input: {
  grossIncome: number;
  expenses: number;
  managementFee: number;
  feeVatApplicable: boolean;
  vatRate?: number;
}): { managementFee: number; feeVat: number; netPayout: number } {
  const rate = input.vatRate ?? DEFAULT_VAT_RATE;
  const feeVat = input.feeVatApplicable ? round2(input.managementFee * rate) : 0;
  return {
    managementFee: input.managementFee,
    feeVat,
    netPayout: round2(
      input.grossIncome - input.expenses - input.managementFee - feeVat
    ),
  };
}
