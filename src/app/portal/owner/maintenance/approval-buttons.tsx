"use client";

import * as React from "react";
import { useActionState } from "react";
import { useFormStatus } from "react-dom";
import { Check, X } from "lucide-react";
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
import { decideMaintenance, type ActionState } from "./actions";

function Submit({
  children,
  variant,
}: {
  children: React.ReactNode;
  variant?: "default" | "destructive";
}) {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" variant={variant} disabled={pending}>
      {pending ? "Saving…" : children}
    </Button>
  );
}

export function ApprovalButtons({
  ticketId,
  quotedAmount,
}: {
  ticketId: string;
  quotedAmount: number;
}) {
  const [state, action] = useActionState<ActionState, FormData>(decideMaintenance, {});
  const [declineOpen, setDeclineOpen] = React.useState(false);

  React.useEffect(() => {
    if (state.success) {
      toast.success(state.success);
      setDeclineOpen(false);
    }
    if (state.error) toast.error(state.error);
  }, [state]);

  return (
    <div className="flex flex-wrap gap-2">
      <form action={action}>
        <input type="hidden" name="ticketId" value={ticketId} />
        <input type="hidden" name="decision" value="approve" />
        <input type="hidden" name="approvedAmount" value={quotedAmount} />
        <Submit>
          <Check className="size-4" />
          Approve this quote
        </Submit>
      </form>

      <Dialog open={declineOpen} onOpenChange={setDeclineOpen}>
        <DialogTrigger asChild>
          <Button variant="outline">
            <X className="size-4" />
            Decline
          </Button>
        </DialogTrigger>
        <DialogContent>
          <form action={action}>
            <input type="hidden" name="ticketId" value={ticketId} />
            <input type="hidden" name="decision" value="reject" />
            <DialogHeader>
              <DialogTitle>Decline this quote</DialogTitle>
              <DialogDescription>
                Your property manager will see the reason and can obtain an
                alternative quote.
              </DialogDescription>
            </DialogHeader>
            <div className="my-4 space-y-1.5">
              <Label htmlFor={`reason-${ticketId}`}>Reason</Label>
              <Input
                id={`reason-${ticketId}`}
                name="reason"
                placeholder="Too expensive, get another quote"
                required
              />
            </div>
            <DialogFooter>
              <Submit variant="destructive">Decline</Submit>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}
