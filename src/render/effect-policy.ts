/** Shared presentation budget. Warnings own the final transparent pass. */
export const FX_ORDER = { environment: 0, strike: 2, previous: 3, skill: 4, warning: 12, text: 20 } as const;
export const FX_ALPHA = { previous: .19, skill: .52, floor: .24 } as const;
