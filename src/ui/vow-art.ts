import { techniqueId } from "../sim/techniques.ts";
import type { SkillId } from "../sim/skills.ts";

/** Card illustrations in /art/vows, most fitting first. */
export const VOW_ART = ["blade", "staff", "heart", "sentinel"] as const;
export type VowArt = (typeof VOW_ART)[number];

const FITTING: Partial<Record<SkillId, readonly VowArt[]>> = {
  ember: ["staff", "blade"],
  pyre: ["staff", "heart"],
  afterimage: ["staff", "sentinel"],
  ash: ["staff", "sentinel"],
  "nova-spell": ["staff", "heart"],
  "siphon-spell": ["heart", "staff"],
  blood: ["heart"],
  mercy: ["heart"],
  iron: ["sentinel", "heart"],
  reprisal: ["sentinel", "heart"],
  reach: ["blade", "sentinel"],
  verdict: ["blade", "sentinel"],
  coup: ["blade", "heart"],
  haste: ["sentinel", "blade"],
};

function fitting(id: SkillId): readonly VowArt[] {
  const technique = techniqueId(id);
  if (!technique) return FITTING[id] ?? [];
  if (technique.startsWith("staff-")) return ["staff", "blade"];
  // Later techniques of one weapon lean on different pictures.
  return (["blade", "sentinel", "staff", "heart"] as const).slice(Number(technique.slice(-1)) - 1);
}

/** One illustration per offer. No two cards on the same screen share a picture. */
export function vowArt(offers: readonly SkillId[]): VowArt[] {
  const used = new Set<VowArt>();
  return offers.map((id) => {
    const pick = [...fitting(id), ...VOW_ART].find((art) => !used.has(art)) ?? VOW_ART[0];
    used.add(pick);
    return pick;
  });
}

const warmed: HTMLImageElement[] = [];
/** Decode the small card pictures ahead of the first reward, so opening it costs no frame. */
export function warmVowArt() {
  if (warmed.length || typeof Image === "undefined") return;
  for (const art of VOW_ART) {
    const image = new Image();
    image.src = `/art/vows/${art}.jpg`;
    void image.decode?.().catch(() => {});
    warmed.push(image);
  }
}
