/**
 * Single place where configuration enters the application.
 *
 * Nothing else in the codebase reads process.env directly (outside of the two
 * NEXT_PUBLIC_ values the browser bundle needs inlined). Keeping it here is
 * what makes moving from Vercel + Supabase to AWS Amplify + RDS/Cognito a
 * configuration change rather than a refactor.
 */

const optional = (key: string): string | undefined => {
  const value = process.env[key];
  return value && value.length > 0 ? value : undefined;
};

export const env = {
  supabaseUrl: process.env.NEXT_PUBLIC_SUPABASE_URL ?? "",
  // Supabase renamed its keys: new projects issue `sb_publishable_...` /
  // `sb_secret_...`, older ones the JWT-style anon / service_role pair. Both
  // names are accepted so a project of either vintage works untouched.
  // These must stay as literal process.env references - that is what lets
  // Next.js inline them into the browser bundle.
  supabaseAnonKey:
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ??
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ??
    "",
  supabaseServiceRoleKey:
    optional("SUPABASE_SECRET_KEY") ?? optional("SUPABASE_SERVICE_ROLE_KEY"),

  appUrl: process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000",
  appName: process.env.NEXT_PUBLIC_APP_NAME ?? "D|R|P Property Management",

  storage: {
    driver: (optional("STORAGE_DRIVER") ?? "supabase") as "supabase" | "s3",
    documentsBucket: optional("STORAGE_BUCKET_DOCUMENTS") ?? "documents",
    mediaBucket: optional("STORAGE_BUCKET_MEDIA") ?? "media",
  },

  payments: {
    provider: (optional("PAYMENT_PROVIDER") ?? "none") as
      | "none"
      | "ziina"
      | "telr"
      | "network"
      | "stripe",
    apiKey: optional("PAYMENT_API_KEY"),
    webhookSecret: optional("PAYMENT_WEBHOOK_SECRET"),
  },

  messaging: {
    whatsappProvider: (optional("WHATSAPP_PROVIDER") ?? "none") as "none" | "meta",
    whatsappPhoneNumberId: optional("WHATSAPP_PHONE_NUMBER_ID"),
    whatsappAccessToken: optional("WHATSAPP_ACCESS_TOKEN"),
    emailProvider: (optional("EMAIL_PROVIDER") ?? "none") as "none" | "resend",
    resendApiKey: optional("RESEND_API_KEY"),
    emailFrom: optional("EMAIL_FROM") ?? "noreply@example.ae",
    smsProvider: (optional("SMS_PROVIDER") ?? "none") as "none" | "generic",
    smsApiKey: optional("SMS_API_KEY"),
  },
} as const;

/** True once Supabase credentials are present. Drives the /setup screen. */
export const isConfigured = Boolean(env.supabaseUrl && env.supabaseAnonKey);
