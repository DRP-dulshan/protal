"use client";

import * as React from "react";
import { Plus, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";

interface Row {
  key: number;
  ownerId: string;
  pct: string;
}

let nextKey = 0;

/**
 * The unit's owners: one row per owner with their share. Adding a second
 * owner splits the shares evenly as a starting point; the total may not
 * exceed 100%.
 */
export function OwnersEditor({
  owners,
  initial,
  editing,
}: {
  owners: { id: string; full_name: string }[];
  initial: { ownerId: string; pct: number }[];
  editing: boolean;
}) {
  const [rows, setRows] = React.useState<Row[]>(() =>
    initial.length
      ? initial.map((o) => ({ key: nextKey++, ownerId: o.ownerId, pct: String(o.pct) }))
      : [{ key: nextKey++, ownerId: "", pct: "100" }]
  );

  const update = (key: number, patch: Partial<Row>) =>
    setRows((current) => current.map((r) => (r.key === key ? { ...r, ...patch } : r)));

  const addOwner = () =>
    setRows((current) => {
      const next = [...current, { key: nextKey++, ownerId: "", pct: "0" }];
      const even = Math.floor((100 / next.length) * 100) / 100;
      // Even split, with any rounding left over on the first owner.
      return next.map((r, i) => ({
        ...r,
        pct: String(i === 0 ? Math.round((100 - even * (next.length - 1)) * 100) / 100 : even),
      }));
    });

  const total = rows.filter((r) => r.ownerId).reduce((sum, r) => sum + (Number(r.pct) || 0), 0);
  const chosen = new Set(rows.map((r) => r.ownerId).filter(Boolean));

  return (
    <div className="space-y-3 sm:col-span-2">
      <input type="hidden" name="ownersEdited" value="1" />
      {rows.map((row, i) => (
        <div key={row.key} className="grid grid-cols-[1fr_7rem_auto] items-end gap-2">
          <div className="space-y-1.5">
            {i === 0 && <Label htmlFor={`owner-${row.key}`}>Owner</Label>}
            <Select
              id={`owner-${row.key}`}
              name="ownerId"
              value={row.ownerId}
              onChange={(e) => update(row.key, { ownerId: e.target.value })}
            >
              <option value="">{editing ? "No owner" : "Link later"}</option>
              {owners.map((o) => (
                <option key={o.id} value={o.id} disabled={o.id !== row.ownerId && chosen.has(o.id)}>
                  {o.full_name}
                </option>
              ))}
            </Select>
          </div>
          <div className="space-y-1.5">
            {i === 0 && <Label htmlFor={`pct-${row.key}`}>Share (%)</Label>}
            <Input
              id={`pct-${row.key}`}
              name="ownershipPct"
              type="number"
              step="0.01"
              min="0.01"
              max="100"
              value={row.pct}
              onChange={(e) => update(row.key, { pct: e.target.value })}
            />
          </div>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            aria-label="Remove this owner"
            disabled={rows.length === 1}
            onClick={() => setRows((current) => current.filter((r) => r.key !== row.key))}
          >
            <X className="size-4" />
          </Button>
        </div>
      ))}
      <div className="flex flex-wrap items-center justify-between gap-2">
        <Button type="button" variant="outline" size="sm" onClick={addOwner} disabled={rows.length >= 10}>
          <Plus className="size-4" />
          Add another owner
        </Button>
        <p className={cn("text-xs", total > 100.001 ? "text-[var(--destructive)]" : "text-[var(--muted-foreground)]")}>
          Total {Math.round(total * 100) / 100}% {total > 100.001 ? "- the shares cannot exceed 100%" : "of 100%"}
        </p>
      </div>
      {editing && (
        <p className="text-xs text-[var(--muted-foreground)]">
          Removing or replacing an owner ends their ownership today and keeps it as history.
        </p>
      )}
    </div>
  );
}
