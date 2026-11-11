import { describe, expect, it } from "vitest";
import {
  base32Decode,
  base32Encode,
  hotp,
  otpauthUri,
  totp,
  verifyTotp,
} from "../../src/lib/totp.js";

// RFC 6238 Appendix B (SHA-1): secret is ASCII "12345678901234567890"; 6-digit codes are the last 6 digits.
const RFC_SECRET = base32Encode(Buffer.from("12345678901234567890"));

describe("TOTP (RFC 6238)", () => {
  it.each([
    [59, "287082"],
    [1111111109, "081804"],
    [1234567890, "005924"],
    [2000000000, "279037"],
  ])("matches the RFC test vector at T=%i", (seconds, code) => {
    expect(totp(RFC_SECRET, seconds * 1000)).toBe(code);
  });

  it("round-trips base32", () => {
    const buf = Buffer.from([0, 1, 2, 250, 251, 252, 253, 254, 255]);
    expect(base32Decode(base32Encode(buf))).toEqual(buf);
    expect(RFC_SECRET).toBe("GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ");
  });

  it("accepts codes within ±1 step and rejects others", () => {
    const now = 1_700_000_000_000;
    const step = Math.floor(now / 30_000);
    expect(verifyTotp(RFC_SECRET, hotp(RFC_SECRET, step - 1), { nowMs: now })).toBe(step - 1);
    expect(verifyTotp(RFC_SECRET, hotp(RFC_SECRET, step + 1), { nowMs: now })).toBe(step + 1);
    expect(verifyTotp(RFC_SECRET, hotp(RFC_SECRET, step + 2), { nowMs: now })).toBeNull();
    expect(verifyTotp(RFC_SECRET, "12345", { nowMs: now })).toBeNull();
  });

  it("rejects replays of an already-used step", () => {
    const now = 1_700_000_000_000;
    const step = Math.floor(now / 30_000);
    const code = hotp(RFC_SECRET, step);
    expect(verifyTotp(RFC_SECRET, code, { nowMs: now, lastUsedStep: step })).toBeNull();
    expect(verifyTotp(RFC_SECRET, code, { nowMs: now, lastUsedStep: step - 1 })).toBe(step);
  });

  it("builds an otpauth URI for authenticator apps", () => {
    const uri = otpauthUri(RFC_SECRET, "ada@example.com");
    expect(uri).toMatch(/^otpauth:\/\/totp\/Africa%20Health%20Quest%3Aada%40example\.com\?/);
    expect(uri).toContain(`secret=${RFC_SECRET}`);
  });
});
