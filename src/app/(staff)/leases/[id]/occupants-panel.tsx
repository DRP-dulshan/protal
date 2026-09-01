"use client";

import * as React from "react";
import { useActionState } from "react";
import { useFormStatus } from "react-dom";
import { UserPlus, CheckCircle2, X } from "lucide-react";
import { toast } from "sonner";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { EmptyState, Callout } from "@/components/domain/shared";
import { formatDate } from "@/lib/dates";
import {
  addOccupant,
  removeOccupant,
  markOccupantsSynced,
  type ActionState,
} from "../actions";
import type { Tables } from "@/lib/db/database.types";

function Submit({ children }: { children: React.ReactNode }) {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" disabled={pending} size="sm">
      {pending ? "Saving…" : children}
    </Button>
  );
}

/**
 * Declared occupants for a tenancy.
 *
 * Since 2026 Ejari must reflect who actually lives in the unit, and any change
 * has to be filed within 30 days. The panel makes that obligation visible:
 * adding or removing anyone marks the record stale until a manager confirms
 * Ejari has been updated.
 */
export function OccupantsPanel({
  leaseId,
  occupants,
  stale,
  lastSyncedAt,
  windowDays,
  canSync,
}: {
  leaseId: string;
  occupants: Tables<"lease_occupants">[];
  stale: boolean;
  lastSyncedAt: string | null;
  windowDays: number;
  canSync: boolean;
}) {
  const [adding, setAdding] = React.useState(false);
  const [addState, addAction] = useActionState<ActionState, FormData>(addOccupant, {});
  const [removeState, removeAction] = useActionState<ActionState, FormData>(
    removeOccupant,
    {}
  );
  const [syncState, syncAction] = useActionState<ActionState, FormData>(
    markOccupantsSynced,
    {}
  );
  const formRef = React.useRef<HTMLFormElement>(null);

  React.useEffect(() => {
    for (const state of [addState, removeState, syncState]) {
      if (state.success) toast.success(state.success);
      if (state.error) toast.error(state.error);
    }
    if (addState.success) {
      formRef.current?.reset();
      setAdding(false);
    }
  }, [addState, removeState, syncState]);

  // The filing deadline runs from the change, so a stale record is already on
  // the clock; showing the window keeps the urgency concrete.
  return (
    <div className="space-y-4">
      {stale && (
        <Callout tone="warning" title="Ejari update required">
          The occupant list has changed since it was last filed. Ejari must be
          updated within {windowDays} days of the change. Once you have filed it,
          confirm below so the compliance calendar clears.
        </Callout>
      )}

      <Card>
        <CardHeader className="flex-row items-start justify-between gap-3">
          <div>
            <CardTitle className="text-base">Declared occupants</CardTitle>
            <p className="mt-1 text-xs text-[var(--muted-foreground)]">
              Last filed with Ejari:{" "}
              {lastSyncedAt ? formatDate(lastSyncedAt) : "never"}
            </p>
          </div>
          <div className="flex shrink-0 gap-2">
            {stale && canSync && (
              <form action={syncAction}>
                <input type="hidden" name="leaseId" value={leaseId} />
                <Button type="submit" size="sm" variant="brand">
                  <CheckCircle2 className="size-4" />
                  Mark filed with Ejari
                </Button>
              </form>
            )}
            <Button size="sm" variant="outline" onClick={() => setAdding((v) => !v)}>
              <UserPlus className="size-4" />
              {adding ? "Cancel" : "Add occupant"}
            </Button>
          </div>
        </CardHeader>

        {adding && (
          <CardContent className="pt-0">
            <form
              ref={formRef}
              action={addAction}
              className="grid gap-3 rounded-lg border border-dashed border-[var(--border)] p-4 sm:grid-cols-2"
            >
              <input type="hidden" name="leaseId" value={leaseId} />
              <div className="space-y-1.5">
                <Label htmlFor="fullName">Full name</Label>
                <Input id="fullName" name="fullName" required />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="relationship">Relationship</Label>
                <Input
                  id="relationship"
                  name="relationship"
                  placeholder="Spouse, child, flatmate, domestic staff"
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="nationality">Nationality</Label>
                <Input id="nationality" name="nationality" />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="emiratesId">Emirates ID</Label>
                <Input id="emiratesId" name="emiratesId" placeholder="784-____-_______-_" />
              </div>
              <div className="space-y-1.5 sm:col-span-2">
                <Label htmlFor="passportNumber">Passport number</Label>
                <Input id="passportNumber" name="passportNumber" />
              </div>
              <div className="sm:col-span-2">
                <Submit>Add occupant</Submit>
              </div>
            </form>
          </CardContent>
        )}

        <CardContent className="p-0">
          {occupants.length === 0 ? (
            <div className="p-5">
              <EmptyState
                title="No occupants declared"
                description="Ejari requires the tenant and every occupant of the unit to be declared and kept current."
              />
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Name</TableHead>
                  <TableHead className="hidden sm:table-cell">Relationship</TableHead>
                  <TableHead className="hidden md:table-cell">Emirates ID</TableHead>
                  <TableHead>Filed</TableHead>
                  <TableHead className="w-10" />
                </TableRow>
              </TableHeader>
              <TableBody>
                {occupants.map((occupant) => (
                  <TableRow key={occupant.id}>
                    <TableCell>
                      <span className="font-medium">{occupant.full_name}</span>
                      {occupant.is_primary && (
                        <Badge variant="muted" className="ml-2">
                          Tenant
                        </Badge>
                      )}
                      <p className="text-xs text-[var(--muted-foreground)]">
                        {occupant.nationality ?? ""}
                      </p>
                    </TableCell>
                    <TableCell className="hidden sm:table-cell text-sm">
                      {occupant.relationship ?? "—"}
                    </TableCell>
                    <TableCell className="hidden md:table-cell tabular text-sm">
                      {occupant.emirates_id ?? occupant.passport_number ?? "—"}
                    </TableCell>
                    <TableCell>
                      {occupant.ejari_synced_at ? (
                        <Badge variant="success">
                          {formatDate(occupant.ejari_synced_at)}
                        </Badge>
                      ) : (
                        <Badge variant="warning">Not filed</Badge>
                      )}
                    </TableCell>
                    <TableCell>
                      <form action={removeAction}>
                        <input type="hidden" name="leaseId" value={leaseId} />
                        <input type="hidden" name="occupantId" value={occupant.id} />
                        <Button
                          type="submit"
                          variant="ghost"
                          size="icon"
                          aria-label={`Remove ${occupant.full_name}`}
                        >
                          <X className="size-4" />
                        </Button>
                      </form>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
