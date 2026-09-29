"use client";

import * as React from "react";
import { useActionState } from "react";
import { useFormStatus } from "react-dom";
import { Pencil } from "lucide-react";
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
import { formatAED } from "@/lib/money";
import { updateBookingPrice, type ActionState } from "../actions";

function Submit() {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" disabled={pending}>
      {pending ? "Saving…" : "Save price"}
    </Button>
  );
}

const num = (v: string) => Number(v) || 0;
const str = (v: number | null | undefined) => (v ? String(v) : "");

export function PriceDialog({
  bookingId,
  isAirbnb,
  needsGuest,
  current,
}: {
  bookingId: string;
  isAirbnb: boolean;
  /** No guest on file yet (a stay imported from the Airbnb calendar). */
  needsGuest: boolean;
  current: {
    accommodation: number;
    cleaning: number;
    extra: number;
    tourism: number;
    commission: number;
  };
}) {
  const [open, setOpen] = React.useState(false);
  const submit = React.useMemo(() => updateBookingPrice.bind(null, bookingId), [bookingId]);
  const [state, action] = useActionState<ActionState, FormData>(submit, {});
  const [v, setV] = React.useState({
    accommodation: str(current.accommodation),
    cleaning: str(current.cleaning),
    extra: str(current.extra),
    tourism: str(current.tourism),
    commission: str(current.commission),
  });

  React.useEffect(() => {
    if (state.success) {
      toast.success(state.success);
      setOpen(false);
    }
  }, [state]);

  const priced = current.accommodation > 0;
  const gross = num(v.accommodation) + num(v.cleaning) + num(v.extra) + num(v.tourism);
  const payout = gross - num(v.commission) - num(v.tourism);
  const field = (key: keyof typeof v) => ({
    value: v[key],
    onChange: (e: React.ChangeEvent<HTMLInputElement>) => setV({ ...v, [key]: e.target.value }),
  });

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button size="sm" variant={priced ? "outline" : "default"}>
          <Pencil className="size-4" />
          {priced ? "Edit price" : "Enter price"}
        </Button>
      </DialogTrigger>
      <DialogContent className="max-h-[90dvh] overflow-y-auto">
        <form action={action}>
          <DialogHeader>
            <DialogTitle>{priced ? "Edit price" : "Enter price"}</DialogTitle>
            <DialogDescription>
              {isAirbnb
                ? "From the reservation in Airbnb: accommodation is the gross earnings minus the cleaning fee, commission is Airbnb's host service fee, and Tourism Dirham is the occupancy tax. Owners never see these amounts."
                : "Owners never see these amounts."}
            </DialogDescription>
          </DialogHeader>

          <div className="my-4 grid gap-4 sm:grid-cols-2">
            <FormError message={state.error} />
            {needsGuest && (
              <TextField name="guestName" label="Guest name" wide placeholder="As on the reservation" />
            )}
            <TextField name="accommodation" label="Accommodation total (AED)" type="number" step="0.01" min="0" required {...field("accommodation")} />
            <TextField name="cleaningFee" label="Cleaning fee (AED)" type="number" step="0.01" min="0" {...field("cleaning")} />
            <TextField name="extraFees" label="Other fees (AED)" type="number" step="0.01" min="0" {...field("extra")} />
            <TextField name="tourismDirham" label="Tourism Dirham (AED)" type="number" step="0.01" min="0" {...field("tourism")} />
            <TextField
              name="channelCommission"
              label={isAirbnb ? "Airbnb service fee (AED)" : "Channel commission (AED)"}
              type="number"
              step="0.01"
              min="0"
              {...field("commission")}
            />
            <div className="rounded-lg bg-[var(--muted)] p-3 text-sm sm:col-span-2">
              <div className="flex justify-between font-semibold">
                <span>Guest pays</span>
                <span className="tabular">{formatAED(gross)}</span>
              </div>
              <div className="mt-1 flex justify-between text-[var(--muted-foreground)]">
                <span>Payout (after commission and Tourism Dirham)</span>
                <span className="tabular">{formatAED(payout)}</span>
              </div>
            </div>
          </div>

          <DialogFooter>
            <Submit />
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
