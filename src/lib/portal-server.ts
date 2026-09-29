import { headers } from "next/headers";
import { env } from "@/lib/env";
import { portalForRequest, type Portal } from "@/lib/portal";

/** The portal the current request was made to, from its Host header. */
export async function currentPortal(): Promise<Portal | null> {
  const headerList = await headers();
  return portalForRequest(
    headerList.get("host"),
    headerList.get("x-forwarded-host"),
    env.portalFallback
  );
}

/** Where to send a session that does not belong on this portal. */
export const WRONG_PORTAL_PATH = "/auth/signout?reason=wrong_portal";
