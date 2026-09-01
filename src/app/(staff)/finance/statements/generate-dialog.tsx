"use client";

import * as React from "react";
import { useActionState } from "react";
import { useFormStatus } from "react-dom";
import { FilePlus2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { generateStatement, type ActionState } from "../actions";
import { monthBounds } from "@/lib/dates";

function Submit() {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" disabled={pending}>
      {pending ? "Generating…" : "Generate statement"}
    </Button>
  );
}

export function GenerateStatementDialog({
  owners,
}: {
  owners: { id: string; full_name: string }[];
}) {
  const [open, setOpen] = React.useState(false);
  const [state, action] = useActionState<ActionState, FormData>(generateStatement, {});

  React.useEffect(() => {
    if (state.error) toast.error(state.error);
  }, [state]);

  // Default to the month just ended, which is what finance runs each month.
  const lastMonth = new Date();
  lastMonth.setMonth(lastMonth.getMonth() - 1);
  const { start, end } = monthBounds(lastMonth);

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button>
          <FilePlus2 className="size-4" />
          Generate statement
        </Button>
      </DialogTrigger>
      <DialogContent>
        <form action={action}>
          <DialogHeader>
            <DialogTitle>Generate an owner statement</DialogTitle>
            <DialogDescription>
              Collected income and owner-borne expenses for the period are pulled from
              the ledger, the management fee is applied from the active agreement, and
              VAT is added to the fee where it applies.
            </DialogDescription>
          </DialogHeader>

          <div className="my-4 space-y-4">
            <div className="space-y-1.5">
              <Label htmlFor="ownerId">Owner</Label>
              <Select id="ownerId" name="ownerId" required defaultValue="">
                <option value="" disabled>
                  Select an owner
                </option>
                {owners.map((owner) => (
                  <option key={owner.id} value={owner.id}>
                    {owner.full_name}
                  </option>
                ))}
              </Select>
            </div>

            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label htmlFor="periodStart">Period start</Label>
                <Input
                  id="periodStart"
                  name="periodStart"
                  type="date"
                  required
                  defaultValue={start}
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="periodEnd">Period end</Label>
                <Input
                  id="periodEnd"
                  name="periodEnd"
                  type="date"
                  required
                  defaultValue={end}
                />
              </div>
            </div>

            <p className="text-xs text-[var(--muted-foreground)]">
              Ledger lines already carried on another statement are skipped, so the
              same income can never be paid out twice.
            </p>
          </div>

          <DialogFooter>
            <Submit />
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
