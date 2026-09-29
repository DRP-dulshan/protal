"use client";

import { useTransition } from "react";
import { RefreshCw } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { syncAllNow } from "../bookings/calendar-sync-actions";

export function SyncAllButton() {
  const [pending, start] = useTransition();
  return (
    <Button
      disabled={pending}
      onClick={() =>
        start(async () => {
          const result = await syncAllNow();
          if (result.success) toast.success(result.success);
          if (result.error) toast.error(result.error);
        })
      }
    >
      <RefreshCw className={pending ? "size-4 animate-spin" : "size-4"} />
      {pending ? "Syncing all…" : "Sync all now"}
    </Button>
  );
}
