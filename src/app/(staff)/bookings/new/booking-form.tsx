"use client";

import * as React from "react";
import { useActionState } from "react";
import { toast } from "sonner";
import {
  FormSection,
  TextField,
  SelectField,
  TextAreaField,
  SubmitBar,
  FormError,
} from "@/components/domain/form";
import { Callout } from "@/components/domain/shared";
import { createBooking, type ActionState } from "../actions";
import { SALES_CHANNEL, optionsFrom } from "@/lib/labels";
import { quoteStay, stayDiscountPct } from "@/lib/pricing";
import { formatAED } from "@/lib/money";

export type BookableUnit = {
  id: string;
  label: string;
  nightlyRate: number | null;
  weekendRate: number | null;
  cleaningFee: number | null;
  weeklyDiscountPct: number | null;
  monthlyDiscountPct: number | null;
  hasValidPermit: boolean;
};

const STATUSES = [
  { value: "confirmed", label: "Confirmed" },
  { value: "tentative", label: "Tentative (holds the dates)" },
  { value: "inquiry", label: "Enquiry (does not hold the dates)" },
];

const num = (v: string) => Number(v) || 0;

export function BookingForm({
  units,
  guests,
  defaultUnitId,
  defaultCheckIn,
  defaultCheckOut,
  defaultNotes,
  cancelHref = "/bookings",
}: {
  units: BookableUnit[];
  guests: { id: string; full_name: string }[];
  defaultUnitId?: string;
  defaultCheckIn?: string;
  defaultCheckOut?: string;
  /** Internal notes to start from, such as the note on an Airbnb block. */
  defaultNotes?: string;
  cancelHref?: string;
}) {
  const [state, action] = useActionState<ActionState, FormData>(createBooking, {});
  const [unitId, setUnitId] = React.useState(defaultUnitId ?? "");
  const [channel, setChannel] = React.useState("direct");
  const [guestId, setGuestId] = React.useState("");
  const [checkIn, setCheckIn] = React.useState(defaultCheckIn ?? "");
  const [checkOut, setCheckOut] = React.useState(defaultCheckOut ?? "");
  const initial = units.find((u) => u.id === defaultUnitId);
  const [rate, setRate] = React.useState(initial?.nightlyRate ? String(initial.nightlyRate) : "");
  const [weekendRate, setWeekendRate] = React.useState(initial?.weekendRate ? String(initial.weekendRate) : "");
  // Follows the unit's weekly/monthly discount for the chosen dates until
  // staff type their own.
  const [discount, setDiscount] = React.useState<string | null>(null);
  const [cleaning, setCleaning] = React.useState(initial?.cleaningFee ? String(initial.cleaningFee) : "");
  const [extra, setExtra] = React.useState("");
  const [tourism, setTourism] = React.useState("");
  const [commission, setCommission] = React.useState("");

  React.useEffect(() => {
    if (state.error) toast.error(state.error);
  }, [state]);

  const unit = units.find((u) => u.id === unitId);
  const validDates = Boolean(checkIn && checkOut && checkOut > checkIn);
  const autoDiscount = validDates && unit
    ? stayDiscountPct(quoteStay(checkIn, checkOut, { nightly: 0 }).nights, {
        weeklyDiscountPct: unit.weeklyDiscountPct,
        monthlyDiscountPct: unit.monthlyDiscountPct,
      })
    : 0;
  const discountValue = discount ?? (autoDiscount ? String(autoDiscount) : "");
  const quote = validDates
    ? quoteStay(checkIn, checkOut, { nightly: num(rate), weekend: num(weekendRate) }, num(discountValue))
    : null;
  const nights = quote?.nights ?? 0;
  const accommodation = quote?.accommodation ?? 0;
  const gross = accommodation + num(cleaning) + num(extra) + num(tourism);
  const payout = gross - num(commission) - num(tourism);

  return (
    <form action={action} className="space-y-5">
      <FormError message={state.error} />

      <FormSection title="Stay">
        <SelectField
          name="unitId"
          label="Holiday home"
          required
          value={unitId}
          onChange={(e) => {
            setUnitId(e.target.value);
            const next = units.find((u) => u.id === e.target.value);
            setRate(next?.nightlyRate ? String(next.nightlyRate) : "");
            setWeekendRate(next?.weekendRate ? String(next.weekendRate) : "");
            setCleaning(next?.cleaningFee ? String(next.cleaningFee) : "");
            setDiscount(null);
          }}
          placeholder={units.length === 0 ? "No holiday home units yet" : "Select a unit"}
          options={units.map((u) => ({
            value: u.id,
            label: u.hasValidPermit ? u.label : `${u.label} (no valid DET permit)`,
          }))}
        />
        <SelectField name="status" label="Status" required defaultValue="confirmed" options={STATUSES} />
        <TextField
          name="checkIn"
          label="Check-in"
          type="date"
          required
          value={checkIn}
          onChange={(e) => setCheckIn(e.target.value)}
        />
        <TextField
          name="checkOut"
          label="Check-out"
          type="date"
          required
          min={checkIn || undefined}
          value={checkOut}
          onChange={(e) => setCheckOut(e.target.value)}
          hint={nights ? `${nights} night${nights === 1 ? "" : "s"}` : undefined}
        />
        <TextField name="adults" label="Adults" type="number" min="1" defaultValue="2" required />
        <div className="grid grid-cols-2 gap-4">
          <TextField name="children" label="Children" type="number" min="0" defaultValue="0" />
          <TextField name="infants" label="Infants" type="number" min="0" defaultValue="0" />
        </div>
      </FormSection>

      {unit && !unit.hasValidPermit && (
        <Callout tone="danger" title="This unit has no valid DET permit">
          A confirmed or tentative booking will be refused. Record the permit on the
          unit&apos;s DET permits tab first, or save this as an enquiry.
        </Callout>
      )}

      <FormSection title="Channel">
        <SelectField
          name="channel"
          label="Booked through"
          required
          value={channel}
          onChange={(e) => setChannel(e.target.value)}
          options={optionsFrom(SALES_CHANNEL)}
        />
        {channel !== "direct" && (
          <TextField
            name="externalBookingId"
            label={`${SALES_CHANNEL[channel as keyof typeof SALES_CHANNEL]} reference`}
            placeholder="HMABC12345"
          />
        )}
      </FormSection>

      <FormSection title="Guest">
        <SelectField
          name="guestId"
          label="Guest"
          value={guestId}
          onChange={(e) => setGuestId(e.target.value)}
          placeholder="New guest"
          options={guests.map((g) => ({ value: g.id, label: g.full_name }))}
          hint="Pick a returning guest, or leave as New guest and fill in the details."
        />
        <div />
        {!guestId && (
          <>
            <TextField name="guestName" label="Full name (as on passport)" required />
            <TextField name="guestPhone" label="Mobile / WhatsApp" placeholder="+44 7700 900123" />
            <TextField name="guestEmail" label="Email" type="email" />
            <TextField name="guestNationality" label="Nationality" />
            <TextField name="guestPassport" label="Passport number" />
          </>
        )}
      </FormSection>

      <FormSection
        title="Price (AED)"
        description="Prices are prefilled from the unit (Units → Edit). Tourism Dirham is collected for the government and not paid out."
        columns={3}
      >
        <TextField
          name="nightlyRate"
          label="Nightly rate"
          type="number"
          step="0.01"
          min="0"
          required
          value={rate}
          onChange={(e) => setRate(e.target.value)}
          hint="Sunday to Thursday nights"
        />
        <TextField
          name="weekendRate"
          label="Weekend rate"
          type="number"
          step="0.01"
          min="0"
          value={weekendRate}
          onChange={(e) => setWeekendRate(e.target.value)}
          placeholder="Same as nightly"
          hint="Friday and Saturday nights"
        />
        <TextField
          name="discountPct"
          label="Discount (%)"
          type="number"
          step="0.01"
          min="0"
          max="99"
          value={discountValue}
          onChange={(e) => setDiscount(e.target.value)}
          placeholder="0"
          hint={autoDiscount ? `The unit's ${nights >= 28 ? "monthly" : "weekly"} discount` : "Off the nights, not the fees"}
        />
        <TextField
          name="cleaningFee"
          label="Cleaning fee"
          type="number"
          step="0.01"
          min="0"
          value={cleaning}
          onChange={(e) => setCleaning(e.target.value)}
        />
        <TextField
          name="extraFees"
          label="Other fees"
          type="number"
          step="0.01"
          min="0"
          value={extra}
          onChange={(e) => setExtra(e.target.value)}
        />
        <TextField
          name="tourismDirham"
          label="Tourism Dirham"
          type="number"
          step="0.01"
          min="0"
          value={tourism}
          onChange={(e) => setTourism(e.target.value)}
          hint="Per bedroom, per night, at the rate for the unit's DET classification."
        />
        <TextField
          name="channelCommission"
          label="Channel commission"
          type="number"
          step="0.01"
          min="0"
          value={commission}
          onChange={(e) => setCommission(e.target.value)}
        />
        <TextField name="damageDeposit" label="Damage deposit" type="number" step="0.01" min="0" />

        <div className="rounded-lg bg-[var(--muted)] p-3 text-sm sm:col-span-3">
          {quote && quote.weekdayNights > 0 && (
            <div className="flex justify-between">
              <span>
                {quote.weekdayNights} weeknight{quote.weekdayNights === 1 ? "" : "s"} × {formatAED(num(rate))}
              </span>
              <span className="tabular">{formatAED(quote.weekdayNights * num(rate))}</span>
            </div>
          )}
          {quote && quote.weekendNights > 0 && (
            <div className="flex justify-between">
              <span>
                {quote.weekendNights} weekend night{quote.weekendNights === 1 ? "" : "s"} ×{" "}
                {formatAED(num(weekendRate) || num(rate))}
              </span>
              <span className="tabular">{formatAED(quote.weekendNights * (num(weekendRate) || num(rate)))}</span>
            </div>
          )}
          {quote && quote.discount > 0 && (
            <div className="flex justify-between text-[var(--success)]">
              <span>Discount ({quote.discountPct}%)</span>
              <span className="tabular">-{formatAED(quote.discount)}</span>
            </div>
          )}
          <div className="flex justify-between">
            <span>
              Accommodation ({nights} night{nights === 1 ? "" : "s"})
            </span>
            <span className="tabular">{formatAED(accommodation)}</span>
          </div>
          <div className="mt-1 flex justify-between font-semibold">
            <span>Guest pays</span>
            <span className="tabular">{formatAED(gross)}</span>
          </div>
          <div className="mt-1 flex justify-between text-[var(--muted-foreground)]">
            <span>Expected payout (after commission and Tourism Dirham)</span>
            <span className="tabular">{formatAED(payout)}</span>
          </div>
        </div>
      </FormSection>

      <FormSection title="Notes" columns={1}>
        <TextAreaField name="guestMessage" label="Message from the guest" rows={2} />
        <TextAreaField name="internalNotes" label="Internal notes" rows={2} defaultValue={defaultNotes} />
      </FormSection>

      <SubmitBar label="Create booking" cancelHref={cancelHref} />
    </form>
  );
}
