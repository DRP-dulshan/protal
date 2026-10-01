"use client";

import * as React from "react";
import { useFormStatus } from "react-dom";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { cn } from "@/lib/utils";

/**
 * Small form vocabulary shared by every create/edit screen, so a new form is a
 * list of fields rather than a page of markup.
 */

export function FormSection({
  title,
  description,
  children,
  columns = 2,
}: {
  title: string;
  description?: string;
  children: React.ReactNode;
  columns?: 1 | 2 | 3;
}) {
  const cols = { 1: "", 2: "sm:grid-cols-2", 3: "sm:grid-cols-2 lg:grid-cols-3" }[
    columns
  ];
  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-base">{title}</CardTitle>
        {description && (
          <p className="text-sm text-[var(--muted-foreground)]">{description}</p>
        )}
      </CardHeader>
      <CardContent className={cn("grid gap-4", cols)}>{children}</CardContent>
    </Card>
  );
}

export function TextField({
  name,
  label,
  hint,
  className,
  wide,
  ...props
}: React.ComponentProps<typeof Input> & {
  name: string;
  label: string;
  hint?: React.ReactNode;
  wide?: boolean;
}) {
  return (
    <div className={cn("space-y-1.5", wide && "sm:col-span-2", className)}>
      <Label htmlFor={name}>
        {label}
        {props.required && <span className="ml-0.5 text-[var(--destructive)]">*</span>}
      </Label>
      <Input id={name} name={name} {...props} />
      {hint && <p className="text-xs text-[var(--muted-foreground)]">{hint}</p>}
    </div>
  );
}

export function SelectField({
  name,
  label,
  hint,
  options,
  placeholder,
  wide,
  ...props
}: React.ComponentProps<typeof Select> & {
  name: string;
  label: string;
  hint?: string;
  options: { value: string; label: string }[];
  placeholder?: string;
  wide?: boolean;
}) {
  return (
    <div className={cn("space-y-1.5", wide && "sm:col-span-2")}>
      <Label htmlFor={name}>
        {label}
        {props.required && <span className="ml-0.5 text-[var(--destructive)]">*</span>}
      </Label>
      <Select id={name} name={name} {...props}>
        {placeholder && <option value="">{placeholder}</option>}
        {options.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </Select>
      {hint && <p className="text-xs text-[var(--muted-foreground)]">{hint}</p>}
    </div>
  );
}

export function TextAreaField({
  name,
  label,
  hint,
  ...props
}: React.ComponentProps<typeof Textarea> & {
  name: string;
  label: string;
  hint?: string;
}) {
  return (
    <div className="space-y-1.5 sm:col-span-2">
      <Label htmlFor={name}>{label}</Label>
      <Textarea id={name} name={name} {...props} />
      {hint && <p className="text-xs text-[var(--muted-foreground)]">{hint}</p>}
    </div>
  );
}

export function SubmitBar({
  label,
  pendingLabel,
  cancelHref,
}: {
  label: string;
  pendingLabel?: string;
  cancelHref?: string;
}) {
  const { pending } = useFormStatus();
  return (
    <div className="flex items-center justify-end gap-2">
      {cancelHref && (
        <Button type="button" variant="ghost" asChild>
          <a href={cancelHref}>Cancel</a>
        </Button>
      )}
      <Button type="submit" disabled={pending}>
        {pending ? (pendingLabel ?? "Saving…") : label}
      </Button>
    </div>
  );
}

/** Inline error banner for a failed Server Action. */
export function FormError({ message }: { message?: string }) {
  if (!message) return null;
  return (
    <div
      role="alert"
      className="rounded-md border border-[var(--destructive)]/40 bg-[var(--destructive)]/10 p-3 text-sm"
    >
      {message}
    </div>
  );
}
