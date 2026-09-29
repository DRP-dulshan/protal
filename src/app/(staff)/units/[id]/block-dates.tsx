"use client";

import * as React from "react";
import { useActionState } from "react";
import { useFormStatus } from "react-dom";
import { CalendarX2, X } from "lucide-react";
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
import { FormError, SelectField, TextField } from "@/components/domain/form";
import { blockDates, removeBlock, type ActionState } from "../../bookings/actions";

const REASONS = [
  { value: "owner_stay", label: "Owner stay" },
  { value: "maintenance", label: "Maintenance" },
  { value: "blocked", label: "Blocked (other)" },
];

function Submit({ label, pending: pendingLabel }: { label: string; pending: string }) {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" disabled={pending}>
      {pending ? pendingLabel : label}
    </Button>
  );
}

export function BlockDatesDialog({ unitId }: { unitId: string }) {
  const [open, setOpen] = React.useState(false);
  const [state, action] = useActionState<ActionState, FormData>(blockDates, {});

  React.useEffect(() => {
    if (state.success) {
      toast.success(state.success);
      setOpen(false);
    }
  }, [state]);

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button size="sm" variant="outline">
          <CalendarX2 className="size-4" />
          Block dates
        </Button>
      </DialogTrigger>
      <DialogContent>
        <form action={action}>
          <DialogHeader>
            <DialogTitle>Block dates</DialogTitle>
            <DialogDescription>
              The unit cannot be booked for these nights. The end date is the first
              night that is free again, like a check-out date.
            </DialogDescription>
          </DialogHeader>
          <div className="my-4 grid gap-4 sm:grid-cols-2">
            <FormError message={state.error} />
            <input type="hidden" name="unitId" value={unitId} />
            <SelectField name="reason" label="Reason" required defaultValue="owner_stay" options={REASONS} />
            <div />
            <TextField name="startDate" label="From" type="date" required />
            <TextField name="endDate" label="Until" type="date" required />
            <TextField name="note" label="Note" wide placeholder="Owner family visit" />
          </div>
          <DialogFooter>
            <Submit label="Block dates" pending="Saving…" />
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

export function RemoveBlockButton({ blockId, unitId }: { blockId: string; unitId: string }) {
  // Awaited directly rather than through useActionState: removing the block
  // removes this row, and the toast must still fire after it has gone.
  const [pending, startTransition] = React.useTransition();

  const remove = () => {
    if (!confirm("Remove this block? The dates become bookable again.")) return;
    const formData = new FormData();
    formData.set("blockId", blockId);
    formData.set("unitId", unitId);
    startTransition(async () => {
      const result = await removeBlock({}, formData);
      if (result.error) toast.error(result.error);
      if (result.success) toast.success(result.success);
    });
  };

  return (
    <Button
      type="button"
      size="sm"
      variant="ghost"
      aria-label="Remove block"
      disabled={pending}
      onClick={remove}
    >
      <X className="size-4" />
    </Button>
  );
}
