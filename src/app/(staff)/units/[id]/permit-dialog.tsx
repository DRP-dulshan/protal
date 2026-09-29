"use client";

import * as React from "react";
import { useActionState } from "react";
import { useFormStatus } from "react-dom";
import { FilePlus2 } from "lucide-react";
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
import { FormError, TextAreaField, TextField } from "@/components/domain/form";
import { addPermit, type ActionState } from "../../bookings/actions";

function Submit() {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" disabled={pending}>
      {pending ? "Saving…" : "Save permit"}
    </Button>
  );
}

export function PermitDialog({ unitId, hasPermit }: { unitId: string; hasPermit: boolean }) {
  const [open, setOpen] = React.useState(false);
  const submit = React.useMemo(() => addPermit.bind(null, unitId), [unitId]);
  const [state, action] = useActionState<ActionState, FormData>(submit, {});

  React.useEffect(() => {
    if (state.success) {
      toast.success(state.success);
      setOpen(false);
    }
  }, [state]);

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button size="sm">
          <FilePlus2 className="size-4" />
          {hasPermit ? "Add renewal" : "Add permit"}
        </Button>
      </DialogTrigger>
      <DialogContent className="max-h-[90dvh] overflow-y-auto">
        <form action={action}>
          <DialogHeader>
            <DialogTitle>{hasPermit ? "Record a permit renewal" : "Record the DET permit"}</DialogTitle>
            <DialogDescription>
              As issued by Dubai&apos;s Department of Economy and Tourism. Bookings are
              accepted only while a permit covers the check-in date.
            </DialogDescription>
          </DialogHeader>

          <div className="my-4 grid gap-4 sm:grid-cols-2">
            <FormError message={state.error} />
            <TextField name="permitNumber" label="Permit number" required placeholder="HH-DXB-104582" />
            <TextField name="classification" label="Classification" placeholder="Standard / Deluxe" />
            <TextField name="issuedOn" label="Issued on" type="date" required />
            <TextField name="expiresOn" label="Expires on" type="date" required />
            <TextField name="operatorName" label="Licensed operator" placeholder="D|R|P Holiday Homes" />
            <TextField name="operatorLicenceNumber" label="Operator licence number" />
            <TextField
              name="nocReference"
              label="Building NOC reference"
              hint="The developer or owners association approval for holiday home use."
            />
            <TextField name="nocExpiresOn" label="NOC expires on" type="date" />
            <TextAreaField name="notes" label="Notes" rows={2} />
          </div>

          <DialogFooter>
            <Submit />
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
