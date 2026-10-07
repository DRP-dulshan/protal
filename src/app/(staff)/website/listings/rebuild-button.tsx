"use client";

import * as React from "react";
import { RefreshCw } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { rebuildWebsiteNow } from "./actions";

/** Rebuilds the website from the published listings, without changing any. */
export function RebuildButton({ configured }: { configured: boolean }) {
  const [pending, start] = React.useTransition();
  return (
    <Button
      variant="outline"
      disabled={pending}
      title={configured ? "Rebuild the website from the listings" : "The website rebuild is not connected yet"}
      onClick={() =>
        start(async () => {
          const result = await rebuildWebsiteNow();
          if (result.error) toast.error(result.error);
          else toast.success(result.success ?? "The website is rebuilding.");
        })
      }
    >
      <RefreshCw className={pending ? "size-4 animate-spin" : "size-4"} />
      Update website
    </Button>
  );
}
