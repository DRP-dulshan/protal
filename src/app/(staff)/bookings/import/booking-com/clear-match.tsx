"use client";

import * as React from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { clearBookingListingMatch } from "../../booking-com-actions";

export function ClearBookingMatchButton({ unitId, listing }: { unitId: string; listing: string }) {
  const [pending, start] = React.useTransition();
  return (
    <Button
      type="button"
      size="sm"
      variant="ghost"
      disabled={pending}
      onClick={() => {
        if (!confirm(`Forget the match for "${listing}"? The next import will ask for its unit again.`)) return;
        start(async () => {
          const result = await clearBookingListingMatch(unitId);
          if (result.error) toast.error(result.error);
        });
      }}
    >
      {pending ? "Removing…" : "Remove"}
    </Button>
  );
}
