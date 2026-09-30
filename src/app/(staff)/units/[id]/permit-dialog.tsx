"use client";

import * as React from "react";
import { useActionState } from "react";
import { useFormStatus } from "react-dom";
import { FilePlus2, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { FormError, SelectField, TextAreaField, TextField } from "@/components/domain/form";
import type { Tables } from "@/lib/db/database.types";
import { addPermit, deletePermit, updatePermit, type ActionState } from "../../bookings/actions";

const STATUSES = [
  { value: "active", label: "Active" },
  { value: "pending", label: "Pending (applied, not issued)" },
  { value: "expired", label: "Expired" },
  { value: "suspended", label: "Suspended" },
  { value: "cancelled", label: "Cancelled" },
  { value: "draft", label: "Draft" },
];

function Submit() {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" disabled={pending}>
      {pending ? "Saving…" : "Save permit"}
    </Button>
  );
}

/**
 * Records a DET permit, or - given `permit` - edits one already recorded.
 * `trigger` replaces the default button, so a permit's row can open it.
 */
export function PermitDialog({
  unitId,
  hasPermit = false,
  permit,
  trigger,
}: {
  unitId: string;
  hasPermit?: boolean;
  permit?: Tables<"holiday_home_permits">;
  trigger?: React.ReactNode;
}) {
  const [open, setOpen] = React.useState(false);
  const [removing, startRemove] = React.useTransition();
  const submit = React.useMemo(
    () => (permit ? updatePermit.bind(null, permit.id, unitId) : addPermit.bind(null, unitId)),
    [permit, unitId]
  );
  const [state, action] = useActionState<ActionState, FormData>(submit, {});

  React.useEffect(() => {
    if (state.success) {
      toast.success(state.success);
      setOpen(false);
    }
  }, [state]);

  const remove = () => {
    if (!permit) return;
    if (!confirm(`Remove permit ${permit.permit_number}? Use this only for a permit recorded by mistake.`)) return;
    startRemove(async () => {
      const result = await deletePermit(permit.id, unitId);
      if (result.error) toast.error(result.error);
      else {
        toast.success(result.success ?? "Permit removed.");
        setOpen(false);
      }
    });
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        {trigger ?? (
          <Button size="sm">
            <FilePlus2 className="size-4" />
            {hasPermit ? "Add renewal" : "Add permit"}
          </Button>
        )}
      </DialogTrigger>
      <DialogContent className="max-h-[90dvh] overflow-y-auto">
        <form action={action}>
          <DialogHeader>
            <DialogTitle>
              {permit ? `Permit ${permit.permit_number}` : hasPermit ? "Record a permit renewal" : "Record the DET permit"}
            </DialogTitle>
            <DialogDescription>
              As issued by Dubai&apos;s Department of Economy and Tourism. Bookings are
              accepted only while a permit covers the check-in date.
            </DialogDescription>
          </DialogHeader>

          <div className="my-4 grid gap-4 sm:grid-cols-2">
            <FormError message={state.error} />
            <TextField
              name="permitNumber"
              label="Permit number"
              required
              placeholder="e.g. HH-DXB-104582"
              defaultValue={permit?.permit_number ?? ""}
            />
            <TextField
              name="classification"
              label="Classification"
              placeholder="e.g. Standard"
              defaultValue={permit?.det_classification ?? ""}
            />
            <TextField name="issuedOn" label="Issued on" type="date" required defaultValue={permit?.issued_on ?? ""} />
            <TextField name="expiresOn" label="Expires on" type="date" required defaultValue={permit?.expires_on ?? ""} />
            {permit && (
              <SelectField name="status" label="Status" required defaultValue={permit.status} options={STATUSES} />
            )}
            <TextField
              name="operatorName"
              label="Licensed operator"
              placeholder="e.g. D|R|P Holiday Homes"
              defaultValue={permit?.operator_name ?? ""}
            />
            <TextField
              name="operatorLicenceNumber"
              label="Operator licence number"
              defaultValue={permit?.operator_licence_number ?? ""}
            />
            <TextField
              name="nocReference"
              label="Building NOC reference"
              hint="The developer or owners association approval for holiday home use."
              defaultValue={permit?.noc_reference ?? ""}
            />
            <TextField name="nocExpiresOn" label="NOC expires on" type="date" defaultValue={permit?.noc_expires_on ?? ""} />
            <TextAreaField name="notes" label="Notes" rows={2} defaultValue={permit?.notes ?? ""} />
          </div>

          <DialogFooter className="gap-2 sm:justify-between">
            {permit ? (
              <Button type="button" variant="ghost" onClick={remove} disabled={removing}>
                <Trash2 className="size-4" />
                {removing ? "Removing…" : "Remove"}
              </Button>
            ) : (
              <span />
            )}
            <Submit />
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
