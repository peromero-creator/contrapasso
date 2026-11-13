import { SkillInputBuffer } from "./ui/skill-input";
import { loadoutWeapons } from "./ui/loadout";
import { SkillTree } from "./ui/skill-tree";
import { TECHNIQUES, techniqueId, weaponTechniques } from "./sim/techniques";
import {
  SPELLS, spellId, isSpell, availableSpell,
  CORES,
  CORE_IDS,
  coreId,
  spellCooldown,
  type CoreId,
  type AbilityId,
} from "./sim/abilities";
import { relicImage, paintRelics, RelicStage } from "./render/relics";
import {
  WEAPONS,
  WEAPON_IDS,
  weapon,
  weaponId,
  type WeaponId,
} from "./sim/weapons";
import { canPayNative, type MarketOperation, type MarketView } from "./shared/market";
import * as THREE from "three";
import { View, CIRCLES } from "./render/view";
import {
  createWorld,
  createDuelWorld,
  step,
  DT,
  JUMP_CD,
  FLOORS,
  type Input,
  type World,
} from "./sim/world";
import { dirIndex, DIRS } from "./sim/dirs";
import { packInput, unpackInput, SIM_VERSION } from "./sim/input";
import {
  buildPower,
  DUEL_TICKS,
  MAX_GEAR_LEVEL,
  upgradeCost,
  upgradeChance,
  type GearSlot,
} from "./sim/build";
import {
  SKILLS,
  SKILL_IDS,
  SKILL_BRANCHES,
  PREREQUISITES,
  canLearn,
  rank,
  type SkillId,
} from "./sim/skills";
import { Sound } from "./audio/sound";
import { api, ApiError } from "./api";
import type { Champion, RunChallenge, DuelOpponent } from "./shared/protocol";
import { bot } from "./dev/bot";
import { skillIcon } from "./ui/icons";

const $ = <T extends HTMLElement>(id: string) =>
  document.getElementById(id) as T;
const ROMAN = ["I", "II", "III", "IV", "V"];
const params = new URLSearchParams(location.search);
const automated = import.meta.env.DEV && params.get("autoplay") === "1";
const silent = params.get("silent") === "1" || automated;
const view = new View($<HTMLCanvasElement>("game"));
const sound = new Sound(silent);
let world: World = createWorld(1);
let mode: "menu" | "run" = "menu";
let ended = false,
  paused = false,
  busy = false,
  verifying = false;
let resultPending = false;
let champion: Champion | null = null;
let championRequest: Promise<void> | null = null;
let challenge: RunChallenge | null = null;
let previousRunId: string | undefined;
try {
  previousRunId = sessionStorage.getItem("contrapasso-run") ?? undefined;
} catch {
  /* Storage is optional. */
}
let replay: number[] = [];
let checkpointAt = 0;
let checkpointPromise: Promise<void> | null = null;
let activeDuel: RunChallenge | null = null;
let choiceQueued = 0;
let shownPowers = "";
let acc = 0,
  freeze = 0,
  slow = 0,
  last = performance.now();
const keys = new Set<string>();
let mouseX = window.innerWidth / 2,
  mouseY = window.innerHeight / 3;
let mouseDown = false,
  dashQueued = 0,
  jumpQueued = 0,
  attackQueued = 0;
const skillInput = new SkillInputBuffer();
let aim = Math.floor(DIRS * 0.75);
const tmp = new THREE.Vector3();

function notice(text: string) {
  $("notice").textContent = text;
  $("notice").classList.toggle("hidden", !text);
}
function clearInput() {
  keys.clear();
  mouseDown = false;
  dashQueued = jumpQueued = attackQueued = choiceQueued = 0;
  skillInput.clear();
}
function reflectSound() {
  const button = $<HTMLButtonElement>("sound-toggle");
  button.textContent = sound.muted ? "SOUND OFF · M" : "SOUND ON · M";
  button.setAttribute("aria-pressed", String(!sound.muted));
  button.setAttribute(
    "aria-label",
    sound.muted ? "Unmute sound (M)" : "Mute sound (M)",
  );
  button.disabled = silent;
  if (document.activeElement === button) button.blur();
}
function skillBadge(
  skills: import("./sim/skills").Skills,
  ids = SKILL_IDS.filter((id) => rank(skills, id) > 0),
): string {
  return `<details class="skills-badge"><summary>SKILLS <b>${ids.length}</b></summary><div class="skills-popover">${ids.length ? ids.map((id) => `<span>${skillIcon(id)}<strong>${SKILLS[id].name}</strong><small>RANK ${rank(skills, id) || 1}</small></span>`).join("") : "Earn Solo coin to unlock your first path."}</div></details>`;
}
function refreshChampion() {
  if (!champion) return;
  for (const el of document.querySelectorAll(".champion-coins"))
    el.textContent = String(champion.coins);
  $("champion-progress").textContent =
    `${champion.runs} DESCENTS · ${champion.victories} VICTORIES`;
  $("trained-powers").innerHTML = skillBadge(
    champion.build.skills,
    champion.skills,
  );
  $("daily-coin").textContent =
    `${champion.earnedToday} / ${champion.dailyCap} earned today`;
  const chain = champion.chain;
  $("chain-status").textContent = chain
    ? chain.pending
      ? "SAVING TO NEAR TESTNET…"
      : "NEAR TESTNET · CHAMPION SAVED"
    : "LOCAL PREVIEW · TESTNET NOT CONNECTED";
  const link = $<HTMLAnchorElement>("chain-link");
  link.classList.toggle("hidden", !chain);
  if (chain)
    link.href = `https://testnet.nearblocks.io/address/${chain.accountId}`;
  $("champion-gear").textContent =
    `${weapon(champion.build.weaponId).name} +${champion.build.weaponLevel} · Ash armor +${champion.build.armorLevel} · Deepest circle ${champion.bestFloor} / 5`;
  const duel = $<HTMLButtonElement>("mode-duel");
  duel.disabled = !chain || chain.pending;
  duel.classList.toggle("locked", duel.disabled);
  $("duel-card-action").textContent =
    chain && !chain.pending
      ? "OPEN DUEL LOBBY ↗"
      : chain
        ? "SAVING CHAMPION…"
        : "TESTNET CONNECTION REQUIRED";
}
async function loadChampion() {
  if (!championRequest)
    championRequest = api
      .profile()
      .then((profile) => {
        champion = profile;
        refreshChampion();
      })
      .finally(() => {
        championRequest = null;
      });
  return championRequest;
}

function readInput(): Input {
  let ix = 0,
    iz = 0;
  if (keys.has("KeyW") || keys.has("ArrowUp")) iz--;
  if (keys.has("KeyS") || keys.has("ArrowDown")) iz++;
  if (keys.has("KeyA") || keys.has("ArrowLeft")) ix--;
  if (keys.has("KeyD") || keys.has("ArrowRight")) ix++;
  const move = ix || iz ? dirIndex(ix, iz) : -1;
  if (view.groundPoint(mouseX, mouseY, tmp)) {
    const dx = tmp.x - world.player.x,
      dz = tmp.z - world.player.z;
    if (dx * dx + dz * dz > 0.04) aim = dirIndex(dx, dz);
  }
  const dash = dashQueued > 0;
  const attack = mouseDown || keys.has("KeyJ") || attackQueued > 0;
  if (dashQueued > 0)
    dashQueued =
      world.player.dashCd <= DT && world.player.dashT <= 0 ? 0 : dashQueued - 1;
  if (attackQueued > 0)
    attackQueued =
      !dash && world.player.attackCd <= DT && world.player.dashT <= 0
        ? 0
        : attackQueued - 1;
  const jump = jumpQueued > 0 && !dash;
  if (jumpQueued > 0)
    jumpQueued =
      world.player.jumpCd <= DT && world.player.jumpT <= 0 && world.player.castT <= 0 ? 0 : jumpQueued - 1;
  return { move, aim, attack, dash, ...skillInput.take(world.player, dash || jump), jump };
}
function choose(choice: number) {
  if (world.phase !== "reward" || paused || choiceQueued) return;
  choiceQueued = choice;
  for (const button of document.querySelectorAll<HTMLButtonElement>(
    ".power-choice",
  ))
    button.disabled = true;
}
window.addEventListener("keydown", (e) => {
  if (!e.repeat && e.code === "KeyM") {
    sound.toggle();
    reflectSound();
    return;
  }
  if (mode !== "run" || busy) return;
  if (
    !e.repeat &&
    e.code === "KeyN" &&
    !paused &&
    !verifying &&
    world.mode !== "duel"
  ) {
    void startRun();
    return;
  }
  if (ended) return;
  if (!e.repeat && e.code === "Escape") {
    setPaused(!paused);
    return;
  }
  if (paused) return;
  if (world.phase === "reward") {
    const choice = ["Digit1", "Digit2", "Digit3"].indexOf(e.code) + 1;
    if (!e.repeat && choice) choose(choice);
    return;
  }
  if (e.code === "Space" || e.code.startsWith("Arrow")) e.preventDefault();
  if (!e.repeat && ["ShiftLeft", "ShiftRight", "KeyK"].includes(e.code))
    dashQueued = 8;
  if (!e.repeat && ["Space", "KeyF", "KeyL"].includes(e.code)) jumpQueued = 8;
  if (!e.repeat && e.code === "KeyJ") attackQueued = 8;
  if (!e.repeat && /^Digit[1-4]$/.test(e.code)) skillInput.press(Number(e.code.slice(-1)));
  if (!e.repeat && e.code === "KeyQ") skillInput.press("cast");
  if (!e.repeat && e.code === "KeyR") skillInput.press("ultimate");
  keys.add(e.code);
});
window.addEventListener("keyup", (e) => keys.delete(e.code));
window.addEventListener("blur", () => setPaused(true));
document.addEventListener("visibilitychange", () => {
  if (document.hidden) setPaused(true);
});
window.addEventListener("mousemove", (e) => {
  mouseX = e.clientX;
  mouseY = e.clientY;
});
const canvas = $<HTMLCanvasElement>("game");
canvas.addEventListener("mousedown", (e) => {
  if (mode !== "run" || paused || ended || world.phase === "reward") return;
  sound.unlock();
  if (e.button === 0) {
    mouseDown = true;
    attackQueued = 8;
  }
  if (e.button === 2) dashQueued = 8;
});
window.addEventListener("mouseup", (e) => {
  if (e.button === 0) mouseDown = false;
});
canvas.addEventListener("contextmenu", (e) => e.preventDefault());
window.addEventListener("resize", () => view.resize());

