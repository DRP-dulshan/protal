import { createClient } from "@/lib/supabase/server";
import { env } from "@/lib/env";

/**
 * Document/media storage behind a narrow interface.
 *
 * Everything in the app talks to this module, never to Supabase Storage
 * directly, so the vault can move to S3 (or anywhere else) by adding a driver
 * rather than by touching call sites.
 */
export interface StoredObject {
  bucket: string;
  path: string;
  fileName: string;
  mimeType: string | null;
  sizeBytes: number;
}

export interface StorageDriver {
  upload(bucket: string, path: string, file: File): Promise<StoredObject>;
  signedUrl(bucket: string, path: string, expiresInSeconds?: number): Promise<string | null>;
  remove(bucket: string, path: string): Promise<void>;
}

/**
 * Object keys are namespaced <entity>/<entity-id>/<timestamp>-<name>, which
 * keeps a unit's files together and lets the storage policies derive the unit
 * from the key itself.
 */
export function buildObjectPath(
  entity: string,
  entityId: string,
  fileName: string
): string {
  const safe = fileName
    .normalize("NFKD")
    .replace(/[^\w.\- ]+/g, "")
    .replace(/\s+/g, "-")
    .slice(-120);
  return `${entity}/${entityId}/${Date.now()}-${safe}`;
}

const supabaseDriver: StorageDriver = {
  async upload(bucket, path, file) {
    const supabase = await createClient();
    const { error } = await supabase.storage.from(bucket).upload(path, file, {
      cacheControl: "3600",
      upsert: false,
      contentType: file.type || undefined,
    });
    if (error) throw new Error(`Upload failed: ${error.message}`);

    return {
      bucket,
      path,
      fileName: file.name,
      mimeType: file.type || null,
      sizeBytes: file.size,
    };
  },

  async signedUrl(bucket, path, expiresInSeconds = 300) {
    const supabase = await createClient();
    const { data, error } = await supabase.storage
      .from(bucket)
      .createSignedUrl(path, expiresInSeconds);
    if (error) return null;
    return data?.signedUrl ?? null;
  },

  async remove(bucket, path) {
    const supabase = await createClient();
    const { error } = await supabase.storage.from(bucket).remove([path]);
    if (error) throw new Error(`Delete failed: ${error.message}`);
  },
};

/**
 * Placeholder for running the vault on S3 once D|R|P consolidates onto AWS.
 * The interface is already the one the app uses, so only this object changes.
 */
const s3Driver: StorageDriver = {
  async upload() {
    throw new Error("S3 storage driver not implemented yet");
  },
  async signedUrl() {
    throw new Error("S3 storage driver not implemented yet");
  },
  async remove() {
    throw new Error("S3 storage driver not implemented yet");
  },
};

export const storage: StorageDriver =
  env.storage.driver === "s3" ? s3Driver : supabaseDriver;

export const BUCKETS = {
  documents: env.storage.documentsBucket,
  media: env.storage.mediaBucket,
} as const;
