import { describe, expect, it } from "vitest";
import { hashPassword, randomToken, sha256, verifyPassword } from "../../src/lib/crypto.js";

describe("password hashing", () => {
  it("verifies the right password and rejects others", async () => {
    const h = await hashPassword("correct horse 1");
    expect(await verifyPassword("correct horse 1", h)).toBe(true);
    expect(await verifyPassword("correct horse 2", h)).toBe(false);
  });
  it("salts every hash", async () => {
    expect(await hashPassword("same-pass-1")).not.toBe(await hashPassword("same-pass-1"));
  });
  it("rejects malformed stored hashes", async () => {
    expect(await verifyPassword("x", "md5$abc")).toBe(false);
    expect(await verifyPassword("x", "")).toBe(false);
  });
});

describe("tokens", () => {
  it("generates unique url-safe tokens", () => {
    const a = randomToken();
    expect(a).toMatch(/^[\w-]{43}$/);
    expect(randomToken()).not.toBe(a);
  });
  it("hashes deterministically", () => {
    expect(sha256("abc")).toBe("ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad");
  });
});

describe("field encryption", () => {
  const key = Buffer.alloc(32, 9).toString("base64");

  it("round-trips and uses a fresh IV each time", async () => {
    const { encryptField, decryptField } = await import("../../src/lib/crypto.js");
    const a = encryptField("JBSWY3DPEHPK3PXP", key);
    const b = encryptField("JBSWY3DPEHPK3PXP", key);
    expect(a).not.toBe(b);
    expect(decryptField(a, key)).toBe("JBSWY3DPEHPK3PXP");
  });

  it("detects tampering and wrong keys", async () => {
    const { encryptField, decryptField } = await import("../../src/lib/crypto.js");
    const enc = encryptField("secret", key);
    const parts = enc.split(".");
    parts[3] = Buffer.from("other").toString("base64url");
    expect(() => decryptField(parts.join("."), key)).toThrow();
    expect(() => decryptField(enc, Buffer.alloc(32, 1).toString("base64"))).toThrow();
  });
});