const hpFill = $("hp-fill"),
  hpText = $("hp-text"),
  dashPip = $("dash-pip");
const banner = $("banner");
let bannerT = 0;
function showBanner(text: string, seconds = 2.2) {
  banner.textContent = text;
  banner.classList.add("show");
  bannerT = seconds;
}
function setPaused(value: boolean) {
  clearInput();
  if (mode !== "run" || ended || paused === value) return;
  paused = value;
  acc = freeze = slow = 0;
  if (world.phase === "reward")
    for (const button of document.querySelectorAll<HTMLButtonElement>(
      ".power-choice",
    ))
      button.disabled = false;
  sound.setPaused(value);
  $("hud").inert = value || world.phase === "reward";
  $("reward").inert = value;
  $("pause").classList.toggle("hidden", !value);
  if (value) $("resume").focus();
  else {
    sound.unlock();
    if (world.phase === "reward")
      document.querySelector<HTMLButtonElement>(".power-choice")?.focus();
    else if (document.activeElement instanceof HTMLElement)
      document.activeElement.blur();
  }
}
function showReward() {
  if (world.phase !== "reward" || !world.offers.length) return;
  clearInput();
  acc = freeze = slow = 0;
  $("hud").inert = true;
  $("reward-circle").textContent = `CIRCLE ${ROMAN[world.floor - 1]} CLEARED`;
  $("reward-sub").textContent =
    world.floor === FLOORS
      ? "One last vow. What you become will return for someone else."
      : "Take one power into the next circle. Choose carefully.";
  const cards = $("reward-cards");
  cards.innerHTML = world.offers
    .map(
      (id, i) =>
        `<button class="power-choice" data-choice="${i + 1}"><span class="power-key">0${i + 1}</span>${skillIcon(id)}<span class="power-rank">RANK ${rank(world.player.skills, id) + 1}</span><strong>${SKILLS[id].name}</strong><span class="power-description">${SKILLS[id].description}</span><span class="power-effect">${SKILLS[id].rank}</span><span class="power-take">TAKE THIS VOW <span>↗</span></span></button>`,
    )
    .join("");
  for (const button of cards.querySelectorAll<HTMLButtonElement>("button"))
    button.addEventListener("click", () =>
      choose(Number(button.dataset.choice)),
    );
  $("reward").classList.remove("hidden");
  document.querySelector<HTMLButtonElement>(".power-choice")?.focus();
}
function updateHud(dt: number) {
  const p = world.player;
  hpFill.style.width = `${(p.hp / p.maxHp) * 100}%`;
  $("hp-lag").style.width = hpFill.style.width;
  $("vital").classList.toggle("critical", p.hp > 0 && p.hp <= p.maxHp * 0.25);
  hpText.textContent = `${Math.ceil(p.hp)} / ${p.maxHp}`;
  dashPip.classList.toggle("ready", p.dashCd <= 0);
  $("dash-meter").style.width =
    `${Math.max(0, 1 - p.dashCd / (0.75 * (1 - 0.12 * rank(p.skills, "ash")))) * 100}%`;
  $("jump-pip").classList.toggle("ready", p.jumpCd <= 0 && p.jumpT <= 0);
  $("jump-label").textContent = p.plunge ? "PLUNGE" : p.jumpT > 0 ? "ATTACK ↓" : "JUMP";
  $("jump-meter").style.width = `${p.jumpT > 0 ? 0 : Math.max(0, 1 - p.jumpCd / JUMP_CD) * 100}%`;
  $("cast-label").textContent = !availableSpell(p.spell, p.skills)
    ? "LEARN A Q SPELL"
    : p.spellCd > 0
      ? `${SPELLS[p.spell].name} · ${p.spellCd.toFixed(1)}s`
      : SPELLS[p.spell].name;
  $("cast-meter").style.width =
    `${availableSpell(p.spell, p.skills) ? Math.max(0, 1 - p.spellCd / spellCooldown(p.skills)) * 100 : 0}%`;
  $("core-label").textContent = p.core
    ? `${CORES[p.core].name} · ${Math.floor(p.charge)}%`
    : "ATTUNE A CORE";
  $("core-meter").style.width = `${p.charge}%`;
  $("core-slot").classList.toggle("ready", p.charge >= 100);
  $("core-slot").classList.toggle("unlearned", !p.core);
  $("cast-slot").classList.toggle(
    "unlearned",
    !availableSpell(p.spell, p.skills),
  );
  $("cast-slot").classList.toggle(
    "ready",
    availableSpell(p.spell, p.skills) && p.spellCd <= 0,
  );
  for (const [i, id] of weaponTechniques(p.weaponId).entries()) {
    const el = $("technique-" + (i+1)), known = rank(p.skills,id)>0;
    el.querySelector('span')!.textContent = known ? p.techniqueCd[i]>0 ? `${TECHNIQUES[id].name} · ${p.techniqueCd[i].toFixed(1)}s` : TECHNIQUES[id].name : `LEARN ${TECHNIQUES[id].name.toUpperCase()}`;
    el.classList.toggle('ready',known && p.techniqueCd[i]<=0);
    // an unlearned slot is only a reminder; keep it off the arena during a run
    el.classList.toggle('unlearned', !known);
    (el.querySelector('b') as HTMLElement).style.width = `${known?Math.max(0,1-p.techniqueCd[i]/TECHNIQUES[id].cooldown)*100:0}%`;
  }
  $("combo-instruction").textContent =
    p.weaveT > 0
      ? "SOUL-WOVEN · +25%"
      : p.comboT > 0 && rank(p.skills, "coup")
        ? "LAST RITES · STRIKE NOW"
        : p.swingN % 3 === 2
          ? "NEXT · FINISHER"
          : "I → II → III";
  $("coin-n").textContent = String(p.coins);
  $("circle").textContent =
    `${ROMAN[world.floor - 1]} / ${CIRCLES[world.floor - 1].name}`;
  $("wave").textContent =
    world.phase === "reward"
      ? "TAKE A VOW"
      : world.phase === "cleared"
        ? "ENTER THE GATE"
        : `WAVE ${world.wave + 1} / ${world.wavesInFloor} · ${world.enemies.length} REMAIN`;
  if (world.mode === "duel") {
    $("circle").textContent = "DUEL / THE CHALLENGE";
    $("wave").textContent =
      `${Math.max(0, Math.ceil((DUEL_TICKS - world.tick) / 60))} SECONDS · 10 COIN AT STAKE`;
    $("coin-n").textContent = String(champion?.coins ?? 0);
    const opponent = world.enemies.find((e) => e.kind === "champion");
    $("duel-boss-fill").style.width =
      `${opponent ? Math.max(0, opponent.hp / opponent.maxHp) * 100 : 0}%`;
  }
  $("portal-hint").classList.toggle("hidden", world.phase !== "cleared");
  const seconds = Math.floor(world.tick / 60);
  $("run-time").textContent =
    `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;
  $("run-seed").textContent = `SEED ${world.seed}`;
  for (let i = 1; i <= 3; i++)
    $("combo-" + i).classList.toggle(
      "lit",
      p.swingN > 0 && i <= ((p.swingN - 1) % 3) + 1,
    );
  $("held-weapon").textContent =
    `${weapon(p.weaponId).name} +${p.weaponLevel} · ${weapon(p.weaponId).className}`;
  const powers = JSON.stringify(p.skills);
  if (powers !== shownPowers) {
    shownPowers = powers;
    $("powers").innerHTML = skillBadge(p.skills);
  }
  if (bannerT > 0) {
    bannerT -= dt;
    if (bannerT <= 0) banner.classList.remove("show");
  }
}
async function verifyRun(checkingPending = false) {
  if (!challenge || verifying) return;
  verifying = true;
  resultPending = false;
  if (!checkingPending) $("receipt-status").textContent = "Verifying your descent…";
  $("receipt-status").classList.remove("verified");
  $("retry-verification").classList.add("hidden");
  for (const id of ["again", "same-seed", "to-menu"])
    $<HTMLButtonElement>(id).disabled = true;
  try {
    await checkpointPromise;
    const response = await api.submit(challenge.id, replay);
    champion = response.champion;
    refreshChampion();
    $("receipt-status").textContent =
      response.receipt.result.awardedCoins < world.player.coins
        ? `${response.receipt.result.awardedCoins} coin saved · Daily limit reached`
        : `${response.receipt.result.awardedCoins} coin saved to your champion`;
    resultPending = !!champion.chain?.pending;
    $("receipt-status").classList.toggle("verified", !resultPending);
    if (world.mode === "duel")
      $("receipt-status").textContent =
        `${response.receipt.result.coinDelta > 0 ? "+" : ""}${response.receipt.result.coinDelta} coin · ${champion.duelWins} wins / ${champion.duelLosses} losses`;
    if (champion.chain)
      $("receipt-status").textContent += champion.chain.pending
        ? " · Testnet save pending"
        : " · Confirmed on NEAR testnet";
    if (resultPending) {
      $("retry-verification").textContent = "CHECK SAVE ↻";
      $("retry-verification").classList.remove("hidden");
    }
  } catch (e) {
    $("receipt-status").textContent = (e as Error).message;
    $("retry-verification").textContent = "RETRY VERIFICATION ↻";
    $("retry-verification").classList.remove("hidden");
  } finally {
    verifying = false;
    for (const id of ["again", "same-seed", "to-menu"])
      $<HTMLButtonElement>(id).disabled = false;
  }
}
function showEnd(won: boolean) {
  ended = true;
  clearInput();
  $("hud").inert = true;
  $("reward").classList.add("hidden");
  $("end-title").textContent = won ? "HELL REMEMBERS" : "NOT FORGIVEN";
  $("end-sub").textContent = won
    ? "Five circles behind you. Your champion carries every vow."
    : `${CIRCLES[world.floor - 1].name} keeps you. The next descent is yours.`;
  $("end-coins").textContent = `${world.player.coins}`;
  $("end-kills").textContent = `${world.player.kills}`;
  $("end-floor").textContent = `${world.floor} / 5`;
  const duel = world.mode === "duel";
  $("same-seed").classList.toggle("hidden", duel);
  $("again").textContent = duel ? "FIND ANOTHER RIVAL ↗" : "DESCEND AGAIN ↗";
  $("end-coins-label").textContent = duel ? "COIN AT STAKE" : "COIN EARNED";
  $("end-kills-label").textContent = duel ? "RIVAL DEFEATED" : "ENEMIES SLAIN";
  $("end-floor-label").textContent = duel ? "DUEL TIME" : "CIRCLES REACHED";
  if (duel) {
    $("end-title").textContent = won
      ? "PUNISHMENT RETURNED"
      : "THEIR HELL. YOUR DEFEAT.";
    $("end-sub").textContent = won
      ? "Their champion fell. The pool belongs to your vault."
      : "The defending champion keeps the pool. Return stronger.";
    $("end-coins").textContent = "10";
    $("end-floor").textContent = `${Math.ceil(world.tick / 60)}s`;
  }
  $("receipt-status").classList.remove("verified");
  $("end").classList.remove("hidden");
  $("to-menu").focus();
  void verifyRun();
}
async function startRun(retry?: string) {
  if (busy || verifying) return;
  busy = true;
  notice("");
  $<HTMLButtonElement>("mode-solo").disabled = true;
  try {
    if (!champion) await loadChampion();
    await view.prepare();
    const next = await api.begin(retry, challenge?.id ?? previousRunId);
    enterRun(next);
  } catch (e) {
    notice((e as Error).message);
  } finally {
    busy = false;
    $<HTMLButtonElement>("mode-solo").disabled = false;
  }
}
function enterRun(next: RunChallenge) {
  if (next.version !== SIM_VERSION)
    throw new Error("The game has updated. Reload to continue.");
  resultPending = false;
  challenge = next;
  view.useWeapon(
    next.equipment.weaponId ?? "starter",
    next.equipment.weaponLevel,
  );
  world =
    next.mode === "duel"
      ? createDuelWorld(next.seed, next.challengerBuild!, next.opponent!.build)
      : createWorld(next.seed, next.skills, next.equipment);
  replay = [...(next.resumeInputs ?? [])];
  for (const packed of replay) {
    step(world, unpackInput(packed));
    world.events.length = 0;
  }
  checkpointAt = world.tick;
  checkpointPromise = null;
  previousRunId = next.id;
  try {
    sessionStorage.setItem("contrapasso-run", next.id);
  } catch {
    /* Storage is optional. */
  }
  clearInput();
  aim = world.player.aim;
  resetCombatFeedback();
  shownPowers = "";
  acc = freeze = slow = 0;
  ended = paused = false;
  mode = "run";
  sound.setPaused(false);
  sound.unlock();
  for (const id of ["end", "pause", "reward", "forge", "duel-lobby", "preparation"])
    $(id).classList.add("hidden");
  $("landing").classList.add("up");
  $("landing").inert = true;
  $("modes").classList.add("gone");
  $("modes").inert = true;
  $("hud").classList.remove("hidden");
  $("hud").inert = false;
  if (document.activeElement instanceof HTMLElement)
    document.activeElement.blur();
  $("duel-boss").classList.toggle("hidden", next.mode !== "duel");
  $("duel-boss-name").textContent = next.opponent?.name ?? "RIVAL CHAMPION";
  $("pause-menu").textContent =
    next.mode === "duel" ? "FORFEIT · LOSE 10 COIN" : "BACK TO MODES";
  showBanner(
    next.mode === "duel"
      ? "THEY BECAME YOUR PUNISHMENT"
      : `CIRCLE I / ${CIRCLES[0].name}`,
  );
  notice("");
  if (world.phase === "won" || world.phase === "dead")
    showEnd(world.phase === "won");
}
function toMenu() {
  if (verifying) return;
  resultPending = false;
  clearInput();
  resetCombatFeedback();
  paused = false;
  mode = "menu";
  sound.setPaused(true);
  for (const id of ["pause", "end", "hud", "reward", "duel-lobby"])
    $(id).classList.add("hidden");
  $("modes").classList.remove("gone");
  $("modes").inert = false;
  refreshChampion();
  $("mode-solo").focus();
}
let lobbyOpponents: DuelOpponent[] = [];
function renderLobby() {
  if (!champion) return;
  $("duel-record").textContent =
    `${champion.duelWins} W / ${champion.duelLosses} L`;
  const defense = $<HTMLButtonElement>("defense-toggle");
  defense.textContent = champion.defending
    ? "DEFENSE ON · DISABLE"
    : "ENABLE DEFENSE";
  defense.setAttribute("aria-pressed", String(champion.defending));
  defense.disabled =
    busy ||
    !!champion.lockedBy ||
    (!champion.defending && (champion.coins < 10 || champion.runs === 0));
  $("duel-resume").classList.toggle("hidden", !activeDuel);
  $<HTMLButtonElement>("duel-resume").disabled = busy;
  $("duel-empty").classList.toggle("hidden", lobbyOpponents.length > 0);
  $("duel-empty").textContent =
    champion.lockedBy && !activeDuel
      ? "Your champion is defending an active challenge. Its vault is locked until the result."
      : "No matched defenders are available. Enable your defense or check again after another champion finishes a descent.";
  const grid = $("duel-opponents");
  grid.replaceChildren();
  for (const opponent of lobbyOpponents) {
    const button = document.createElement("button");
    button.className = "opponent-card";
    button.dataset.opponent = opponent.id;
    button.disabled = busy || !!champion.lockedBy || champion.coins < 10;
    button.innerHTML = `<span class="eyebrow">MATCHED POWER / ${buildPower(opponent.build)}</span><strong></strong><span>${opponent.wins} W / ${opponent.losses} L · Blade +${opponent.build.weaponLevel} / Armor +${opponent.build.armorLevel}</span><span class="opponent-powers">SKILLS · ${Object.keys(opponent.build.skills).length}</span>`;
    button.querySelector("strong")!.textContent = opponent.name;
    button.addEventListener("click", () => void startDuel(opponent.id));
    grid.appendChild(button);
  }
}
async function refreshLobby() {
  const lobby = await api.lobby();
  champion = lobby.champion;
  lobbyOpponents = lobby.opponents;
  activeDuel = lobby.active;
  refreshChampion();
  renderLobby();
}
async function openLobby() {
  if (busy || verifying) return;
  busy = true;
  notice("Finding matched champions…");
  try {
    await refreshLobby();
    $("modes").inert = true;
    $("duel-lobby").classList.remove("hidden");
    $("duel-close").focus();
    notice("");
  } catch (e) {
    notice((e as Error).message);
  } finally {
    busy = false;
    renderLobby();
  }
}
async function startDuel(opponentId: string) {
  if (busy || verifying) return;
  busy = true;
  renderLobby();
  notice("Preparing your Duel…");
  try {
    await view.prepare();
    const next = await api.duel(opponentId);
    champion = await api.profile();
    enterRun(next);
  } catch (e) {
    notice((e as Error).message);
  } finally {
    busy = false;
    renderLobby();
  }
}
$("mode-duel").addEventListener("click", () => void openLobby());
$("duel-close").addEventListener("click", () => {
  $("duel-lobby").classList.add("hidden");
  $("modes").inert = false;
  $("mode-duel").focus();
});
$("duel-refresh").addEventListener("click", () => void openLobby());
$("duel-resume").addEventListener("click", () => {
  if (activeDuel?.opponent) void startDuel(activeDuel.opponent.id);
});
$("defense-toggle").addEventListener("click", async () => {
  if (busy || !champion) return;
  busy = true;
  renderLobby();
  notice("Saving defense setting…");
  try {
    champion = await api.defense(!champion.defending);
    await refreshLobby();
    notice("");
  } catch (e) {
    notice((e as Error).message);
  } finally {
    busy = false;
    renderLobby();
  }
});
function checkpointDuel() {
  if (
    !challenge ||
    world.mode !== "duel" ||
    checkpointPromise ||
    world.tick - checkpointAt < 60
  )
    return;
  const snapshot = [...replay];
  checkpointPromise = api
    .progress(challenge.id, snapshot)
    .then((response) => {
      checkpointAt = response.ticks;
    })
    .catch(() => {})
    .finally(() => {
      checkpointPromise = null;
    });
}
const EXPLORER = "https://testnet.nearblocks.io";
const escapeHtml = (text: unknown) =>
  String(text).replace(
    /[&<>"']/g,
    (ch) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        ch
      ]!,
  );
const shortAccount = (id: string) =>
  id.length > 28 ? `${id.slice(0, 10)}…${id.slice(-8)}` : id;
const nearAmount = (yocto: string) => {
  const amount = BigInt(yocto),
    whole = amount / 10n ** 24n;
  const fraction = (amount % 10n ** 24n)
    .toString()
    .padStart(24, "0")
    .slice(0, 5)
    .replace(/0+$/, "");
  return `${whole}${fraction ? "." + fraction : ""}`;
};
let marketState: MarketView | null = null;
let renderedMarketOpen = false;
let exchangeOpen = false;
let saleInventory: import("./shared/protocol").NftToken[] = [];
function showMarketTab(exchange: boolean) {
  exchangeOpen = exchange;
  $("mint-panel").classList.toggle("hidden", exchange);
  $("exchange-panel").classList.toggle("hidden", !exchange);
  $("tab-mint").setAttribute("aria-pressed", String(!exchange));
  $("tab-exchange").setAttribute("aria-pressed", String(exchange));
  $("market-title").textContent = exchange
    ? "THE ASH EXCHANGE."
    : "THE RELIQUARY.";
  document.querySelector<HTMLElement>(".market-fine")!.textContent = exchange
    ? "Prices are in free test NEAR. A sale transfers the same weapon NFT and records its previous owner. Seller proceeds remain withdrawable to the seller’s account; 10% supports the game treasury."
    : "Mint a new weapon with 10 earned coin + 0.01 test NEAR. Keep it, upgrade it, or choose to list it on the player market. Every new mint needs its own coin reservation.";
}
function renderExchange() {
  if (!marketState || !champion) return;
  const state = marketState;
  const ready = champion.chain?.features?.includes("exchange"),
    owner = champion.chain?.accountId;
  const entries = marketState.listings ?? [];
  $("exchange-listings").innerHTML = !ready
    ? "<p>The marketplace opens after the testnet update.</p>"
    : entries.length
      ? entries
          .map((l) => {
            const spec = weapon(l.weaponId),
              mine = l.seller === owner;
            return `<article class="exchange-card">${relicImage(weaponId(l.weaponId), escapeHtml(spec.name))}<div><span class="eyebrow">${escapeHtml(spec.className)} · +${l.level}</span><h3>${escapeHtml(spec.name)}</h3><p>${l.kills} kills · ${l.pastOwners.length} previous owner${l.pastOwners.length === 1 ? "" : "s"}</p><dl><dt>Damage</dt><dd>${spec.damage + l.level * 2}</dd><dt>Range</dt><dd>${spec.reach} m</dd><dt>Seller</dt><dd>${escapeHtml(shortAccount(l.seller))}</dd></dl><p class="listing-price">${nearAmount(l.priceYocto)} <small>test NEAR</small></p><button class="btn ${mine ? "ghost" : ""}" data-sale="${escapeHtml(l.id)}" data-sale-action="${mine ? "cancel_sale" : "buy_gear"}" ${busy || pendingMarket || (!mine && !canPayNative(state, l.priceYocto)) ? "disabled" : ""}>${mine ? "CANCEL LISTING" : "BUY THIS NFT ↗"}</button></div></article>`;
          })
          .join("")
      : '<p class="exchange-empty">No relics are listed yet. Offer an unequipped weapon below.</p>';
  $("exchange-balance").innerHTML =
    `<div><span class="eyebrow">YOUR SALE PROCEEDS</span><b>${nearAmount(marketState.proceedsYocto ?? "0")} <small>test NEAR</small></b></div>${marketButton("withdraw_sales", marketState.proceedsPending ? "WITHDRAWAL PENDING" : "WITHDRAW PROCEEDS ↗", !ready || !!marketState.proceedsPending || BigInt(marketState.proceedsYocto ?? "0") === 0n)}<p>Available test NEAR: ${nearAmount(state.nativeBalanceYocto ?? "0")}. Gas reserve: ${nearAmount(state.nativeGasReserveYocto ?? "0")}.</p>`;
  if (!state.sponsored && state.fundingAvailable && champion.runs > 0)
    $("exchange-balance").insertAdjacentHTML(
      "beforeend",
      marketButton("fund_guest", "GET DEMO TEST NEAR ↗", !ready),
    );
  if (pendingMarket)
    $("exchange-balance").insertAdjacentHTML(
      "beforeend",
      '<button class="btn ghost" data-market-retry="1">CHECK PENDING ACTION ↻</button>',
    );
  const select = $<HTMLSelectElement>("sale-token"),
    selected = select.value;
  const available = saleInventory.filter(
    (t) =>
      t.extra.kind === "weapon" &&
      !t.extra.bound &&
      !t.extra.equippedTo &&
      !entries.some((l) => l.tokenId === t.tokenId),
  );
  select.innerHTML = available.length
    ? available
        .map(
          (t) =>
            `<option value="${escapeHtml(t.tokenId)}">${escapeHtml(t.title)} · +${Number(t.extra.level)} · ${Number(t.extra.kills)} kills</option>`,
        )
        .join("")
    : '<option value="">No unequipped tradable weapons</option>';
  if (available.some((t) => t.tokenId === selected)) select.value = selected;
  $<HTMLButtonElement>("sale-submit").disabled =
    !ready || !available.length || busy || !!pendingMarket;
}
let relicStage: RelicStage | null = null;
let selectedRelic: WeaponId = "cinder-requiem";
let pendingMarket: {
  championId: string;
  id: string;
  operation: MarketOperation;
  data: Record<string, unknown>;
} | null = null;
try {
  pendingMarket = JSON.parse(
    sessionStorage.getItem("contrapasso-market") ?? "null",
  );
} catch {
  /* Optional session storage. */
}
const marketButton = (op: MarketOperation, text: string, disabled = false) =>
  `<button class="btn" data-market="${op}" ${disabled || busy || !!pendingMarket ? "disabled" : ""}>${text}</button>`;
function renderMarket() {
  if (!marketState || !champion) return;
  renderExchange();
  const { round, reservation, prizeYocto } = marketState;
  const open = !!round && !round.drawn && round.endsAt > Date.now();
  renderedMarketOpen = open;
  const selected = weapon(
    reservation?.status === "reserved"
      ? (reservation.weaponId ?? selectedRelic)
      : selectedRelic,
  );
  $("relic-title").textContent = selected.name;
  $("relic-description").textContent =
    selected.description +
    " Starts at +0. Each upgrade adds 2 damage; level and kill history travel with the NFT.";
  const reserved = reservation?.status === "reserved";
  const choice = reserved
    ? (reservation.weaponId ?? selectedRelic)
    : selectedRelic;
  relicStage ??= new RelicStage(
    $<HTMLCanvasElement>("relic-stage"),
    $("relic-motion"),
  );
  void relicStage.select(choice);
  $("arsenal-choices").innerHTML = WEAPON_IDS.filter((id) => id !== "starter")
    .map(
      (id) =>
        `<button class="arsenal-choice ${id === (reserved ? (reservation?.weaponId ?? selectedRelic) : selectedRelic) ? "selected" : ""}" data-relic="${id}" ${reservation?.status === "reserved" || busy || pendingMarket ? "disabled" : ""}>${relicImage(id)}<span>${WEAPONS[id].className}</span><strong>${WEAPONS[id].name}</strong></button>`,
    )
    .join("");
  const metrics = (items: [string, string][]) =>
    `<div class="market-metrics">${items.map(([n, v]) => `<div><b ${n === "Closes in" ? 'id="market-countdown"' : ""}>${escapeHtml(v)}</b><span>${n}</span></div>`).join("")}</div>`;
  $("market-stats").innerHTML = metrics([
    ["Minted / edition", `${round?.minted ?? 0} / ${round?.cap ?? 12}`],
    ["Reserved", String(round?.reserved ?? 0)],
    [
      "Mint price",
      `${nearAmount(round?.priceYocto ?? "10000000000000000000000")} test NEAR`,
    ],
    ["Your coin", String(champion.coins)],
  ]);
  let actions = "";
  if (!round) actions = "The next edition has not opened yet.";
  else if (
    reservation?.status === "minted" &&
    !champion.chain?.features?.includes("repeat_mint")
  )
    actions = "Your relic is minted. Equip it from What You Own.";
  else if (reservation?.status === "reserved") {
    actions =
      marketButton(
        "mint",
        "MINT RESERVED WEAPON ↗",
        !open || !canPayNative(marketState, round.priceYocto),
      ) + marketButton("cancel_mint", "CANCEL · REFUND 10 COIN");
  } else if (open)
    actions = marketButton(
      "reserve_mint",
      reservation?.status === "minted"
        ? "MINT ANOTHER · RESERVE 10 COIN"
        : "RESERVE · 10 COIN",
      champion.runs < 1 ||
        champion.coins < 10 ||
        (["guillotine-hymn", "acheron-needle"].includes(selectedRelic) &&
          !champion.chain?.features?.includes("expanded_arsenal")) ||
        round.minted + round.reserved >= round.cap,
    );
  else actions = "This edition is closed. The next round will appear here.";
  if (
    open &&
    !marketState.sponsored &&
    round && !canPayNative(marketState, round.priceYocto)
  )
    actions += marketButton(
      "fund_guest",
      marketState.fundingAvailable
        ? "GET DEMO TEST NEAR"
        : "DEMO FUNDING IS FULL",
      !marketState.fundingAvailable || champion.runs < 1,
    );
  if (champion.runs < 1)
    actions +=
      "<p>Finish a Solo descent to earn mint access and demo funds.</p>";
  $("market-actions").innerHTML = actions;
  paintRelics($("market"));
  const remaining = round
    ? Math.max(0, Math.ceil((round.endsAt - Date.now()) / 1000))
    : 0;
  $("raffle-stats").innerHTML = metrics([
    [
      "Application treasury",
      `${nearAmount(marketState.treasuryYocto ?? "0")} test NEAR`,
    ],
    [
      "This edition's revenue",
      `${nearAmount(round?.poolYocto ?? "0")} test NEAR`,
    ],
    ["Edition", round?.id ?? "Awaiting edition"],
    [
      round?.drawn ? "Status" : "Closes in",
      round?.drawn
        ? "Closed"
        : `${Math.floor(remaining / 3600)}h ${Math.floor((remaining % 3600) / 60)}m`,
    ],
  ]);
  $("raffle-actions").innerHTML =
    round && !round.drawn && !open && round.revenueMode === "treasury"
      ? marketButton("draw_round", "CLOSE EDITION & REFUND UNPAID SPOTS ↗")
      : "";
  $("raffle-winners").textContent =
    "Funds stay in the application treasury under project-owner control. No tickets, automatic prize distribution or investment returns.";
  $("prize-vault").classList.toggle("hidden", BigInt(prizeYocto) === 0n);
  $("prize-vault").innerHTML =
    `<span class="eyebrow">YOUR CHAMPION’S PRIZE VAULT</span><h3>${nearAmount(prizeYocto)} TEST NEAR</h3><p>Withdraw to the current NFT owner. Taking the champion to your wallet takes this vault with it.</p>${marketButton("withdraw_prize", "WITHDRAW PRIZE ↗", BigInt(prizeYocto) === 0n)}`;
  if (pendingMarket)
    $("market-actions").insertAdjacentHTML(
      "beforeend",
      '<button class="btn ghost" data-market-retry="1">CHECK PENDING ACTION ↻</button>',
    );
}
async function doMarket(
  operation: MarketOperation,
  data: Record<string, unknown>,
  nft = false,
  outputId?: string,
) {
  if (busy || !champion) return;
  const out = $(outputId ?? (nft ? "nft-action-result" : "market-result"));
  if (pendingMarket && pendingMarket.championId !== champion.id)
    pendingMarket = null;
  if (!pendingMarket)
    pendingMarket = {
      championId: champion.id,
      id: crypto.randomUUID(),
      operation,
      data,
    };
  try {
    sessionStorage.setItem("contrapasso-market", JSON.stringify(pendingMarket));
  } catch {
    /* Durable server intent still retries. */
  }
  busy = true;
  renderMarket();
  out.textContent = "Confirming on NEAR testnet…";
  try {
    const response = await api.marketAction(
      pendingMarket.id,
      pendingMarket.operation,
      pendingMarket.data,
    );
    champion = response.champion;
    marketState = response.market;
    refreshChampion();
    if (response.intent.complete) {
      pendingMarket = null;
      try {
        sessionStorage.removeItem("contrapasso-market");
      } catch {
        /* Optional storage. */
      }
      out.innerHTML = response.intent.error
        ? escapeHtml(response.intent.error)
        : `Confirmed on testnet.${response.intent.transaction ? ` <a href="${EXPLORER}/txns/${encodeURIComponent(response.intent.transaction)}" target="_blank" rel="noopener noreferrer">View transaction ↗</a>` : ""}`;
      if (nft) await renderNft();
      else saleInventory = (await api.nft()).tokens;
    } else
      out.textContent =
        "Still confirming. Check the same pending action to continue; it will not charge twice.";
  } catch (e) {
    out.textContent = `${(e as Error).message} Check the pending action to retry safely.`;
  } finally {
    busy = false;
    renderMarket();
  }
}
async function openMarket(exchange = false) {
  try {
    notice("");
    await loadChampion();
    marketState = await api.market();
    saleInventory = (await api.nft()).tokens;
    showMarketTab(exchange);
    if (pendingMarket?.championId !== champion?.id) pendingMarket = null;
    renderMarket();
    $("modes").inert = true;
    $("market").classList.remove("hidden");
    $("market-close").focus();
  } catch (e) {
    notice((e as Error).message);
  }
}
$("tab-mint").addEventListener("click", () => showMarketTab(false));
$("tab-exchange").addEventListener("click", () => showMarketTab(true));
$("exchange-open").addEventListener("click", () => void openMarket(true));
$("sale-price").addEventListener("input", () => {
  const v = $<HTMLInputElement>("sale-price").value;
  if (!/^(0|1)(\.[0-9]{1,3})?$/.test(v)) return;
  const [whole, fraction = ""] = v.split(".");
  const amount = BigInt(whole) * 10n ** 24n + BigInt(fraction.padEnd(24, "0"));
  $("sale-net").textContent =
    `${nearAmount((amount - amount / 10n).toString())} test NEAR to you · ${nearAmount((amount / 10n).toString())} to the game treasury.`;
});
$("sale-form").addEventListener("submit", (e) => {
  e.preventDefault();
  const v = $<HTMLInputElement>("sale-price").value;
  if (!/^(0|1)(\.[0-9]{1,3})?$/.test(v)) return;
  const [whole, fraction = ""] = v.split(".");
  const amount = BigInt(whole) * 10n ** 24n + BigInt(fraction.padEnd(24, "0"));
  if (amount < 10n ** 21n || amount > 10n ** 24n) {
    $("market-result").textContent = "Choose 0.001 to 1 test NEAR.";
    return;
  }
  void doMarket("list_gear", {
    tokenId: $<HTMLSelectElement>("sale-token").value,
    priceYocto: amount.toString(),
  });
});
$("exchange-listings").addEventListener("click", (e) => {
  const button = (e.target as HTMLElement).closest<HTMLButtonElement>(
    "button[data-sale]",
  );
  if (!button || button.disabled) return;
  const l = marketState?.listings?.find((l) => l.id === button.dataset.sale);
  if (!l) return;
  void doMarket(button.dataset.saleAction as MarketOperation, {
    tokenId: l.tokenId,
    listingId: l.id,
    ...(button.dataset.saleAction === "buy_gear"
      ? { priceYocto: l.priceYocto }
      : {}),
  });
});
$("market-open").addEventListener("click", () => void openMarket());
$("market-close").addEventListener("click", () => {
  $("market").classList.add("hidden");
  $("modes").inert = false;
  $(exchangeOpen ? "exchange-open" : "market-open").focus();
});
$("market-refresh").addEventListener("click", async () => {
  if (busy) return;
  if (pendingMarket)
    return void doMarket(pendingMarket.operation, pendingMarket.data);
  try {
    marketState = await api.market();
    saleInventory = (await api.nft()).tokens;
    await loadChampion();
    renderMarket();
  } catch (e) {
    $("market-result").textContent = (e as Error).message;
  }
});
$("market").addEventListener("click", (e) => {
  const choice = (e.target as HTMLElement).closest<HTMLButtonElement>(
    "button[data-relic]",
  );
  if (choice && !choice.disabled) {
    selectedRelic = weaponId(choice.dataset.relic);
    renderMarket();
    return;
  }
  const button = (e.target as HTMLElement).closest<HTMLButtonElement>(
    "button[data-market],button[data-market-retry]",
  );
  if (!button || button.disabled) return;
  if (button.dataset.marketRetry && pendingMarket)
    return void doMarket(pendingMarket.operation, pendingMarket.data);
  const operation = button.dataset.market as MarketOperation;
  const data: Record<string, unknown> = { roundId: marketState?.round?.id };
  if (operation === "reserve_mint") data.weaponId = selectedRelic;
  void doMarket(operation, data);
});
$("nft-tokens").addEventListener("click", (e) => {
  const button = (e.target as HTMLElement).closest<HTMLButtonElement>(
    "button[data-equip]",
  );
  if (!button || button.disabled) return;
  void doMarket(
    button.dataset.equip as MarketOperation,
    { slot: button.dataset.slot, gearId: button.dataset.gear },
    true,
  );
});
setInterval(() => {
  if ($("market").classList.contains("hidden") || !marketState?.round) return;
  const round = marketState.round,
    remaining = Math.max(0, Math.ceil((round.endsAt - Date.now()) / 1000));
  const open = !round.drawn && remaining > 0;
  if (open !== renderedMarketOpen) renderMarket();
  const clock = document.getElementById("market-countdown");
  if (clock)
    clock.textContent = `${Math.floor(remaining / 3600)}h ${Math.floor((remaining % 3600) / 60)}m`;
}, 1000);
let claimArmed = false;
let claimSourceId: string | null = null;
$("claim-account").addEventListener("input", () => {
  claimArmed = false;
  $("claim-button").textContent = "CLAIM TO WALLET";
  $("claim-result").textContent = "";
});
async function renderNft() {
  const view = await api.nft();
  $("nft-intro").textContent = view.onChain
    ? "These are NFTs on NEAR testnet. The champion carries its gear, its coin vault and its record; whoever holds it holds all of that."
    : "Local preview: nothing is minted. With a testnet connection each of these is an NFT, and the champion carries its gear, vault and record with it.";
  $("nft-tokens").innerHTML = view.tokens
    .map((token) => {
      const x = token.extra as Record<string, unknown>;
      const isChampion = x.kind === "champion";
      const rows: [string, string][] = isChampion
        ? [
            ["Vault", `${x.coins ?? 0} coin`],
            ...(BigInt(String(x.prizeYocto ?? "0")) > 0n
              ? [
                  [
                    "Legacy prize",
                    `${nearAmount(String(x.prizeYocto))} test NEAR`,
                  ] as [string, string],
                ]
              : []),
            ["Solo", `${x.runs ?? 0} descents · ${x.victories ?? 0} victories`],
            ["Duel", `${x.duelWins ?? 0} won · ${x.duelLosses ?? 0} lost`],
            [
              "Soul core",
              coreId((x.build as { core?: unknown })?.core)
                ? CORES[coreId((x.build as { core?: unknown }).core)!].name
                : "Not attuned",
            ],
            [
              "Skills",
              `${Array.isArray(x.skills) ? x.skills.length : 0} unlocked`,
            ],
          ]
        : [
            ["Level", `+${x.level ?? 0}`],
            ["Kills", String(x.kills ?? 0)],
            [
              "Past owners",
              Array.isArray(x.pastOwners) && x.pastOwners.length
                ? String(x.pastOwners.length)
                : "none",
            ],
            ["Bound", x.bound ? "travels with its champion" : "free"],
          ];
      const identity = weaponId(
        String(x.weaponId ?? x.collection ?? "starter"),
      );
      if (!isChampion && x.kind === "weapon")
        rows.unshift(
          ["Class", weapon(identity).className],
          [
            "Damage",
            String(weapon(identity).damage + Number(x.level ?? 0) * 2),
          ],
          ["Reach", `${weapon(identity).reach} m`],
        );
      const slot = x.kind === "armor" ? "armor" : "weapon";
      const equipped = champion?.equipped?.[slot] === token.tokenId;
      const available = !x.bound || x.championId === champion?.id;
      const gearButton =
        !isChampion && view.features?.includes("market") && available
          ? `<button class="btn ghost" data-equip="${equipped ? "unequip_gear" : "equip_gear"}" data-slot="${slot}" data-gear="${escapeHtml(token.tokenId)}" ${champion?.chain?.pending || x.listing || (x.equippedTo && x.equippedTo !== champion?.id) ? "disabled" : ""}>${x.listing ? "LISTED · CANCEL IN MARKET" : equipped ? "UNEQUIP" : "EQUIP"}</button>`
          : "";
      return `<article class="nft-card"><span class="eyebrow">${isChampion ? "CHAMPION" : equipped ? "EQUIPPED GEAR" : "GEAR"}</span>${!isChampion && identity !== "starter" ? `${relicImage(identity, weapon(identity).name)}` : ""}<strong>${escapeHtml(token.title)}</strong><dl>${rows.map(([k, v]) => `<dt>${k}</dt><dd>${escapeHtml(v)}</dd>`).join("")}<dt>Token</dt><dd>${escapeHtml(shortAccount(token.tokenId))}</dd><dt>Owner</dt><dd>${view.onChain ? `<a href="${EXPLORER}/address/${encodeURIComponent(token.ownerId)}" target="_blank" rel="noopener noreferrer">${escapeHtml(shortAccount(token.ownerId))} ↗</a>` : escapeHtml(token.ownerId)}</dd></dl>${isChampion ? skillBadge({}, (Array.isArray(x.skills) ? x.skills : []) as SkillId[]) : ""}${gearButton}</article>`;
    })
    .join("");
  paintRelics($("nft-tokens"));
  if (view.onChain && view.contractId)
    $("nft-intro").insertAdjacentHTML(
      "beforeend",
      ` <a href="${EXPLORER}/address/${encodeURIComponent(view.contractId)}" target="_blank" rel="noopener noreferrer">Contract ↗</a>`,
    );
  $("claim-box").classList.toggle(
    "hidden",
    !view.onChain || !view.features?.includes("claim"),
  );
}
$("nft-open").addEventListener("click", async () => {
  try {
    await loadChampion();
    await renderNft();
    claimArmed = false;
    claimSourceId = champion?.id ?? null;
    $("claim-button").textContent = "CLAIM TO WALLET";
    $("claim-result").textContent = "";
    $("modes").inert = true;
    $("nft").classList.remove("hidden");
    $("nft-close").focus();
  } catch (e) {
    notice((e as Error).message);
  }
});
$("nft-close").addEventListener("click", () => {
  $("nft").classList.add("hidden");
  $("modes").inert = false;
  $("nft-open").focus();
});
$("claim-button").addEventListener("click", async () => {
  const receiver = $<HTMLInputElement>("claim-account")
    .value.trim()
    .toLowerCase();
  const out = $("claim-result");
  if (!receiver) {
    out.textContent = "Enter your NEAR testnet account first.";
    return;
  }
  if (!claimArmed) {
    claimArmed = true;
    $("claim-button").textContent = "CONFIRM CLAIM";
    out.textContent = `This sends the champion, its gear and its vault to ${receiver}. Press again to confirm.`;
    return;
  }
  if (busy) return;
  busy = true;
  out.textContent = "Sending to testnet…";
  try {
    if (!claimSourceId)
      throw new Error("Review the champion before transferring it.");
    const response = await api.claim(receiver, claimSourceId);
    champion = response.champion;
    refreshChampion();
    if (response.claimed.pending) {
      out.textContent =
        "Transfer pending on testnet. Your current champion is kept here until confirmation. Retry to check the same transfer.";
      return;
    }
    await renderNft();
    claimSourceId = champion.id;
    out.innerHTML = `Claimed. ${escapeHtml(response.claimed.tokenId)} now belongs to ${escapeHtml(response.claimed.receiver)}.${response.claimed.transaction ? ` <a href="${EXPLORER}/txns/${encodeURIComponent(response.claimed.transaction)}" target="_blank" rel="noopener noreferrer">Transaction ↗</a>` : ""} A new guest champion has started here.`;
  } catch (e) {
    out.textContent = (e as Error).message;
  } finally {
    busy = false;
    claimArmed = false;
    $("claim-button").textContent = "CLAIM TO WALLET";
  }
});
const gearName = (slot: GearSlot) =>
  slot === "weapon" ? weapon(champion?.build.weaponId).name : "Ash Armor";

const GEAR: Record<
  GearSlot,
  { name: string; effect: (level: number) => string }
> = {
  weapon: { name: "Cinder Blade", effect: (level) => `+${level * 2} damage` },
  armor: { name: "Ash Armor", effect: (level) => `+${level * 3} life` },
};
let pendingUpgrade: { id: string; championId: string; slot: GearSlot } | null = null;
try { pendingUpgrade = JSON.parse(sessionStorage.getItem("contrapasso-upgrade") ?? "null"); } catch { /* Optional storage. */ }
function saveUpgradeIntent() {
  try {
    if (pendingUpgrade) sessionStorage.setItem("contrapasso-upgrade", JSON.stringify(pendingUpgrade));
    else sessionStorage.removeItem("contrapasso-upgrade");
  } catch { /* The server still retains the action id. */ }
}
function renderGear() {
  if (!champion) return;
  const grid = $("gear-cards");
  grid.innerHTML = (["weapon", "armor"] as const)
    .map((slot) => {
      const level =
        champion!.build[slot === "weapon" ? "weaponLevel" : "armorLevel"];
      const max = level >= MAX_GEAR_LEVEL;
      const cost = upgradeCost(level);
      const odds = upgradeChance(level);
      const available =
        (!champion!.chain || champion!.chain.features?.includes("upgrade")) &&
        !!champion!.equipped?.[slot];
      const confirming = pendingUpgrade?.championId === champion!.id && pendingUpgrade.slot === slot;
      const otherPending = pendingUpgrade?.championId === champion!.id && !confirming;
      const blocked = busy || otherPending || (!confirming && (max || champion!.coins < cost || !available));
      return `<button class="training-card gear-card${max ? " learned" : ""}" data-slot="${slot}" ${blocked ? "disabled" : ""}><span class="gear-level">+${level}</span><strong>${gearName(slot)}</strong><span>${GEAR[slot].effect(level)}${max ? "" : ` → ${GEAR[slot].effect(level + 1)}`}</span><span>${max ? "Nothing left to temper." : odds === 100 ? "Always holds." : `${odds}% to hold. A failure burns only the coin.`}</span><b>${confirming ? "CONFIRM UPGRADE" : !available ? "NOT AVAILABLE" : max ? "AT ITS LIMIT" : `TEMPER · ${cost} COIN`}</b></button>`;
    })
    .join("");
  for (const button of grid.querySelectorAll<HTMLButtonElement>("button"))
    button.addEventListener("click", async () => {
      if (busy) return;
      busy = true;
      renderForge();
      notice("");
      try {
        const slot = button.dataset.slot as GearSlot;
        if (!pendingUpgrade || pendingUpgrade.championId !== champion!.id)
          pendingUpgrade = { id: crypto.randomUUID(), championId: champion!.id, slot };
        saveUpgradeIntent();
        const response = await api.upgrade(slot, pendingUpgrade.id);
        champion = response.champion;
        refreshChampion();
        if (champion.chain?.pending) {
          notice("Upgrade sent. Confirm it before tempering again.");
          return;
        }
        pendingUpgrade = null;
        saveUpgradeIntent();
        notice(response.upgrade.error ?? (
          response.upgrade.success
            ? `The ${gearName(slot)} holds. It is now +${response.upgrade.level}.`
            : `The coin burns. The ${gearName(slot)} stays +${response.upgrade.level}.`),
        );
      } catch (e) {
        // Validation refused the action before enqueueing it. Transport/relay uncertainty keeps the ID.
        if (e instanceof ApiError && e.status === 400) {
          pendingUpgrade = null;
          saveUpgradeIntent();
        }
        notice((e as Error).message);
      } finally {
        busy = false;
        renderForge();
      }
    });
}
let loadoutStage: RelicStage | null = null;
let loadoutOptions: ReturnType<typeof loadoutWeapons> = [];
let loadoutToken: string | null = null;
let forgeFromPreparation = false;
let preparingRun = false;
function selectedLoadout() { return loadoutOptions.find(t=>t.tokenId===loadoutToken); }
function renderPreparation() {
  if (!champion) return;
  const preparationBusy=busy||preparingRun;
  $<HTMLButtonElement>('preparation-close').disabled=preparationBusy;
  $<HTMLButtonElement>('loadout-train').disabled=preparationBusy;
  const selected = selectedLoadout(), identity=selected?.identity ?? champion.build.weaponId ?? 'starter', spec=weapon(identity);
  $('loadout-weapons').innerHTML = loadoutOptions.map(t=>`<button data-loadout="${escapeHtml(t.tokenId)}" aria-pressed="${t.tokenId===loadoutToken}" ${preparationBusy||t.blocked?'disabled':''}><strong>${weapon(t.identity).name} <em>+${t.level}</em></strong><small>${t.blocked?'Unavailable · listed or equipped elsewhere':t.tokenId===champion!.equipped?.weapon?'IN HAND':weapon(t.identity).className}</small></button>`).join('') || '<p>Your starting blade is ready.</p>';
  $('loadout-name').textContent=spec.name;
  $('loadout-description').textContent=spec.description;
  $('loadout-stats').innerHTML=`<span><b>${spec.damage+(selected?.level??champion.build.weaponLevel)*2}</b> damage</span><span><b>${spec.reach}m</b> reach</span><span><b>${selected?.kills??0}</b> kills</span>`;
  $('loadout-techniques').innerHTML=weaponTechniques(identity).map((id,i)=>`<button data-loadout-preview="${id}" title="Preview ${TECHNIQUES[id].name}"><kbd>${i+1}</kbd><span>${TECHNIQUES[id].name}<small>${champion!.skills.includes(id)?'LEARNED':'PREVIEW · LEARN IN SKILL TREE'}</small></span></button>`).join('');
  loadoutStage ??= new RelicStage($<HTMLCanvasElement>('loadout-stage'),$('loadout-preview-label'));
  void loadoutStage.select(identity); loadoutStage.preview(null);
  $<HTMLButtonElement>('loadout-start').disabled=preparationBusy||!!champion.chain?.pending||!!selected?.blocked;
  $('loadout-start').textContent=preparationBusy?'PREPARING…':pendingMarket?'CHECK PENDING ACTION ↻':'TAKE THE DESCENT ↘';
}
async function openPreparation() {
  if(busy||verifying)return;
  notice('');
  try {
    await loadChampion(); const inventory=await api.nft();
    loadoutOptions=loadoutWeapons(inventory.tokens,champion!.id);
    loadoutToken=champion!.equipped?.weapon ?? loadoutOptions.find(t=>!t.blocked)?.tokenId ?? null;
    $('modes').inert=true; $('preparation').classList.remove('hidden');
    $('loadout-status').textContent='Choose your weapon and preview its techniques. Locked skills must be learned before use.';
    renderPreparation(); $('preparation-close').focus();
  } catch(e){notice((e as Error).message);}
}
function closePreparation() {
  if(busy||preparingRun)return;
  $('preparation').classList.add('hidden'); $('modes').inert=false; $('mode-solo').focus();
}
$('preparation-close').onclick=closePreparation;
$('loadout-weapons').onclick=e=>{
  const button=(e.target as HTMLElement).closest<HTMLButtonElement>('[data-loadout]');
  if(!button||button.disabled||busy||preparingRun)return;
  loadoutToken=button.dataset.loadout!; renderPreparation();
};
$('loadout-techniques').onclick=e=>{
  const button=(e.target as HTMLElement).closest<HTMLButtonElement>('[data-loadout-preview]');
  if(button)loadoutStage?.preview(button.dataset.loadoutPreview as AbilityId);
};
$('loadout-start').onclick=async()=>{
  if(busy||preparingRun||!champion)return;
  const selected=selectedLoadout(); if(selected?.blocked)return;
  preparingRun=true;renderPreparation();
  try {
    if(pendingMarket || selected && selected.tokenId!==champion.equipped?.weapon) {
      await doMarket('equip_gear',{slot:'weapon',gearId:selected?.tokenId},false,'loadout-status');
      if(pendingMarket || champion.chain?.pending || selected && champion.equipped?.weapon!==selected.tokenId)return;
    }
    await startRun();
  } finally {
    preparingRun=false;
    if(mode==='menu')renderPreparation();
  }
};
$('loadout-train').onclick=()=>{
  if(!champion||busy||preparingRun)return;
  forgeFromPreparation=true;
  skillTree.focusWeapon(selectedLoadout()?.identity ?? champion.build.weaponId ?? 'starter');
  renderForge(); $('preparation').classList.add('hidden'); $('forge').classList.remove('hidden'); $('forge-close').focus();
};
document.addEventListener('keydown',e=>{
  if(e.key==='Escape'&&!$('preparation').classList.contains('hidden')){e.preventDefault();closePreparation();}
});

let skillStage: RelicStage | null = null;
for(const id of ['loadout-slow','skill-slow']) $(id).onclick=()=>{
  const button=$(id), slow=button.getAttribute('aria-pressed')!=='true';
  button.setAttribute('aria-pressed',String(slow));button.textContent=slow?'0.35× · NORMAL SPEED':'SLOW MOTION';
  (id==='loadout-slow'?loadoutStage:skillStage)?.setSpeed(slow?.35:1);
};
function showSkillPreview(id: AbilityId, identity?: WeaponId) {
  skillStage ??= new RelicStage($<HTMLCanvasElement>("skill-stage"),$("skill-preview-label"));
  void skillStage.select(identity ?? champion?.build.weaponId ?? "starter");
  skillStage.preview(id);
  // Keep the map in place while its adjacent theatre changes weapon.
  const t = techniqueId(id);
  const info = t ? TECHNIQUES[t] : isSpell(id) ? SPELLS[id] : CORES[coreId(id)!];
  $("skill-preview-name").textContent = info.name;
  $("skill-preview-description").textContent = info.description;
}
async function changeSkill(action: () => Promise<Champion>, success: string) {
  if (busy) return;
  busy = true; renderForge(); notice("");
  try { champion = await action(); refreshChampion(); notice(champion.chain?.pending ? "Confirming your skill. Coin and access update after confirmation." : success); }
  catch(e) { notice((e as Error).message); }
  finally { busy = false; renderForge(); }
}
const skillTree = new SkillTree($("forge-cards"), {
  learn: id => changeSkill(()=>api.train(id), `${SKILLS[id].name} learned.`),
  spell: id => changeSkill(()=>api.selectSpell(id), `${SPELLS[id].name} equipped on Q.`),
  core: id => changeSkill(()=>api.attune(id), `${CORES[id].name} equipped on R.`),
  preview: showSkillPreview,
});
function renderForge() {
  if (!champion) return;
  renderGear();
  skillTree.render(champion, busy);
}
$("train").addEventListener("click", async () => {
  forgeFromPreparation=false;
  try {
    await loadChampion();
    renderForge();
    $("modes").inert = true;
    $("forge").classList.remove("hidden");
    $("forge-close").focus();
  } catch (e) {
    notice((e as Error).message);
  }
});
$("forge-close").addEventListener("click", () => {
  skillTree.close();
  $("forge").classList.add("hidden");
  if(forgeFromPreparation) { $('preparation').classList.remove('hidden'); renderPreparation(); $('loadout-train').focus(); }
  else { $("modes").inert = false; $("train").focus(); }
});
let previewInert: [HTMLElement, boolean][] = [];
$("skill-preview-expand").onclick = () => {
  const theatre = document.querySelector('.skill-theatre')!;
  const expanded = theatre.classList.toggle('expanded');
  if(expanded) {
    theatre.setAttribute('role','dialog'); theatre.setAttribute('aria-modal','true'); theatre.setAttribute('aria-label','Skill animation preview');
    for(let branch=theatre as HTMLElement;branch.parentElement && branch!==$('forge');branch=branch.parentElement) {
      for(const sibling of branch.parentElement.children) if(sibling!==branch && sibling instanceof HTMLElement) { previewInert.push([sibling,sibling.inert]);sibling.inert=true; }
    }
  } else {
    for(const [el,inert] of previewInert) el.inert=inert;
    previewInert=[];theatre.removeAttribute('role');theatre.removeAttribute('aria-modal');theatre.removeAttribute('aria-label');
  }
  $("skill-preview-expand").setAttribute('aria-pressed',String(expanded));
  $("skill-preview-expand").setAttribute('aria-label',expanded?'Close expanded preview':'Expand animation preview');
};
document.addEventListener('keydown', e => { if(e.key==='Escape' && document.querySelector('.skill-theatre.expanded')) { $("skill-preview-expand").click(); e.stopImmediatePropagation(); } }, true);

const embers = $("embers");
for (let i = 0; i < 36; i++) {
  const e = document.createElement("i");
  e.style.left = `${Math.random() * 100}%`;
  e.style.setProperty("--drift", `${(Math.random() - 0.5) * 220}px`);
  e.style.animationDuration = `${5 + Math.random() * 9}s`;
  e.style.animationDelay = `${-Math.random() * 12}s`;
  embers.appendChild(e);
}
$("play").addEventListener("click", () => {
  $("landing").classList.add("up");
  $("landing").inert = true;
  $("modes").inert = false;
  $("mode-solo").focus();
  void loadChampion().catch((e) => notice(e.message));
});
$("mode-solo").addEventListener("click", () => void openPreparation());
$("again").addEventListener("click", () => {
  if (world.mode === "duel") {
    toMenu();
    void openLobby();
  } else void startRun();
});
$("same-seed").addEventListener("click", () => void startRun(challenge?.id));
$("retry-verification").addEventListener("click", () => void verifyRun());
$("to-menu").addEventListener("click", toMenu);
$("pause-menu").addEventListener("click", async () => {
  if (busy) return;
  if (world.mode === "duel" && !ended && challenge) {
    busy = true;
    try {
      await checkpointPromise;
      champion = await api.forfeit(challenge.id);
    } catch (e) {
      notice((e as Error).message);
      return;
    } finally {
      busy = false;
    }
  }
  toMenu();
});
$("pause-toggle").addEventListener("click", () => setPaused(true));
$("resume").addEventListener("click", () => setPaused(false));
$("sound-toggle").addEventListener("click", () => {
  sound.toggle();
  reflectSound();
});
reflectSound();

/** Unbroken hits in a row: cosmetic, cleared by a pause in the assault or by being struck. */
let chain = 0,
  chainT = 0;
function resetCombatFeedback() {
  chain = chainT = 0;
  $("chain").classList.remove("show");
  for (const animation of $("chain-count").getAnimations()) animation.cancel();
  $("chain-count").textContent = "0";
  $("chain-rank").textContent = "";
  $("hurt-veil").classList.remove("on", "low");
}
function paintChain(pop: boolean) {
  $("chain").classList.toggle("show", chain >= 3);
  if (chain < 3) return;
  const count = $("chain-count");
  count.textContent = String(chain);
  $("chain-rank").textContent = chain >= 40 ? "DAMNATION" : chain >= 25 ? "MERCILESS" : chain >= 12 ? "RELENTLESS" : "";
  if (pop) {
    for (const animation of count.getAnimations()) animation.cancel();
    count.animate(
      [{ transform: "scale(1.5)", color: "#fff6e0" }, { transform: "scale(1)" }],
      { duration: 170, easing: "ease-out" },
    );
  }
}
let hudElapsed = 0;
function frame(now: number) {
  const dt = Math.min(0.1, (now - last) / 1000);
  last = now;
  if (document.hidden) { requestAnimationFrame(frame); return; }
  if (mode === "run" && !paused && !ended && !busy) {
    if (world.phase === "reward" && !choiceQueued) acc = 0;
    else if (freeze > 0) freeze -= dt;
    else acc += dt * (slow > 0 ? 0.3 : 1);
    if (chainT > 0 && (chainT -= dt) <= 0) {
      chain = 0;
      paintChain(false);
    }
    if (slow > 0) slow -= dt;
    let n = 0;
    while (acc >= DT && n < 6 && freeze <= 0) {
      const input =
        world.phase === "reward"
          ? {
              move: -1,
              aim: world.player.aim,
              attack: false,
              dash: false,
              choice: choiceQueued,
            }
          : automated
            ? bot(world)
            : readInput();
      choiceQueued = 0;
      const packed = packInput(input);
      replay.push(packed);
      // Play exactly the input recorded for the referee (jump shares the technique bits).
      step(world, unpackInput(packed));
      acc -= DT;
      n++;
      for (const e of world.events) {
        if (e.type === "floor")
          showBanner(
            `CIRCLE ${ROMAN[world.floor - 1]} / ${CIRCLES[world.floor - 1].name}`,
          );
        if (e.type === "hit") {
          chain += 1;
          chainT = 3;
        }
        if (e.type === "hurt" && chain) {
          chain = 0;
        }
        if (e.type === "hurt") {
          const veil = $("hurt-veil");
          veil.classList.remove("on");
          void veil.offsetWidth;
          veil.classList.add("on");
        }
        // The last kill of a room lingers.
        if (e.type === "cleared" || e.type === "won") slow = 0.42;
        if (e.type === "cleared") {
          $("reward").classList.add("hidden");
          $("hud").inert = false;
          clearInput();
          showBanner("THE WAY DOWN IS OPEN", 2);
        }
        if (e.type === "reward") showReward();
      }
      if (world.events.some(e => e.type === "hit" || e.type === "hurt")) paintChain(chain > 0);
      freeze = Math.max(freeze, view.consume(world.events));
      sound.consume(world.events);
      world.events.length = 0;
      if (
        world.phase === "reward" ||
        world.phase === "dead" ||
        world.phase === "won"
      )
        break;
    }
    if (world.phase === "dead" || world.phase === "won")
      showEnd(world.phase === "won");
    else if (world.mode === "duel") checkpointDuel();
  }
  if (mode === "run" && !paused) view.sync(world, slow > 0 ? dt * 0.3 : dt, Math.min(1, acc / DT));
  if (mode === "run") {
    hudElapsed += dt;
    if (hudElapsed >= 1 / 30) { updateHud(paused || ended ? 0 : hudElapsed); hudElapsed = 0; }
  } else hudElapsed = 0;
  $("hurt-veil").classList.toggle(
    "low",
    mode === "run" && world.phase !== "dead" && world.player.hp > 0 && world.player.hp < world.player.maxHp * 0.3,
  );
  if (mode === "run") view.render();
  requestAnimationFrame(frame);
}
$("hurt-veil").addEventListener("animationend", (e) => {
  if ((e as AnimationEvent).animationName === "hurt-veil") $("hurt-veil").classList.remove("on");
});
requestAnimationFrame(frame);
setInterval(() => {
  if (mode === "run" && ended && resultPending && !verifying && !busy)
    void verifyRun(true);
  if (mode === "menu" && champion?.chain?.pending && !busy)
    void loadChampion().catch(() => {});
}, 5000);

// Development inspection only. The referee never accepts a client world or score.
if (import.meta.env.DEV)
  (window as unknown as Record<string, unknown>).__game = {
    get world() {
      return world;
    },
    get replay() {
      return replay;
    },
    FLOORS,
    view,
    /** One bot-driven tick for frame-by-frame inspection; returns hit-stop seconds. */
    tick(override?: Partial<Input>) {
      step(world, { ...bot(world), ...override });
      const stop = view.consume(world.events);
      const seen = world.events.map((e) => e.type);
      world.events.length = 0;
      return { stop, seen };
    },
  };
