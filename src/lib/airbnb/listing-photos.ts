import { fullSizePhotoUrl } from "@/lib/airbnb/listing-page";
import { MAX_PHOTO_BYTES, PHOTO_EXTENSIONS } from "@/lib/website-photos";

export type DownloadedPhoto = { bytes: Uint8Array; type: string; name: string } | { error: string };

/** The image kinds the website takes, told by their first bytes. */
function sniff(b: Uint8Array): string | null {
  const ascii = (from: number, to: number) => String.fromCharCode(...b.subarray(from, to));
  if (b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return "image/jpeg";
  if (b[0] === 0x89 && ascii(1, 4) === "PNG") return "image/png";
  if (ascii(0, 4) === "RIFF" && ascii(8, 12) === "WEBP") return "image/webp";
  if (ascii(4, 8) === "ftyp" && /^avi[fs]$/.test(ascii(8, 12))) return "image/avif";
  return null;
}

/**
 * Downloads one listing photo from Airbnb's photo host for the portal to keep.
 * Only https addresses on muscache.com are fetched (never a redirect
 * elsewhere), at most 10 MB, and only real JPG, PNG, WebP or AVIF images.
 */
export async function downloadAirbnbPhoto(raw: string, fetchImpl: typeof fetch = fetch): Promise<DownloadedPhoto> {
  const url = fullSizePhotoUrl(raw);
  if (!url) return { error: "Not an Airbnb photo address." };

  let res: Response;
  try {
    res = await fetchImpl(url, {
      redirect: "manual",
      signal: AbortSignal.timeout(20_000),
      headers: { accept: "image/jpeg,image/png,image/webp,image/avif;q=0.9" },
    });
  } catch {
    return { error: "Airbnb did not answer." };
  }
  if (res.status !== 200 || !res.body) return { error: `Airbnb answered ${res.status}.` };

  const declared = (res.headers.get("content-type") ?? "").split(";")[0].trim().toLowerCase();
  if (!PHOTO_EXTENSIONS[declared]) return { error: `Not a photo (${declared || "no type"}).` };
  if (Number(res.headers.get("content-length") ?? 0) > MAX_PHOTO_BYTES) return { error: "Larger than 10 MB." };

  const chunks: Uint8Array[] = [];
  let size = 0;
  const reader = res.body.getReader();
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > MAX_PHOTO_BYTES) {
        await reader.cancel();
        return { error: "Larger than 10 MB." };
      }
      chunks.push(value);
    }
  } catch {
    return { error: "The download broke off." };
  }

  const bytes = new Uint8Array(size);
  let at = 0;
  for (const c of chunks) {
    bytes.set(c, at);
    at += c.byteLength;
  }
  const type = sniff(bytes);
  if (!type) return { error: "Not a photo." };
  const name = url.split("/").pop() || "airbnb-photo";
  return { bytes, type, name: `airbnb-${name}` };
}
