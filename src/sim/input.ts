import type { Input } from "./world.ts";

export const SIM_VERSION = "0.8.0";
export const MAX_PACKED_INPUT = 0x7ffffff;

export function packInput(i: Input): number {
  return (
    (i.move + 1) |
    (i.aim << 11) |
    (+i.attack << 21) |
    (+i.dash << 22) |
    ((i.choice ?? 0) << 23) |
    (+!!i.cast << 25) |
    (+!!i.ultimate << 26)
  );
}

export function unpackInput(n: number): Input {
  if (
    !Number.isInteger(n) ||
    n < 0 ||
    n > MAX_PACKED_INPUT ||
    (n & 2047) > 1024
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
  };
}
