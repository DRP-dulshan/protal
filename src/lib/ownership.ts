/**
 * A unit's owners as the unit form edits them: one or more owners, each with
 * a share, together at most 100%.
 */

export interface OwnerShare {
  ownerId: string;
  pct: number;
}

export interface ActiveOwnership {
  id: string;
  owner_id: string;
  ownership_pct: number;
  start_date: string;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** The owner rows of the form (parallel ownerId / ownershipPct lists). Rows with no owner are ignored. */
export function parseOwnerShares(
  ownerIds: string[],
  pcts: string[]
): { shares: OwnerShare[]; error?: string } {
  const shares: OwnerShare[] = [];
  for (let i = 0; i < ownerIds.length; i++) {
    const ownerId = (ownerIds[i] ?? "").trim();
    if (!ownerId) continue;
    if (!UUID.test(ownerId)) return { shares: [], error: "Choose the owner from the list." };
    const pct = Number((pcts[i] ?? "").trim() || "100");
    if (!Number.isFinite(pct) || pct <= 0 || pct > 100) {
      return { shares: [], error: "Each owner's share must be more than 0% and at most 100%." };
    }
    if (shares.some((s) => s.ownerId === ownerId)) {
      return { shares: [], error: "The same owner is listed twice." };
    }
    shares.push({ ownerId, pct: Math.round(pct * 100) / 100 });
  }
  const total = shares.reduce((sum, s) => sum + s.pct, 0);
  if (total > 100.001) {
    return { shares: [], error: `The owners' shares add up to ${Math.round(total * 100) / 100}%. They cannot exceed 100%.` };
  }
  return { shares };
}

export interface OwnershipPlan {
  /** Owners no longer on the unit: history kept (ended), or deleted when set today by mistake. */
  end: { id: string; delete: boolean }[];
  /** Share changes, smaller shares first so the running total never passes 100%. */
  update: { id: string; pct: number }[];
  add: OwnerShare[];
}

/** What to change so the unit's active ownerships match the form. */
export function planOwnership(active: ActiveOwnership[], desired: OwnerShare[], today: string): OwnershipPlan {
  const wanted = new Map(desired.map((d) => [d.ownerId, d.pct]));
  const end = active
    .filter((a) => !wanted.has(a.owner_id))
    // An owner set today and removed today never owned the unit.
    .map((a) => ({ id: a.id, delete: a.start_date >= today }));
  const update = active
    .filter((a) => wanted.has(a.owner_id) && Number(a.ownership_pct) !== wanted.get(a.owner_id))
    .map((a) => ({ id: a.id, pct: wanted.get(a.owner_id)!, delta: wanted.get(a.owner_id)! - Number(a.ownership_pct) }))
    .sort((x, y) => x.delta - y.delta)
    .map(({ id, pct }) => ({ id, pct }));
  const current = new Set(active.map((a) => a.owner_id));
  const add = desired.filter((d) => !current.has(d.ownerId));
  return { end, update, add };
}
