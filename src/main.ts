import * as THREE from "three";
import { View, CIRCLES } from "./render/view";
import {
  createWorld,
  createDuelWorld,
  step,
  DT,
  FLOORS,
  type Input,
  type World,
} from "./sim/world";
import { dirIndex, DIRS } from "./sim/dirs";
import { packInput, unpackInput, SIM_VERSION } from "./sim/input";
import { buildPower, DUEL_TICKS } from "./sim/build";
import { SKILLS, SKILL_IDS, rank, type SkillId } from "./sim/skills";
import { Sound } from "./audio/sound";
import { api } from "./api";
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
  last = performance.now();
const keys = new Set<string>();
let mouseX = window.innerWidth / 2,
  mouseY = window.innerHeight / 3;
let mouseDown = false,
  dashQueued = 0,
  attackQueued = 0;
let aim = Math.floor(DIRS * 0.75);
const tmp = new THREE.Vector3();

function notice(text: string) {
  $("notice").textContent = text;
  $("notice").classList.toggle("hidden", !text);
}
function clearInput() {
  keys.clear();
  mouseDown = false;
  dashQueued = attackQueued = choiceQueued = 0;
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
function refreshChampion() {
  if (!champion) return;
  for (const el of document.querySelectorAll(".champion-coins"))
    el.textContent = String(champion.coins);
  $("champion-progress").textContent =
    `${champion.runs} DESCENTS · ${champion.victories} VICTORIES`;
  $("trained-powers").textContent = champion.skills.length
    ? champion.skills.map((id) => SKILLS[id].name).join(" · ")
    : "No vows taken. Your story starts below.";
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
    `Cinder blade +${champion.build.weaponLevel} · Ash armor +${champion.build.armorLevel} · Deepest circle ${champion.bestFloor} / 5`;
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
  return { move, aim, attack, dash };
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
    e.code === "KeyR" &&
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
  if (!e.repeat && ["Space", "ShiftLeft", "KeyK"].includes(e.code))
    dashQueued = 8;
  if (!e.repeat && e.code === "KeyJ") attackQueued = 8;
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
  acc = freeze = 0;
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
  clearInput();
  acc = freeze = 0;
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
  $("vital").classList.toggle("critical", p.hp > 0 && p.hp <= p.maxHp * 0.25);
  hpText.textContent = `${Math.ceil(p.hp)} / ${p.maxHp}`;
  dashPip.classList.toggle("ready", p.dashCd <= 0);
  $("dash-meter").style.width =
    `${Math.max(0, 1 - p.dashCd / (0.75 * (1 - 0.12 * rank(p.skills, "ash")))) * 100}%`;
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
  const powers = JSON.stringify(p.skills);
  if (powers !== shownPowers) {
    shownPowers = powers;
    $("powers").innerHTML = SKILL_IDS.filter((id) => rank(p.skills, id) > 0)
      .map(
        (id) =>
          `<span class="power-badge" title="${SKILLS[id].name} · Rank ${rank(p.skills, id)}">${skillIcon(id)}<b>${rank(p.skills, id)}</b></span>`,
      )
      .join("");
  }
  if (bannerT > 0) {
    bannerT -= dt;
    if (bannerT <= 0) banner.classList.remove("show");
  }
}
async function verifyRun() {
  if (!challenge || verifying) return;
  verifying = true;
  $("receipt-status").textContent = "Verifying your descent…";
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
    $("receipt-status").classList.add("verified");
    if (world.mode === "duel")
      $("receipt-status").textContent =
        `${response.receipt.result.coinDelta > 0 ? "+" : ""}${response.receipt.result.coinDelta} coin · ${champion.duelWins} wins / ${champion.duelLosses} losses`;
    if (champion.chain)
      $("receipt-status").textContent += champion.chain.pending
        ? " · Testnet save pending"
        : " · Confirmed on NEAR testnet";
  } catch (e) {
    $("receipt-status").textContent = (e as Error).message;
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
  challenge = next;
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
  shownPowers = "";
  acc = freeze = 0;
  ended = paused = false;
  mode = "run";
  sound.setPaused(false);
  sound.unlock();
  for (const id of ["end", "pause", "reward", "forge", "duel-lobby"])
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
  clearInput();
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
    button.innerHTML = `<span class="eyebrow">MATCHED POWER / ${buildPower(opponent.build)}</span><strong></strong><span>${opponent.wins} W / ${opponent.losses} L · Blade +${opponent.build.weaponLevel} / Armor +${opponent.build.armorLevel}</span><span class="opponent-powers">${SKILL_IDS.filter(
      (id) => rank(opponent.build.skills, id) > 0,
    )
      .map(
        (id) =>
          `<span title="${SKILLS[id].name} / ${rank(opponent.build.skills, id)}">${skillIcon(id)}<b>${rank(opponent.build.skills, id)}</b></span>`,
      )
      .join(
        "",
      )}</span><span class="opponent-fight">CHALLENGE · 10 COIN <b>↗</b></span>`;
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
function renderForge() {
  if (!champion) return;
  const grid = $("forge-cards");
  grid.innerHTML = SKILL_IDS.map((id) => {
    const known = champion!.skills.includes(id);
    return `<button class="training-card${known ? " learned" : ""}" data-skill="${id}" ${known || champion!.coins < SKILLS[id].cost || busy ? "disabled" : ""}>${skillIcon(id)}<strong>${SKILLS[id].name}</strong><span>${SKILLS[id].rank}</span><b>${known ? "VOW TAKEN" : `${SKILLS[id].cost} COIN`}</b></button>`;
  }).join("");
  for (const button of grid.querySelectorAll<HTMLButtonElement>("button"))
    button.addEventListener("click", async () => {
      if (busy) return;
      busy = true;
      renderForge();
      notice("");
      try {
        champion = await api.train(button.dataset.skill as SkillId);
        refreshChampion();
      } catch (e) {
        notice((e as Error).message);
      } finally {
        busy = false;
        renderForge();
      }
    });
}
$("train").addEventListener("click", async () => {
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
  $("forge").classList.add("hidden");
  $("modes").inert = false;
  $("train").focus();
});
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
$("mode-solo").addEventListener("click", () => void startRun());
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

function frame(now: number) {
  const dt = Math.min(0.1, (now - last) / 1000);
  last = now;
  if (mode === "run" && !paused && !ended && !busy) {
    if (world.phase === "reward" && !choiceQueued) acc = 0;
    else if (freeze > 0) freeze -= dt;
    else acc += dt;
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
      replay.push(packInput(input));
      step(world, input);
      acc -= DT;
      n++;
      for (const e of world.events) {
        if (e.type === "floor")
          showBanner(
            `CIRCLE ${ROMAN[world.floor - 1]} / ${CIRCLES[world.floor - 1].name}`,
          );
        if (e.type === "cleared") {
          $("reward").classList.add("hidden");
          $("hud").inert = false;
          clearInput();
          showBanner("THE WAY DOWN IS OPEN", 2);
        }
        if (e.type === "reward") showReward();
      }
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
  if (!paused) view.sync(world, dt);
  if (mode === "run") updateHud(paused || ended ? 0 : dt);
  view.render();
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);
setInterval(() => {
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
  };
