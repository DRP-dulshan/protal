"use client";

import * as React from "react";
import { Trash2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { deleteTicket } from "../actions";

export function DeleteTicketButton({ ticketId, ticketNumber }: { ticketId: string; ticketNumber: string }) {
  const [pending, start] = React.useTransition();
  return (
    <Button
      type="button"
      size="sm"
      variant="ghost"
      disabled={pending}
      onClick={() => {
        if (
          !confirm(
            `Delete ${ticketNumber}? The ticket and its updates are removed completely, for the owner too.\n\nFor a real job that is not going ahead, set the status to Cancelled instead to keep its history.`
          )
        ) {
          return;
        }
        start(async () => {
          const result = await deleteTicket(ticketId);
          if (result?.error) toast.error(result.error);
        });
      }}
    >
      <Trash2 className="size-4" />
      {pending ? "Deleting…" : "Delete"}
    </Button>
  );
}
