import type { SkillId } from "../sim/skills";

// Original line icons, kept in code so the interface needs no image downloads.
const paths: Record<SkillId, string> = {
  ember: '<path d="M12 3c1 5-4 6-4 10a4 4 0 0 0 8 0c0-2-1-3-1-3s5 3 4 7a7 7 0 0 1-14-1c0-5 6-7 7-13Z"/>',
  reach: '<path d="m4 20 5-5m-3-3 6 6m-2-6L18 4l3-1-1 4-8 8M3 7a15 15 0 0 1 14 14"/>',
  verdict: '<path d="M5 5v14M12 3v18M19 5v14m-2-6 2 3 2-3"/>',
  ash: '<path d="m3 8 6 4-6 4m7-11 10 7-10 7M3 3v1m0 16v1m18-18v1m0 16v1"/>',
  blood: '<path d="M12 3 6 12a7 7 0 1 0 12 0L12 3Zm-3 12c0 2 1 3 3 3"/>',
  iron: '<path d="m12 3 8 3v6c0 5-8 9-8 9s-8-4-8-9V6l8-3Zm0 4v10m-4-6h8"/>',
  haste: '<path d="m4 7 7 5-7 5m9-10 7 5-7 5M4 3h10M4 21h10"/>',
  reprisal: '<path d="m12 2 2 6 6-2-2 6 4 3-7 1-3 6-2-6-7 1 4-5-3-5 6 1 2-6Z"/>',
};
export const skillIcon = (id: SkillId) => `<svg class="skill-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${paths[id]}</svg>`;
