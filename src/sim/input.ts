import type { Input } from "./world.ts";

export const SIM_VERSION = "0.10.0";
/** A jump rides in the technique field: slots are 1..4, so 5 was free and the replay stays 30 bits. */
const JUMP_CODE = 5;
export const MAX_PACKED_INPUT = 0x3fffffff;

export function packInput(i: Input): number {
  return (
    (i.move + 1) |
    (i.aim << 11) |
    (+i.attack << 21) |
    (+i.dash << 22) |
    ((i.choice ?? 0) << 23) |
    (+!!i.cast << 25) |
    (+!!i.ultimate << 26) |
    ((i.jump ? JUMP_CODE : (i.technique ?? 0)) << 27)
  );
}

export function unpackInput(n: number): Input {
  if (
    !Number.isInteger(n) ||
    n < 0 ||
    n > MAX_PACKED_INPUT ||
    (n & 2047) > 1024 ||
    (n >>> 27) > JUMP_CODE
  )
    throw new Error("Invalid packed input");
  return {
    move: (n & 2047) - 1,
    aim: (n >>> 11) & 1023,
    attack: !!(n & (1 << 21)),
    dash: !!(n & (1 << 22)),
    choice: (n >>> 23) & 3,
    cast: !!(n & (1 << 25)),
    ultimate: !!(n & (1 << 26)),
    technique: n >>> 27 === JUMP_CODE ? 0 : (n >>> 27) & 7,
    // Absent unless set, so replays recorded before the jump decode exactly as they did.
    ...(n >>> 27 === JUMP_CODE ? { jump: true } : {}),
  };
}
