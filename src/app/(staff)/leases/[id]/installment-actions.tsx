"use client";

import * as React from "react";
import { useActionState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { updateInstallment, type ActionState } from "../actions";
import type { Enums } from "@/lib/db/database.types";

/**
 * Records what happened to a rent cheque.
 *
 * Clearing one posts collected income to the ledger, so the control is
 * deliberately explicit rather than an inline status dropdown.
 */
export function InstallmentActions({
  installmentId,
  leaseId,
  status,
}: {
  installmentId: string;
  leaseId: string;
  status: Enums<"installment_status">;
}) {
  const [state, action] = useActionState<ActionState, FormData>(updateInstallment, {});
  const [bounceOpen, setBounceOpen] = React.useState(false);

  React.useEffect(() => {
    if (state.success) {
      toast.success(state.success);
      setBounceOpen(false);
    }
    if (state.error) toast.error(state.error);
  }, [state]);

  if (status === "cleared" || status === "cancelled" || status === "written_off") {
    return null;
  }

  return (
    <div className="flex justify-end gap-1">
      <form action={action}>
        <input type="hidden" name="installmentId" value={installmentId} />
        <input type="hidden" name="leaseId" value={leaseId} />
        <input type="hidden" name="status" value="cleared" />
        <Button type="submit" size="sm" variant="outline">
          Cleared
        </Button>
      </form>

      <Dialog open={bounceOpen} onOpenChange={setBounceOpen}>
        <DialogTrigger asChild>
          <Button size="sm" variant="ghost">
            Bounced
          </Button>
        </DialogTrigger>
        <DialogContent>
          <form action={action}>
            <input type="hidden" name="installmentId" value={installmentId} />
            <input type="hidden" name="leaseId" value={leaseId} />
            <input type="hidden" name="status" value="bounced" />
            <DialogHeader>
              <DialogTitle>Record a bounced cheque</DialogTitle>
              <DialogDescription>
                The reason is kept on the tenancy record and shown on the arrears
                view.
              </DialogDescription>
            </DialogHeader>
            <div className="my-4 space-y-1.5">
              <Label htmlFor={`reason-${installmentId}`}>Reason</Label>
              <Input
                id={`reason-${installmentId}`}
                name="bounceReason"
                placeholder="Insufficient funds, account closed, signature mismatch"
                required
              />
            </div>
            <DialogFooter>
              <Button type="submit" variant="destructive">
                Record bounce
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}
