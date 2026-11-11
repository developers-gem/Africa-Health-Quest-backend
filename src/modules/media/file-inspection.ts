/** Content sniffing and sanitisation for uploads. Pure functions — unit tested. */

export const MEDIA_TYPES = {
  "image/png": { ext: "png", maxBytes: 2 * 1024 * 1024 },
  "image/jpeg": { ext: "jpg", maxBytes: 2 * 1024 * 1024 },
  "image/webp": { ext: "webp", maxBytes: 2 * 1024 * 1024 },
  "application/pdf": { ext: "pdf", maxBytes: 10 * 1024 * 1024 },
} as const;
export type MediaType = keyof typeof MEDIA_TYPES;

/** Detects the real file type from its leading bytes; null if not an allowed type. */
export function sniffType(buf: Buffer): MediaType | null {
  if (
    buf.length >= 8 &&
    buf.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))
  )
    return "image/png";
  if (buf.length >= 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return "image/jpeg";
  if (
    buf.length >= 12 &&
    buf.toString("ascii", 0, 4) === "RIFF" &&
    buf.toString("ascii", 8, 12) === "WEBP"
  )
    return "image/webp";
  if (buf.length >= 5 && buf.toString("ascii", 0, 5) === "%PDF-") return "application/pdf";
  return null;
}

/**
 * Removes JPEG metadata segments (APP1–APP15: EXIF incl. GPS location, XMP, ICC…) and comments,
 * keeping APP0 (JFIF) and all image data. Returns the input unchanged if the structure is unexpected.
 */
export function stripJpegMetadata(buf: Buffer): Buffer {
  if (buf[0] !== 0xff || buf[1] !== 0xd8) return buf;
  const parts: Buffer[] = [buf.subarray(0, 2)];
  let i = 2;
  while (i + 4 <= buf.length) {
    if (buf[i] !== 0xff) return buf;
    const marker = buf[i + 1]!;
    if (marker === 0xda) {
      parts.push(buf.subarray(i)); // start of scan: copy the rest verbatim
      return Buffer.concat(parts);
    }
    const len = buf.readUInt16BE(i + 2);
    if (len < 2 || i + 2 + len > buf.length) return buf;
    const isMetadata = (marker >= 0xe1 && marker <= 0xef) || marker === 0xfe;
    if (!isMetadata) parts.push(buf.subarray(i, i + 2 + len));
    i += 2 + len;
  }
  return buf;
}

/** Rejects PDFs with active content (JavaScript, launch actions, embedded files). */
export function pdfHasActiveContent(buf: Buffer): boolean {
  const text = buf.toString("latin1");
  return /\/(JavaScript|JS|Launch|EmbeddedFile|OpenAction|AA|RichMedia|XFA)\b/.test(text);
}
