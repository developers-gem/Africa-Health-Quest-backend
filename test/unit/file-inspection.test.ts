import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  pdfHasActiveContent,
  sniffType,
  stripJpegMetadata,
} from "../../src/modules/media/file-inspection.js";
import { LocalDiskStorage } from "../../src/modules/media/storage.js";
import { JPEG_WITH_EXIF, PNG_1X1 } from "../fixtures/media.js";

describe("file type sniffing", () => {
  it("recognises allowed types by content", () => {
    expect(sniffType(PNG_1X1)).toBe("image/png");
    expect(sniffType(JPEG_WITH_EXIF)).toBe("image/jpeg");
    expect(sniffType(Buffer.from("RIFF\0\0\0\0WEBPVP8 "))).toBe("image/webp");
    expect(sniffType(Buffer.from("%PDF-1.7\n"))).toBe("application/pdf");
  });
  it("rejects everything else, including SVG and HTML", () => {
    expect(
      sniffType(
        Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>'),
      ),
    ).toBeNull();
    expect(sniffType(Buffer.from("<!doctype html><html>"))).toBeNull();
    expect(sniffType(Buffer.alloc(0))).toBeNull();
  });
});

describe("JPEG metadata stripping", () => {
  it("removes EXIF/GPS and comments but keeps image data", () => {
    const out = stripJpegMetadata(JPEG_WITH_EXIF);
    expect(out.toString("latin1")).not.toContain("GPSLatitude");
    expect(out.toString("latin1")).not.toContain("camera comment");
    expect(out.toString("latin1")).toContain("JFIF");
    expect(out.subarray(-15)).toEqual(JPEG_WITH_EXIF.subarray(-15));
    expect(out.length).toBeLessThan(JPEG_WITH_EXIF.length);
  });
  it("leaves malformed input untouched", () => {
    const bad = Buffer.from([0xff, 0xd8, 0x00, 0x01]);
    expect(stripJpegMetadata(bad)).toBe(bad);
  });
});

describe("PDF active content", () => {
  it("flags scripts and launch actions", () => {
    expect(
      pdfHasActiveContent(
        Buffer.from("%PDF-1.7 /OpenAction << /S /JavaScript /JS (app.alert(1)) >>"),
      ),
    ).toBe(true);
    expect(pdfHasActiveContent(Buffer.from("%PDF-1.7 /Launch /F (cmd.exe)"))).toBe(true);
    expect(pdfHasActiveContent(Buffer.from("%PDF-1.7\n1 0 obj << /Type /Catalog >> endobj"))).toBe(
      false,
    );
  });
});

describe("local storage", () => {
  it("stores, reads and refuses path traversal", async () => {
    const s = new LocalDiskStorage(await mkdtemp(join(tmpdir(), "ahq-")));
    await s.put("country_flag/abc.png", PNG_1X1);
    expect(await s.get("country_flag/abc.png")).toEqual(PNG_1X1);
    expect(await s.get("country_flag/missing.png")).toBeNull();
    await expect(s.put("../../etc/passwd.txt", PNG_1X1)).rejects.toThrow();
    await expect(s.put("country_flag/abc.png", PNG_1X1)).rejects.toThrow(); // no overwrite
  });
});
