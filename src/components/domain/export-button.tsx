"use client";

import * as React from "react";
import { Download } from "lucide-react";
import { Button } from "@/components/ui/button";

type Row = Record<string, string | number | null | undefined>;

/**
 * CSV export for any table on screen.
 *
 * Owners and accountants ask for this constantly, so it is a shared control
 * rather than a per-page feature. Excel opens CSV natively; the BOM keeps
 * Arabic names and the AED sign intact when it does.
 */
export function ExportButton({
  rows,
  filename,
  label = "Export CSV",
}: {
  rows: Row[];
  filename: string;
  label?: string;
}) {
  const [busy, setBusy] = React.useState(false);

  const download = () => {
    if (rows.length === 0) return;
    setBusy(true);

    try {
      const headers = Object.keys(rows[0]);
      const escape = (value: string | number | null | undefined) => {
        const text = value === null || value === undefined ? "" : String(value);
        // Quote anything containing a delimiter, quote or newline; double up
        // embedded quotes, per RFC 4180.
        return /[",\n\r]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
      };

      const csv = [
        headers.join(","),
        ...rows.map((row) => headers.map((h) => escape(row[h])).join(",")),
      ].join("\r\n");

      const blob = new Blob([`﻿${csv}`], {
        type: "text/csv;charset=utf-8;",
      });
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = `${filename}-${new Date().toISOString().slice(0, 10)}.csv`;
      link.click();
      URL.revokeObjectURL(url);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Button
      type="button"
      variant="outline"
      onClick={download}
      disabled={busy || rows.length === 0}
    >
      <Download className="size-4" />
      {label}
    </Button>
  );
}
