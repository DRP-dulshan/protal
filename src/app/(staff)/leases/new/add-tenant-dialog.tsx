"use client";

import * as React from "react";
import { useActionState } from "react";
import { useFormStatus } from "react-dom";
import { UserPlus } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { FormError, TextField } from "@/components/domain/form";
import { createTenant, type TenantActionState } from "../actions";

type Tenant = NonNullable<TenantActionState["tenant"]>;

function Submit() {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" disabled={pending}>
      {pending ? "Saving…" : "Add tenant"}
    </Button>
  );
}

/**
 * Adds a tenant without leaving the tenancy form; the new tenant is handed
 * back so the form can select them straight away.
 */
export function AddTenantDialog({ onCreated }: { onCreated: (tenant: Tenant) => void }) {
  const [open, setOpen] = React.useState(false);
  const [isCompany, setIsCompany] = React.useState(false);
  const [state, action] = useActionState<TenantActionState, FormData>(createTenant, {});

  React.useEffect(() => {
    if (state.tenant) {
      onCreated(state.tenant);
      toast.success(state.success);
      setOpen(false);
      setIsCompany(false);
    }
    // Only a new result should fire this, not a new onCreated identity.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state]);

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button type="button" variant="outline" size="sm" className="self-end">
          <UserPlus className="size-4" />
          Add new tenant
        </Button>
      </DialogTrigger>
      <DialogContent className="max-h-[90dvh] overflow-y-auto">
        <form action={action}>
          <DialogHeader>
            <DialogTitle>Add a tenant</DialogTitle>
            <DialogDescription>
              The tenant is saved once and can be reused for renewals and other units.
            </DialogDescription>
          </DialogHeader>

          <div className="my-4 grid gap-4 sm:grid-cols-2">
            <FormError message={state.error} />

            <label className="flex items-center gap-2 text-sm sm:col-span-2">
              <input
                type="checkbox"
                name="isCompany"
                className="size-4"
                checked={isCompany}
                onChange={(e) => setIsCompany(e.target.checked)}
              />
              This tenant is a company
            </label>

            <TextField
              name="fullName"
              label={isCompany ? "Company name" : "Full name (as on Emirates ID)"}
              required
              wide
            />
            <TextField name="email" label="Email" type="email" />
            <TextField name="phone" label="Mobile" placeholder="050 123 4567" />
            <TextField
              name="whatsapp"
              label="WhatsApp"
              hint="Leave empty if it is the mobile number."
            />

            {isCompany ? (
              <TextField name="companyTradeLicence" label="Trade licence number" />
            ) : (
              <>
                <TextField name="nationality" label="Nationality" />
                <TextField name="emiratesId" label="Emirates ID" placeholder="784-XXXX-XXXXXXX-X" />
                <TextField name="emiratesIdExpiry" label="Emirates ID expiry" type="date" />
                <TextField name="passportNumber" label="Passport number" />
                <TextField name="employer" label="Employer" />
              </>
            )}
          </div>

          <DialogFooter>
            <Submit />
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
