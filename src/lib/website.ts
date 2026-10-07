import { env } from "@/lib/env";

export type RebuildResult = { started: boolean; reason?: string };

/**
 * Asks Vercel to rebuild the D|R|P website (WEBSITE_DEPLOY_HOOK_URL), which
 * pulls the published listings from /api/public/listings as it builds.
 * Never throws: a listing is saved whether or not the rebuild starts.
 */
export async function rebuildWebsite(): Promise<RebuildResult> {
  const hook = env.websiteDeployHookUrl;
  if (!hook) return { started: false, reason: "not_configured" };
  try {
    const response = await fetch(hook, { method: "POST", signal: AbortSignal.timeout(10_000) });
    if (!response.ok) {
      console.error(`[website] deploy hook answered HTTP ${response.status}`);
      return { started: false, reason: `HTTP ${response.status}` };
    }
    return { started: true };
  } catch (error) {
    console.error(`[website] deploy hook failed: ${error instanceof Error ? error.message : error}`);
    return { started: false, reason: "unreachable" };
  }
}
