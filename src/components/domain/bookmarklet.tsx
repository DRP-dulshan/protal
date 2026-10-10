"use client";

import * as React from "react";
import { Bookmark, Copy } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";

/** The pieces of a "drag me to the bookmarks bar" button (the Airbnb ones). */

/** React refuses javascript: links in JSX, so the href is set on the element. */
export function BookmarkletLink({ code, label }: { code: string; label: string }) {
  const ref = React.useRef<HTMLAnchorElement>(null);
  React.useEffect(() => {
    ref.current?.setAttribute("href", code);
  }, [code]);
  return (
    <a
      ref={ref}
      onClick={(e) => e.preventDefault()}
      className="inline-flex cursor-grab items-center gap-2 rounded-md bg-[var(--primary)] px-3 py-2 font-medium text-[var(--primary-foreground)]"
      title="Drag me to the bookmarks bar"
    >
      <Bookmark className="size-4" />
      {label}
    </a>
  );
}

export function CopyCode({ code }: { code: string }) {
  return (
    <div className="space-y-2">
      <Button
        type="button"
        variant="outline"
        onClick={async () => {
          try {
            await navigator.clipboard.writeText(code);
            toast.success("Copied. Now add the bookmark as below.");
          } catch {
            toast.error("Could not copy. Click the code below, then press ⌘ + C.");
          }
        }}
      >
        <Copy className="size-4" />
        Copy the button&apos;s code
      </Button>
      <input
        readOnly
        value={code}
        onFocus={(e) => e.target.select()}
        aria-label="The button's code"
        className="block w-full rounded-md border border-[var(--border)] bg-[var(--muted)] px-2 py-1 font-mono text-xs"
      />
    </div>
  );
}
