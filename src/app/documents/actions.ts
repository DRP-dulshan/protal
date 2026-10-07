"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { storage, buildObjectPath, BUCKETS } from "@/lib/storage";
import { requireProfile } from "@/lib/auth/session";
import { can } from "@/lib/auth/rbac";

const MAX_BYTES = 25 * 1024 * 1024;

const ACCEPTED = new Set([
  "application/pdf",
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/heic",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
]);

const uploadSchema = z.object({
  entityKind: z.enum([
    "company", "property", "unit", "owner", "tenant", "guest", "lease",
    "booking", "vendor", "maintenance_request", "service_order", "vehicle",
    "management_agreement", "permit",
  ]),
  entityId: z.string().uuid().optional(),
  unitId: z.string().uuid().optional(),
  ownerId: z.string().uuid().optional(),
  kind: z.string().min(1),
  title: z.string().min(1, "Give the document a title").max(200),
  referenceNumber: z.string().max(100).optional(),
  issuedOn: z.string().optional(),
  expiresOn: z.string().optional(),
  isSensitive: z.boolean().default(false),
  isOwnerVisible: z.boolean().default(true),
  isTenantVisible: z.boolean().default(false),
});

export type UploadState = { error?: string; success?: string };

/**
 * Uploads a file to the vault and records it.
 *
 * The storage object and the `documents` row are written together: if the row
 * fails, the uploaded object is removed so the bucket never accumulates files
 * nothing points at.
 */
export async function uploadDocument(
  _prev: UploadState,
  formData: FormData
): Promise<UploadState> {
  const profile = await requireProfile();
  if (!can(profile.role, "documents.upload")) {
    return { error: "You do not have permission to upload documents." };
  }

  const file = formData.get("file");
  if (!(file instanceof File) || file.size === 0) {
    return { error: "Choose a file to upload." };
  }
  if (file.size > MAX_BYTES) {
    return { error: "That file is larger than the 25 MB limit." };
  }
  if (file.type && !ACCEPTED.has(file.type)) {
    return { error: `Files of type ${file.type} are not accepted.` };
  }

  const parsed = uploadSchema.safeParse({
    entityKind: formData.get("entityKind"),
    entityId: formData.get("entityId") || undefined,
    unitId: formData.get("unitId") || undefined,
    ownerId: formData.get("ownerId") || undefined,
    kind: formData.get("kind"),
    title: formData.get("title"),
    referenceNumber: formData.get("referenceNumber") || undefined,
    issuedOn: formData.get("issuedOn") || undefined,
    expiresOn: formData.get("expiresOn") || undefined,
    isSensitive: formData.get("isSensitive") === "on",
    // Checkboxes send "on" when ticked and nothing at all when not.
    isOwnerVisible: formData.get("isOwnerVisible") === "on",
    isTenantVisible: formData.get("isTenantVisible") === "on",
  });

  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Check the form and try again." };
  }
  const input = parsed.data;

  const path = buildObjectPath(input.entityKind, input.entityId ?? "general", file.name);
  let stored;
  try {
    stored = await storage.upload(BUCKETS.documents, path, file);
  } catch (error) {
    return {
      error: error instanceof Error ? error.message : "Upload failed.",
    };
  }

  const supabase = await createClient();
  const { error } = await supabase.from("documents").insert({
    kind: input.kind as never,
    entity_kind: input.entityKind,
    entity_id: input.entityId ?? null,
    unit_id: input.unitId ?? null,
    owner_id: input.ownerId ?? null,
    title: input.title,
    bucket: stored.bucket,
    storage_path: stored.path,
    file_name: stored.fileName,
    mime_type: stored.mimeType,
    size_bytes: stored.sizeBytes,
    reference_number: input.referenceNumber ?? null,
    issued_on: input.issuedOn || null,
    expires_on: input.expiresOn || null,
    is_sensitive: input.isSensitive,
    is_owner_visible: input.isOwnerVisible,
    is_tenant_visible: input.isTenantVisible,
    uploaded_by: profile.id,
  });

  if (error) {
    // Roll the object back so the bucket does not drift from the table.
    await storage.remove(stored.bucket, stored.path).catch(() => {});
    return { error: `Could not record the document: ${error.message}` };
  }

  revalidatePath("/documents");
  if (input.unitId) revalidatePath(`/units/${input.unitId}`);
  if (input.ownerId) revalidatePath(`/owners/${input.ownerId}`);

  return { success: `${input.title} uploaded.` };
}

/**
 * Issues a short-lived signed URL. The RLS policy on `documents` has already
 * decided whether this user may see the row; the signed URL simply lets the
 * browser fetch the bytes without making the bucket public.
 */
export async function getDocumentUrl(documentId: string): Promise<string | null> {
  await requireProfile();
  const supabase = await createClient();

  const { data: doc } = await supabase
    .from("documents")
    .select("bucket, storage_path")
    .eq("id", documentId)
    .maybeSingle();

  if (!doc) return null;
  return storage.signedUrl(doc.bucket, doc.storage_path, 300);
}

/**
 * Removes a document filed by mistake: its row and the file in the vault.
 * Super admins only, as the database allows (documents_delete, pms.is_admin).
 */
export async function deleteDocument(documentId: string): Promise<UploadState> {
  const profile = await requireProfile();
  if (profile.role !== "super_admin") return { error: "Only a super admin can delete a document." };
  if (!z.string().uuid().safeParse(documentId).success) return { error: "Document not found." };

  const supabase = await createClient();
  const { data: removed, error } = await supabase
    .from("documents")
    .delete()
    .eq("id", documentId)
    .select("bucket, storage_path, unit_id, owner_id");
  if (error) return { error: error.message };
  const doc = removed?.[0];
  if (!doc) return { error: "This document could not be deleted." };

  // The row is gone either way; a file left behind is only wasted space.
  await storage.remove(doc.bucket, doc.storage_path).catch(() => {});

  if (doc.unit_id) revalidatePath(`/units/${doc.unit_id}`);
  if (doc.owner_id) revalidatePath(`/owners/${doc.owner_id}`);
  revalidatePath("/leases", "layout");
  revalidatePath("/portal/owner/documents");
  return { success: "Document deleted." };
}
