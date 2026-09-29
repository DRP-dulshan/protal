"use client";

import * as React from "react";
import { useActionState } from "react";
import { useFormStatus } from "react-dom";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import type { Enums } from "@/lib/db/database.types";
import { changeBookingStatus, type ActionState } from "../actions";

type Transition = "confirm" | "check_in" | "check_out" | "cancel" | "no_show";

/** Buttons offered for each status; mirrors TRANSITIONS in ../actions. */
const OFFERED: Partial<Record<Enums<"booking_status">, Transition[]>> = {
  inquiry: ["confirm", "cancel"],
  tentative: ["confirm", "cancel"],
  confirmed: ["check_in", "no_show", "cancel"],
  checked_in: ["check_out"],
};

const LABEL: Record<Transition, string> = {
  confirm: "Confirm",
  check_in: "Check in",
  check_out: "Check out",
  cancel: "Cancel booking",
  no_show: "No-show",
};

function ActionButton({ transition }: { transition: Transition }) {
  const { pending } = useFormStatus();
  const quiet = transition === "cancel" || transition === "no_show";
  return (
    <Button
      type="submit"
      size="sm"
      variant={transition === "cancel" ? "destructive" : quiet ? "outline" : "default"}
      disabled={pending}
    >
      {LABEL[transition]}
    </Button>
  );
}

function TransitionForm({
  bookingId,
  transition,
  action,
}: {
  bookingId: string;
  transition: Transition;
  action: (formData: FormData) => void;
}) {
  const reasonRef = React.useRef<HTMLInputElement>(null);

  return (
    <form
      action={action}
      onSubmit={(e) => {
        if (transition === "cancel") {
          const reason = prompt("Cancel this booking? The dates become free again.\n\nReason (optional):");
          if (reason === null) return e.preventDefault();
          if (reasonRef.current) reasonRef.current.value = reason;
        } else if (transition === "no_show" && !confirm("Mark this guest as a no-show?")) {
          e.preventDefault();
        }
      }}
    >
      <input type="hidden" name="bookingId" value={bookingId} />
      <input type="hidden" name="transition" value={transition} />
      <input type="hidden" name="reason" ref={reasonRef} />
      <ActionButton transition={transition} />
    </form>
  );
}

export function BookingActions({
  bookingId,
  status,
}: {
  bookingId: string;
  status: Enums<"booking_status">;
}) {
  // One action state for the group: the button that was pressed disappears
  // once the status moves on, so its own state could never show the result.
  const [state, action] = useActionState<ActionState, FormData>(changeBookingStatus, {});

  React.useEffect(() => {
    if (state.error) toast.error(state.error);
    if (state.success) toast.success(state.success);
  }, [state]);

  const offered = OFFERED[status] ?? [];
  if (offered.length === 0) return null;
  return (
    <div className="flex flex-wrap gap-2">
      {offered.map((t) => (
        <TransitionForm key={t} bookingId={bookingId} transition={t} action={action} />
      ))}
    </div>
  );
}
