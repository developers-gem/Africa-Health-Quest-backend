import { supabase } from "@/integrations/supabase/client";
import type { Mission } from "@/lib/game-data";

export type Ref = { title: string; url: string };
export type Verification = { reviewer_name: string; reviewer_credentials: string; refs: Ref[]; created_at: string };

/** Fingerprint of mission content — an approval only counts while the content is unchanged. */
export function missionHash(m: Mission) {
  const s = JSON.stringify({ story: m.story, steps: m.steps });
  let h = 5381;
  for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) | 0;
  return (h >>> 0).toString(16);
}

export async function loadVerifications(missions: Mission[]) {
  const { data } = await supabase
    .from("mission_reviews")
    .select("mission_id, content_hash, reviewer_name, reviewer_credentials, refs, created_at")
    .eq("status", "approved")
    .order("created_at", { ascending: false });
  const out: Record<string, Verification> = {};
  for (const m of missions) {
    const r = data?.find((x) => x.mission_id === m.id && x.content_hash === missionHash(m));
    if (r) out[m.id] = { ...r, refs: (r.refs as Ref[]) ?? [] };
  }
  return out;
}
