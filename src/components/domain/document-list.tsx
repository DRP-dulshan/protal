"use client";

import * as React from "react";
import { FileText, Upload, ExternalLink, Lock } from "lucide-react";
import { toast } from "sonner";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { EmptyState } from "@/components/domain/shared";
import { ComplianceBadge } from "@/components/domain/status-badge";
import { DocumentUploader } from "./document-uploader";
import { getDocumentUrl } from "@/app/documents/actions";
import { formatDate, daysUntil, severityFor } from "@/lib/dates";
import { DOCUMENT_KIND } from "@/lib/labels";
import type { Tables, Enums } from "@/lib/db/database.types";

type Document = Tables<"documents">;

const formatSize = (bytes: number | null) => {
  if (!bytes) return "—";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
};

export function DocumentList({
  documents,
  entityKind,
  entityId,
  unitId,
  ownerId,
  canUpload,
  title = "Documents",
}: {
  documents: Document[];
  entityKind: Enums<"document_entity">;
  entityId?: string;
  unitId?: string;
  ownerId?: string;
  canUpload: boolean;
  title?: string;
}) {
  const [uploading, setUploading] = React.useState(false);
  const [opening, setOpening] = React.useState<string | null>(null);

  // The bucket is private, so a link is minted on demand and expires shortly
  // after. Nothing in the vault is ever reachable by guessing a URL.
  const open = async (id: string) => {
    setOpening(id);
    try {
      const url = await getDocumentUrl(id);
      if (url) {
        window.open(url, "_blank", "noopener,noreferrer");
      } else {
        toast.error("That document could not be opened.");
      }
    } finally {
      setOpening(null);
    }
  };

  return (
    <Card>
      <CardHeader className="flex-row items-center justify-between">
        <CardTitle className="text-base">{title}</CardTitle>
        {canUpload && (
          <Button size="sm" onClick={() => setUploading((v) => !v)}>
            <Upload className="size-4" />
            {uploading ? "Cancel" : "Upload"}
          </Button>
        )}
      </CardHeader>

      {uploading && (
        <CardContent className="pt-0">
          <DocumentUploader
            entityKind={entityKind}
            entityId={entityId}
            unitId={unitId}
            ownerId={ownerId}
            onDone={() => setUploading(false)}
          />
        </CardContent>
      )}

      <CardContent className="p-0">
        {documents.length === 0 ? (
          <div className="p-5">
            <EmptyState
              title="Nothing filed yet"
              description="Title deeds, Ejari certificates, DET permits, NOCs, insurance policies and ID copies live here."
              icon={<FileText className="size-8" />}
            />
          </div>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Document</TableHead>
                <TableHead className="hidden md:table-cell">Reference</TableHead>
                <TableHead className="hidden lg:table-cell">Issued</TableHead>
                <TableHead>Expiry</TableHead>
                <TableHead className="w-10" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {documents.map((doc) => {
                const days = doc.expires_on ? daysUntil(doc.expires_on) : null;
                return (
                  <TableRow key={doc.id}>
                    <TableCell>
                      <div className="flex items-center gap-2">
                        <span className="truncate font-medium">{doc.title}</span>
                        {doc.is_sensitive && (
                          <Lock
                            className="size-3.5 shrink-0 text-[var(--muted-foreground)]"
                            aria-label="Restricted access"
                          />
                        )}
                      </div>
                      <p className="text-xs text-[var(--muted-foreground)]">
                        <Badge variant="muted" className="mr-1.5">
                          {DOCUMENT_KIND[doc.kind]}
                        </Badge>
                        {formatSize(doc.size_bytes)}
                      </p>
                    </TableCell>
                    <TableCell className="hidden md:table-cell text-sm">
                      {doc.reference_number ?? "—"}
                    </TableCell>
                    <TableCell className="hidden lg:table-cell tabular text-sm">
                      {formatDate(doc.issued_on)}
                    </TableCell>
                    <TableCell>
                      {doc.expires_on ? (
                        <div className="flex flex-col items-start gap-1">
                          <span className="tabular text-sm">
                            {formatDate(doc.expires_on)}
                          </span>
                          <ComplianceBadge
                            severity={severityFor(days)}
                            daysRemaining={days}
                          />
                        </div>
                      ) : (
                        <span className="text-sm text-[var(--muted-foreground)]">
                          No expiry
                        </span>
                      )}
                    </TableCell>
                    <TableCell>
                      <Button
                        variant="ghost"
                        size="icon"
                        onClick={() => open(doc.id)}
                        disabled={opening === doc.id}
                        aria-label={`Open ${doc.title}`}
                      >
                        <ExternalLink className="size-4" />
                      </Button>
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        )}
      </CardContent>
    </Card>
  );
}
