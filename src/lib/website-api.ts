import { timingSafeEqual } from "node:crypto";
import { NextResponse } from "next/server";
import { env } from "@/lib/env";

/** Headers for the read-only public endpoints. */
export const PUBLIC_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
  "Cache-Control": "no-store",
  "X-Robots-Tag": "noindex",
};

/** The website is the only caller of the booking endpoints, and proves it with WEBSITE_API_KEY. */
export function websiteAuthError(request: Request): NextResponse | null {
  const key = env.websiteApiKey;
  if (!key) {
    return NextResponse.json({ error: "WEBSITE_API_KEY is not configured." }, { status: 503, headers: { "Cache-Control": "no-store" } });
  }
  const given = Buffer.from(request.headers.get("authorization") ?? "");
  const expected = Buffer.from(`Bearer ${key}`);
  if (given.length !== expected.length || !timingSafeEqual(given, expected)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401, headers: { "Cache-Control": "no-store" } });
  }
  return null;
}

/** website_book_unit / website_set_booking_status raise "code: message"; the code picks the HTTP status. */
export function parseDbError(message: string): { code: string; message: string } {
  const m = message.match(/^(not_found|blocked|taken|no_permit|invalid):\s*(.*)$/s);
  return m ? { code: m[1], message: m[2] } : { code: "error", message };
}

export const STATUS_FOR_CODE: Record<string, number> = {
  not_found: 404,
  blocked: 409,
  taken: 409,
  no_permit: 422,
  invalid: 400,
};
