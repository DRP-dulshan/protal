import { env } from "@/lib/env";

/**
 * Payment processing behind a provider-agnostic interface.
 *
 * The UAE gateway landscape is unsettled (Ziina, Telr, Network International,
 * Stripe), and D|R|P may run more than one. Business logic must never branch on
 * the processor: it asks for a payment intent and records the result. Swapping
 * or adding a gateway means adding a driver here and nothing else.
 *
 * Cheques and bank transfers - still the norm for Dubai long-term rent - are
 * recorded through the `manual` driver, which is the default.
 */
export interface PaymentIntentRequest {
  amountAed: number;
  reference: string;
  description: string;
  payer: { name: string; email?: string | null; phone?: string | null };
  metadata?: Record<string, string>;
  returnUrl?: string;
}

export interface PaymentIntent {
  provider: string;
  providerReference: string;
  /** Where to send the payer, when the provider hosts the payment page. */
  checkoutUrl?: string;
  status: "pending" | "processing" | "succeeded" | "failed";
}

export interface PaymentWebhookEvent {
  provider: string;
  providerReference: string;
  status: "pending" | "processing" | "succeeded" | "failed" | "refunded" | "cancelled";
  amountAed: number;
  raw: unknown;
}

export interface PaymentDriver {
  readonly name: string;
  readonly supportsOnlineCheckout: boolean;
  createIntent(request: PaymentIntentRequest): Promise<PaymentIntent>;
  verifyWebhook(payload: string, signature: string | null): Promise<PaymentWebhookEvent | null>;
}

/**
 * Default driver: the payment happened outside the system (cheque presented at
 * the bank, direct transfer, cash). Finance records it against the invoice and
 * reconciles it manually.
 */
const manualDriver: PaymentDriver = {
  name: "manual",
  supportsOnlineCheckout: false,

  async createIntent(request) {
    return {
      provider: "manual",
      providerReference: request.reference,
      status: "pending",
    };
  },

  async verifyWebhook() {
    return null;
  },
};

/**
 * Gateway drivers are deliberately unimplemented. Each one fills in
 * createIntent/verifyWebhook against its own API; nothing outside this file
 * changes when one is added.
 */
function unimplemented(name: string): PaymentDriver {
  return {
    name,
    supportsOnlineCheckout: true,
    async createIntent() {
      throw new Error(
        `Payment provider "${name}" is selected but not implemented. ` +
          `Add its driver in src/lib/payments/ or set PAYMENT_PROVIDER=none.`
      );
    },
    async verifyWebhook() {
      throw new Error(`Payment provider "${name}" is selected but not implemented.`);
    },
  };
}

export const payments: PaymentDriver = (() => {
  switch (env.payments.provider) {
    case "ziina":
      return unimplemented("ziina");
    case "telr":
      return unimplemented("telr");
    case "network":
      return unimplemented("network");
    case "stripe":
      return unimplemented("stripe");
    default:
      return manualDriver;
  }
})();
