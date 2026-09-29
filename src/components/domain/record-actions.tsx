"use client";

import * as React from "react";
import { useActionState } from "react";
import { useFormStatus } from "react-dom";
import { Archive, ArchiveRestore, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";

type ActionState = { error?: string; success?: string };
type Action = (prev: ActionState, formData: FormData) => Promise<ActionState>;

function ActionButton({
  label,
  pendingLabel,
  icon,
  destructive,
}: {
  label: string;
  pendingLabel: string;
  icon: React.ReactNode;
  destructive?: boolean;
}) {
  const { pending } = useFormStatus();
  return (
    <Button
      type="submit"
      size="sm"
      variant={destructive ? "destructive" : "outline"}
      disabled={pending}
    >
      {icon}
      {pending ? pendingLabel : label}
    </Button>
  );
}

function ActionForm({
  action,
  idName,
  id,
  confirmText,
  children,
}: {
  action: Action;
  idName: string;
  id: string;
  confirmText: string;
  children: React.ReactNode;
}) {
  const [state, formAction] = useActionState<ActionState, FormData>(action, {});

  React.useEffect(() => {
    if (state.error) toast.error(state.error);
    if (state.success) toast.success(state.success);
  }, [state]);

  return (
    <form
      action={formAction}
      onSubmit={(e) => {
        if (!confirm(confirmText)) e.preventDefault();
      }}
    >
      <input type="hidden" name={idName} value={id} />
      {children}
    </form>
  );
}

/**
 * Archive / restore / delete for one record. Archiving keeps all history and
 * can be undone; deleting is offered for records entered by mistake and the
 * server refuses it when anything depends on the record.
 */
export function RecordActions({
  noun,
  idName,
  id,
  isActive,
  archive,
  restore,
  remove,
}: {
  /** "unit", "property", "owner" - used in the confirmation prompts. */
  noun: string;
  idName: string;
  id: string;
  isActive: boolean;
  archive: Action;
  restore: Action;
  /** Omitted when the signed-in user may not delete. */
  remove?: Action;
}) {
  return (
    <div className="flex flex-wrap gap-2">
      {isActive ? (
        <ActionForm
          action={archive}
          idName={idName}
          id={id}
          confirmText={`Archive this ${noun}? It will be hidden from lists and reports. You can restore it later.`}
        >
          <ActionButton label="Archive" pendingLabel="Archiving…" icon={<Archive className="size-4" />} />
        </ActionForm>
      ) : (
        <ActionForm
          action={restore}
          idName={idName}
          id={id}
          confirmText={`Restore this ${noun}?`}
        >
          <ActionButton
            label="Restore"
            pendingLabel="Restoring…"
            icon={<ArchiveRestore className="size-4" />}
          />
        </ActionForm>
      )}
      {remove && (
        <ActionForm
          action={remove}
          idName={idName}
          id={id}
          confirmText={`Delete this ${noun} permanently? This cannot be undone. Only records with no history can be deleted.`}
        >
          <ActionButton
            label="Delete"
            pendingLabel="Deleting…"
            icon={<Trash2 className="size-4" />}
            destructive
          />
        </ActionForm>
      )}
    </div>
  );
}
