"use client";

import * as React from "react";
import { useActionState } from "react";
import { useFormStatus } from "react-dom";
import { Lock, MessageSquare } from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { addTicketNote, type NoteState } from "@/lib/tickets/actions";

export interface TicketNote {
  id: string;
  author: string;
  when: string;
  note: string | null;
  /** e.g. "Submitted → In progress" */
  change: string | null;
  internal: boolean;
}

function Submit() {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" size="sm" disabled={pending}>
      {pending ? "Adding…" : "Add note"}
    </Button>
  );
}

/**
 * The conversation on a ticket, oldest first, with a box to add to it. Staff
 * may tick "internal" for notes the owner must not see.
 */
export function TicketNotes({
  ticketId,
  notes,
  staff,
}: {
  ticketId: string;
  notes: TicketNote[];
  staff: boolean;
}) {
  const [state, action] = useActionState<NoteState, FormData>(addTicketNote.bind(null, ticketId), {});
  const formRef = React.useRef<HTMLFormElement>(null);

  React.useEffect(() => {
    if (state.error) toast.error(state.error);
    if (state.ok) formRef.current?.reset();
  }, [state]);

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center gap-2 text-base">
          <MessageSquare className="size-4" />
          Updates
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        {notes.length === 0 ? (
          <p className="text-sm text-[var(--muted-foreground)]">No updates yet.</p>
        ) : (
          <ol className="space-y-3">
            {notes.map((n) => (
              <li
                key={n.id}
                className={cn(
                  "rounded-lg border p-3 text-sm",
                  n.internal
                    ? "border-[var(--warning)]/40 bg-[var(--warning)]/10"
                    : "border-[var(--border)]"
                )}
              >
                <div className="mb-1 flex flex-wrap items-center gap-x-2 text-xs text-[var(--muted-foreground)]">
                  <span className="font-medium text-[var(--foreground)]">{n.author}</span>
                  <span>{n.when}</span>
                  {n.internal && (
                    <span className="inline-flex items-center gap-1">
                      <Lock className="size-3" />
                      Internal - not shown to the owner
                    </span>
                  )}
                </div>
                {n.change && <p className="font-medium">{n.change}</p>}
                {n.note && <p className="whitespace-pre-line">{n.note}</p>}
              </li>
            ))}
          </ol>
        )}

        <form ref={formRef} action={action} className="space-y-2 border-t border-[var(--border)] pt-4">
          <Textarea
            name="note"
            rows={3}
            maxLength={2000}
            required
            placeholder={staff ? "Add an update or reply" : "Add a message for D|R|P"}
          />
          <div className="flex flex-wrap items-center justify-between gap-2">
            {staff ? (
              <label className="flex items-center gap-2 text-sm">
                <input type="checkbox" name="internal" />
                Internal (hidden from the owner)
              </label>
            ) : (
              <span />
            )}
            <Submit />
          </div>
        </form>
      </CardContent>
    </Card>
  );
}
