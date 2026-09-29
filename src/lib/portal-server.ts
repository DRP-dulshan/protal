import { headers } from "next/headers";
import { env } from "@/lib/env";
import { portalForHost, type Portal } from "@/lib/portal";

/** The portal the current request was made to, from its Host header. */
export async function currentPortal(): Promise<Portal | null> {
  const headerList = await headers();
  return portalForHost(headerList.get("host"), env.portalFallback);
}

/** Where to send a session that does not belong on this portal. */
export const WRONG_PORTAL_PATH = "/auth/signout?reason=wrong_portal";
