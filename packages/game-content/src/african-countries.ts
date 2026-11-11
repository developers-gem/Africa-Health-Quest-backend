/**
 * The 54 African Union member states recognised by the UN, with ISO 3166-1 alpha-2 codes and
 * African Union regions. Factual reference data only — no health content is attached here.
 */
export type AuRegion = "northern" | "western" | "central" | "eastern" | "southern";

export const AFRICAN_COUNTRIES: { code: string; name: string; region: AuRegion }[] = [
  { code: "DZ", name: "Algeria", region: "northern" },
  { code: "EG", name: "Egypt", region: "northern" },
  { code: "LY", name: "Libya", region: "northern" },
  { code: "MR", name: "Mauritania", region: "northern" },
  { code: "MA", name: "Morocco", region: "northern" },
  { code: "TN", name: "Tunisia", region: "northern" },
  { code: "BJ", name: "Benin", region: "western" },
  { code: "BF", name: "Burkina Faso", region: "western" },
  { code: "CV", name: "Cabo Verde", region: "western" },
  { code: "CI", name: "Côte d'Ivoire", region: "western" },
  { code: "GM", name: "Gambia", region: "western" },
  { code: "GH", name: "Ghana", region: "western" },
  { code: "GN", name: "Guinea", region: "western" },
  { code: "GW", name: "Guinea-Bissau", region: "western" },
  { code: "LR", name: "Liberia", region: "western" },
  { code: "ML", name: "Mali", region: "western" },
  { code: "NE", name: "Niger", region: "western" },
  { code: "NG", name: "Nigeria", region: "western" },
  { code: "SN", name: "Senegal", region: "western" },
  { code: "SL", name: "Sierra Leone", region: "western" },
  { code: "TG", name: "Togo", region: "western" },
  { code: "BI", name: "Burundi", region: "central" },
  { code: "CM", name: "Cameroon", region: "central" },
  { code: "CF", name: "Central African Republic", region: "central" },
  { code: "TD", name: "Chad", region: "central" },
  { code: "CG", name: "Congo", region: "central" },
  { code: "CD", name: "Democratic Republic of the Congo", region: "central" },
  { code: "GQ", name: "Equatorial Guinea", region: "central" },
  { code: "GA", name: "Gabon", region: "central" },
  { code: "ST", name: "São Tomé and Príncipe", region: "central" },
  { code: "KM", name: "Comoros", region: "eastern" },
  { code: "DJ", name: "Djibouti", region: "eastern" },
  { code: "ER", name: "Eritrea", region: "eastern" },
  { code: "ET", name: "Ethiopia", region: "eastern" },
  { code: "KE", name: "Kenya", region: "eastern" },
  { code: "MG", name: "Madagascar", region: "eastern" },
  { code: "MU", name: "Mauritius", region: "eastern" },
  { code: "RW", name: "Rwanda", region: "eastern" },
  { code: "SC", name: "Seychelles", region: "eastern" },
  { code: "SO", name: "Somalia", region: "eastern" },
  { code: "SS", name: "South Sudan", region: "eastern" },
  { code: "SD", name: "Sudan", region: "eastern" },
  { code: "TZ", name: "Tanzania", region: "eastern" },
  { code: "UG", name: "Uganda", region: "eastern" },
  { code: "AO", name: "Angola", region: "southern" },
  { code: "BW", name: "Botswana", region: "southern" },
  { code: "SZ", name: "Eswatini", region: "southern" },
  { code: "LS", name: "Lesotho", region: "southern" },
  { code: "MW", name: "Malawi", region: "southern" },
  { code: "MZ", name: "Mozambique", region: "southern" },
  { code: "NA", name: "Namibia", region: "southern" },
  { code: "ZA", name: "South Africa", region: "southern" },
  { code: "ZM", name: "Zambia", region: "southern" },
  { code: "ZW", name: "Zimbabwe", region: "southern" },
];

/** Regional-indicator flag emoji derived from the ISO code (e.g. "NG" → 🇳🇬). */
export function flagEmoji(code: string): string {
  return String.fromCodePoint(
    ...[...code.toUpperCase()].map((c) => 0x1f1e6 + c.charCodeAt(0) - 65),
  );
}
