"use client";

import { Printer } from "lucide-react";
import { Button } from "@/components/ui/button";

/** Browser print, which doubles as save-to-PDF on every platform. */
export function PrintButton({ label = "Print / save PDF" }: { label?: string }) {
  return (
    <Button variant="outline" onClick={() => window.print()}>
      <Printer className="size-4" />
      {label}
    </Button>
  );
}
