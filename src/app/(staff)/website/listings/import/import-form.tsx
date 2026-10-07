"use client";

import * as React from "react";
import { useActionState } from "react";
import Link from "next/link";
import { useFormStatus } from "react-dom";
import { Download } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Callout } from "@/components/domain/shared";
import { FormError } from "@/components/domain/form";
import { importWebsiteListings, type ImportState } from "../actions";

function Submit() {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" disabled={pending}>
      <Download className="size-4" />
      {pending ? "Importing…" : "Import listings"}
    </Button>
  );
}

export function ImportListingsForm({ defaultUrl }: { defaultUrl: string }) {
  const [state, action] = useActionState<ImportState, FormData>(importWebsiteListings, {});
  return (
    <div className="space-y-5">
      <FormError message={state.error} />
      {state.success && (
        <Callout tone="info" title="Import finished">
          {state.added ?? 0} added and on the website
          {state.updated ? `, ${state.updated} updated` : ""}
          {state.unchanged ? `, ${state.unchanged} already here and left as they are` : ""}
          {state.skipped ? `, ${state.skipped} left out (commercial units the website does not show, or unreadable)` : ""}.{" "}
          <Link href="/website/listings" className="underline underline-offset-2">
            Open the listings
          </Link>
        </Callout>
      )}
      <Card>
        <CardContent className="p-5">
          <form action={action} className="space-y-4 text-sm">
            <p className="text-[var(--muted-foreground)]">
              The website keeps its listings in <code>data/imported/listings.json</code>. Import it once; after that the
              portal is where listings are added and changed, and the website takes them from here when it is rebuilt.
              Importing again is safe: listings already here are matched by their web address and not added twice.
            </p>
            <div className="space-y-1.5">
              <Label htmlFor="url">Link to the file</Label>
              <Input id="url" name="url" defaultValue={defaultUrl} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="file">…or upload it</Label>
              <Input id="file" name="file" type="file" accept="application/json,.json" />
              <p className="text-xs text-[var(--muted-foreground)]">An uploaded file is used instead of the link.</p>
            </div>
            <label className="flex items-start gap-2">
              <input type="checkbox" name="update" className="mt-0.5 size-4" />
              <span>
                Also update listings already in the portal from the file
                <span className="block text-xs text-[var(--muted-foreground)]">
                  Off: changes made in the portal are kept.
                </span>
              </span>
            </label>
            <Submit />
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
