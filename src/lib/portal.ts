import { isStaff, type Role } from "@/lib/auth/rbac";

/**
 * Which surface a request belongs to, decided by hostname.
 *
 *   admin.<domain>  -> the back office
 *   owner.<domain>  -> the owner portal
 *
 * This module is imported by the middleware, so it must stay free of Node and
 * Next server-only APIs.
 *
 * The hostname split is a routing and blast-radius measure, not the security
 * boundary: RLS still decides what each account can read. What it buys is that
 * an owner never lands on a back-office URL, admin pages do not exist on the
 * owner host at all, and each host carries its own session cookie (cookies are
 * host-only), so signing in on one never signs you in on the other.
 */
export type Portal = "admin" | "owner";

/**
 * Resolves the portal from a Host header. `owner.localhost:3000` and
 * `admin.localhost:3000` work in development because browsers resolve any
 * `*.localhost` name to the loopback address.
 *
 * `fallback` covers hosts with no portal subdomain (Vercel preview URLs, bare
 * localhost). Leave it unset in production so an unknown host serves nothing.
 */
export function portalForHost(
  host: string | null | undefined,
  fallback?: string | null
): Portal | null {
  const hostname = (host ?? "").toLowerCase().split(":")[0];
  if (hostname.startsWith("admin.")) return "admin";
  if (hostname.startsWith("owner.")) return "owner";
  return fallback === "admin" || fallback === "owner" ? fallback : null;
}

/** Routes that exist on both hosts: sign-in, auth callbacks and the APIs. */
const SHARED_PREFIXES = ["/login", "/auth", "/api"];

/**
 * Surfaces that are switched off everywhere. Kept in the codebase so they can
 * be re-enabled, but unreachable until a host is assigned to them.
 */
const DISABLED_PREFIXES = ["/portal/tenant", "/portal/guest"];

const OWNER_PREFIX = "/portal/owner";

const matches = (path: string, prefix: string) =>
  path === prefix || path.startsWith(`${prefix}/`);

/**
 * Whether a path may be served on a portal. Anything not allowed is answered
 * with a 404 - not a redirect - so the other portal's URLs are not even
 * confirmed to exist.
 */
export function isPathAllowed(portal: Portal | null, path: string): boolean {
  if (SHARED_PREFIXES.some((p) => matches(path, p))) {
    // APIs work on any host (the website, Airbnb and the scheduler call them
    // on whatever domain they were given). Sign-in pages need a portal.
    return path.startsWith("/api/") || portal !== null;
  }
  if (portal === null) return false;
  if (path === "/") return true;
  if (DISABLED_PREFIXES.some((p) => matches(path, p))) return false;

  if (portal === "owner") return matches(path, OWNER_PREFIX);
  // Admin: the whole back office, but none of the portals.
  return !matches(path, "/portal");
}

/** Whether an account of this role may use this portal at all. */
export function roleAllowedOnPortal(role: Role | null | undefined, portal: Portal | null): boolean {
  if (!role || !portal) return false;
  if (portal === "owner") return role === "owner";
  return isStaff(role);
}

/** Landing page for a portal. */
export function portalHome(portal: Portal): string {
  return portal === "owner" ? OWNER_PREFIX : "/dashboard";
}

/**
 * A post-login `next` target is only honoured when it is a same-origin path
 * that exists on this portal. `//evil.example` and `/\evil.example` are
 * protocol-relative URLs to another site and are rejected.
 */
export function safeNextPath(portal: Portal, next: string | null | undefined): string {
  if (
    !next ||
    !next.startsWith("/") ||
    next.startsWith("//") ||
    next.startsWith("/\\") ||
    next.startsWith("/login") ||
    next.startsWith("/auth/")
  ) {
    return portalHome(portal);
  }
  return isPathAllowed(portal, next.split("?")[0]) ? next : portalHome(portal);
}

export const PORTAL_LABEL: Record<Portal, string> = {
  admin: "Admin portal",
  owner: "Owner portal",
};
