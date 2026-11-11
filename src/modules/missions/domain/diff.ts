/** Flattens nested content into path → value pairs (arrays indexed). */
export function flatten(value: unknown, prefix = "", out: Record<string, unknown> = {}) {
  if (Array.isArray(value)) {
    if (!value.length) out[prefix] = [];
    value.forEach((v, i) => flatten(v, `${prefix}[${i}]`, out));
  } else if (value && typeof value === "object" && !(value instanceof Date)) {
    for (const [k, v] of Object.entries(value)) flatten(v, prefix ? `${prefix}.${k}` : k, out);
  } else {
    out[prefix] = value ?? null;
  }
  return out;
}

/** Field-level differences between two content objects, sorted by path. */
export function diffContent(before: unknown, after: unknown) {
  const a = flatten(before);
  const b = flatten(after);
  const paths = [...new Set([...Object.keys(a), ...Object.keys(b)])].sort();
  return paths
    .filter((p) => JSON.stringify(a[p]) !== JSON.stringify(b[p]))
    .map((path) => ({ path, before: a[path] ?? null, after: b[path] ?? null }));
}
