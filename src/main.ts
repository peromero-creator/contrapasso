import { DescentTransition } from "./ui/descent-transition";
import { BOSSES } from './sim/bosses.ts';
import { SkillInputBuffer } from "./ui/skill-input";
import { loadoutWeapons } from "./ui/loadout";
import { SkillTree } from "./ui/skill-tree";
import { Camp, type CampPage } from "./ui/camp";
import { SettingsPanel } from "./ui/settings";
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
  BOSS_FLOORS, bossAvailable, nearBossGate,
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
const camp = new Camp();
const descentTransition = new DescentTransition();
let entranceT=0, rewardPicking=false;
const runVows: string[] = [];
let world: World = createWorld(1);
let mode: "menu" | "run" = "menu";
let ended = false,
  paused = false,
  busy = false,
  verifying = false;
let resultPending = false;
let champion: Champion | null = null;
let hubStage: RelicStage | null = null;
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
let shownFlow = 0;
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
  button.setAttribute("aria-checked", String(!sound.muted));
  button.querySelector("span")!.textContent = sound.muted ? "OFF" : "ON";
  button.disabled = silent;
  $("sound-note").textContent = silent
    ? "Locked off for this silent session."
    : "Off by default. Press M at any time.";
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
  $("hub-weapon").textContent =
    `${weapon(champion.build.weaponId).name} +${champion.build.weaponLevel}`;
  $("hub-armor").textContent = `Ash Armor +${champion.build.armorLevel}`;
  hubStage ??= new RelicStage($<HTMLCanvasElement>("hub-stage"), $("hub-stage-label"), true);
  void hubStage.select(champion.build.weaponId ?? "starter");
  $("hub-skills").textContent =
    `${champion.skills.length} / ${SKILL_IDS.length} learned`;
  $("hub-depth").textContent =
    `${champion.bestFloor ? ROMAN[champion.bestFloor - 1] : "—"} / V`;
  $("daily-coin").textContent =
    `${champion.earnedToday} / ${champion.dailyCap} coin`;
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
  const duel = $<HTMLButtonElement>("mode-duel");
  duel.disabled = !chain || chain.pending;
  duel.classList.toggle("locked", duel.disabled);
  $("duel-card-action").textContent =
    chain && !chain.pending
      ? "FIND A RIVAL ↘"
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
  return { move, aim, attack, dash, ...skillInput.take(world.player, dash || jump), jump, choice: world.phase === "cleared" ? choiceQueued : 0 };
}
function choose(choice: number) {
  if (world.phase !== "reward" || paused || choiceQueued) return;
  if(rewardPicking || !world.offers[choice-1])return;
  rewardPicking=true;
  const skill=world.offers[choice-1];
  const card=document.querySelector<HTMLElement>(`[data-choice="${choice}"]`)!;
  card.classList.add('chosen');card.parentElement!.classList.add('decided');
  const duration=document.documentElement.classList.contains('calm')?0:360;
  if(duration) {
    const icon=card.querySelector('.skill-icon')?.cloneNode(true) as HTMLElement | undefined;
    const target=$(techniqueId(skill)?'technique-'+skill.slice(-1):skill.endsWith('-spell')?'cast-slot':['ember','ash','iron'].includes(skill)?'core-slot':'powers');
    if(icon){const a=card.getBoundingClientRect(),b=target.getBoundingClientRect();icon.classList.add('reward-flight');document.body.append(icon);icon.style.left=`${a.x+a.width/2}px`;icon.style.top=`${a.y+200}px`;const animation=icon.animate([{transform:'translate(-50%,-50%) scale(1)',opacity:1},{transform:`translate(${b.x+b.width/2-a.x-a.width/2}px,${b.y+b.height/2-a.y-200}px) scale(.4)`,opacity:.1}],{duration:440,easing:'cubic-bezier(.4,0,.2,1)'});animation.onfinish=()=>icon.remove();}
  }
  window.setTimeout(()=>{if(world.phase==='reward'&&mode==='run'){choiceQueued=choice;runVows.push(SKILLS[skill].name);}rewardPicking=false;},duration);
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
  if (!e.repeat && e.code === "KeyE" && nearBossGate(world)) choiceQueued = 1;
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
      button.disabled = rewardPicking || !!choiceQueued;
  sound.setPaused(value);
  $("hud").inert = value || world.phase === "reward";
  $("reward").inert = value;
  $("pause").classList.toggle("hidden", !value);
  if (value)
    $("pause-where").textContent =
      world.mode === "duel"
        ? "Your duel is paused. Leaving now forfeits the stake."
        : `Circle ${ROMAN[world.floor - 1]} · ${CIRCLES[world.floor - 1].name} · ${world.player.coins} coin collected. Leaving ends this descent.`;
  if (value) {
    const p=world.player;
    $('pause-build').innerHTML=`<strong>${weapon(p.weaponId).name} +${p.weaponLevel}</strong><p>${weaponTechniques(p.weaponId).filter(id=>rank(p.skills,id)>0).map(id=>TECHNIQUES[id].name).join(' · ')||'No techniques learned'}</p><div>${runVows.map(v=>`<span>${escapeHtml(v)}</span>`).join('')}</div>`;
    $('resume').focus();
  }
  else {
    sound.unlock();
    if (world.phase === "reward")
      document.querySelector<HTMLButtonElement>(".power-choice")?.focus();
    else if (document.activeElement instanceof HTMLElement)
      document.activeElement.blur();
  }
}
$("boss-enter").onclick = () => { if (!paused && nearBossGate(world)) choiceQueued = 1; };
function showReward() {
  if (world.phase !== "reward" || !world.offers.length) return;
  clearInput();
  rewardPicking=false;
  $("reward-cards").classList.remove("decided");
  acc = freeze = slow = 0;
  $("hud").inert = true;
  $("reward-circle").textContent = world.bossEncounter === "defeated" ? "BOSS DEFEATED" : `CIRCLE ${ROMAN[world.floor - 1]} CLEARED`;
  const cards = $("reward-cards");
  cards.innerHTML = world.offers
    .map(
      (id, i) =>
        `<button class="power-choice" style="--card-panel:${id.startsWith("staff-")||id.endsWith("-spell")||id==="pyre"?1:techniqueId(id)?0:["ember","ash","iron"].includes(id)?2:3}" data-choice="${i + 1}"><span class="power-key">0${i + 1}</span><span class="power-art" aria-hidden="true"></span>${skillIcon(id)}<span class="power-rank">RANK ${rank(world.player.skills, id) + 1}</span><strong>${SKILLS[id].name}</strong><span class="power-description">${SKILLS[id].description}</span><span class="power-effect">${SKILLS[id].rank.replace(" per rank", "")}</span><span class="power-take">CHOOSE UPGRADE <span>↗</span></span></button>`,
    )
    .join("");
  for (const button of cards.querySelectorAll<HTMLButtonElement>("button"))
    button.addEventListener("click", () =>
      choose(Number(button.dataset.choice)),
    );
  $("reward").classList.remove("hidden");
  document.querySelector<HTMLButtonElement>(".power-choice")?.focus();
}
let waveKey='',wavePeak=0;
for(const id of ['cast-slot','technique-1','technique-2','technique-3','technique-4']){const number=document.createElement('output');number.className='cooldown-number';number.setAttribute('aria-hidden','true');$(id).append(number);}
function updateHud(dt: number) {
  const p = world.player;
  const key=`${world.floor}:${world.wave}:${world.bossEncounter}`;
  if(waveKey!==key){waveKey=key;wavePeak=0;}
  wavePeak=Math.max(wavePeak,world.enemies.length);
  $('wave-progress').style.setProperty('--remaining',String(wavePeak?world.enemies.length/wavePeak:0));
  $('wave-progress').hidden=world.phase!=='fight'||world.bossEncounter==='active'||world.mode==='duel';
  for(const [i,id]of ['cast-slot','technique-1','technique-2','technique-3','technique-4'].entries()){
    const cd=i===0?p.spellCd:p.techniqueCd[i-1];$(id).querySelector('output')!.textContent=cd>.05?cd.toFixed(1):'';
  }
  $('first-technique-hint').hidden=!settings.values.hints||!!champion?.runs||p.castN>0||!weaponTechniques(p.weaponId).some(id=>rank(p.skills,id)>0)||world.phase!=='fight';
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
  if (view.flow !== shownFlow) {
    shownFlow = view.flow;
    $("flow").classList.toggle("show", shownFlow >= 2);
    $("flow").classList.toggle("strong", shownFlow >= 3);
    $("flow").classList.toggle("master", shownFlow >= 5);
    if (shownFlow >= 2) {
      $("flow-count").textContent = `×${shownFlow}`;
      restartAnimation($("flow"), "pop");
    }
  }
  $("coin-n").textContent = String(p.coins);
  $("circle").textContent =
    `${ROMAN[world.floor - 1]} / ${CIRCLES[world.floor - 1].name}`;
  $("wave").textContent =
    world.phase === "reward"
      ? "TAKE A VOW"
      : world.phase === "cleared"
        ? "ENTER THE GATE"
        : world.bossEncounter === "active" ? "BOSS CHAMBER" : `WAVE ${world.wave + 1} / ${world.wavesInFloor} · ${world.enemies.length} REMAIN`;
  if (world.mode === "duel") {
    $("circle").textContent = "DUEL / THE CHALLENGE";
    $("wave").textContent =
      `${Math.max(0, Math.ceil((DUEL_TICKS - world.tick) / 60))} SECONDS · 10 COIN AT STAKE`;
    $("coin-n").textContent = String(champion?.coins ?? 0);
    const opponent = world.enemies.find((e) => e.kind === "champion");
    $("duel-boss-fill").style.width =
      `${opponent ? Math.max(0, opponent.hp / opponent.maxHp) * 100 : 0}%`;
  }
  if (world.mode !== "duel") {
    const boss = world.enemies.find(e => e.kind === "warden" && e.hp > 0);
    $("duel-boss").classList.toggle("hidden", !boss);
    if (boss) {
      const opening = boss.state === 'recover' && !boss.openingSpent;
      $("duel-boss-name").textContent = `${BOSSES[boss.boss ?? 'warden'].name.toUpperCase()}${opening ? ' · FINISHER OPENING' : ''}`;
      $("duel-boss-fill").style.width = `${Math.max(0,boss.hp/boss.maxHp)*100}%`;
    }
  }
  $("portal-hint").classList.toggle("hidden", world.phase !== "cleared");
  $("portal-hint").textContent = world.floor === FLOORS ? "ENTER THE LIT GATE TO FINISH" : "ENTER THE LIT GATE TO DESCEND";
  const gateReady = nearBossGate(world);
  $("boss-gate-prompt").classList.toggle("hidden", !bossAvailable(world) || world.phase !== "cleared");
  $("boss-enter").toggleAttribute("disabled", !gateReady);
  $("boss-gate-name").textContent = BOSSES[(["warden", "witness", "cantor"] as const)[BOSS_FLOORS.indexOf(world.floor as 2|4|5)] ?? "warden"].name;
  $("boss-gate-help").textContent = gateReady ? "Optional encounter" : "Optional boss · Approach the carved door";
  $("gate-veil").style.opacity = world.gateTransition > 0 ? String(Math.sin(Math.PI * (1-world.gateTransition/54))) : "0";
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
    if(world.mode !== "duel") {
      countCoins(response.receipt.result.awardedCoins);
      $("end-coins-label").textContent = resultPending ? "COIN PENDING" : "COIN SAVED";
    }
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
let coinAnimation=0;
function countCoins(value:number) {
  cancelAnimationFrame(coinAnimation);
  const start=Number($('end-coins').textContent)||0,at=performance.now(),duration=document.documentElement.classList.contains('calm')?0:650;
  const tick=(now:number)=>{const t=duration?Math.min(1,(now-at)/duration):1;$('end-coins').textContent=String(Math.round(start+(value-start)*(1-(1-t)**3)));if(t<1)coinAnimation=requestAnimationFrame(tick);};
  coinAnimation=requestAnimationFrame(tick);
}
function showEnd(won: boolean) {
  ended = true;
  clearInput();
  $("hud").inert = true;
  $("reward").classList.add("hidden");
  $("end-title").textContent = won ? "HELL REMEMBERS" : "NOT FORGIVEN";
  $("end-sub").textContent = won
    ? "Five circles behind you. Return to camp and prepare your next descent."
    : `${CIRCLES[world.floor - 1].name} keeps you. The next descent is yours.`;
  $("end-coins").textContent="0"; countCoins(world.player.coins);
  $("end-build").innerHTML=`<p>${weapon(world.player.weaponId).name} · ${Math.floor(world.tick/3600)}:${String(Math.floor(world.tick/60)%60).padStart(2,'0')} · Best FLOW ×${view.bestFlow}</p><div>${runVows.map(name=>`<span>${escapeHtml(name)}</span>`).join('') || '<span>No vows taken this descent</span>'}</div>`;
  $("end-kills").textContent = `${world.player.kills}`;
  $("end-floor").textContent = `${world.floor} / 5`;
  const duel = world.mode === "duel";
  $("same-seed").classList.toggle("hidden", duel);
  $("again").textContent = duel ? "FIND ANOTHER RIVAL ↗" : "DESCEND AGAIN ↗";
  $("end-coins-label").textContent = duel ? "COIN AT STAKE" : "COIN COLLECTED";
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
  runVows.length=0;rewardPicking=false;
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
  ended = paused = false;enragedBoss=null;waveKey='';wavePeak=0;
  mode = "run";
  sound.setPaused(false);
  sound.unlock();
  for (const id of ["end", "pause", "reward"]) $(id).classList.add("hidden");
  $("landing").classList.add("up");
  $("landing").inert = true;
  entranceT=descentTransition.play(next.mode === "duel" ? "THE DUEL" : "CIRCLE I · LIMBO");
  camp.leave();
  $("hud").classList.remove("hidden");
  $("hud").inert = false;
  if (document.activeElement instanceof HTMLElement)
    document.activeElement.blur();
  $("duel-boss").classList.toggle("hidden", next.mode !== "duel");
  $("duel-boss-name").textContent = next.opponent?.name ?? "RIVAL CHAMPION";
  $("pause-menu").textContent =
    next.mode === "duel" ? "FORFEIT · LOSE 10 COIN" : "LEAVE · RETURN TO CAMP";
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
  for (const id of ["pause", "end", "hud", "reward"])
    $(id).classList.add("hidden");
  descentTransition.play("RETURN TO CAMP",true);
  camp.enter("modes");
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
    button.innerHTML = `<span class="eyebrow">MATCHED POWER / ${buildPower(opponent.build)}</span><strong></strong><span>${opponent.wins} W / ${opponent.losses} L · Blade +${opponent.build.weaponLevel} / Armor +${opponent.build.armorLevel}</span><span class="opponent-powers">SKILLS · ${Object.keys(opponent.build.skills).length}</span><span class="opponent-fight">CHALLENGE · 10 COIN <b>↘</b></span>`;
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
async function openLobby(turn = navigation) {
  if (busy || verifying) return;
  busy = true;
  notice("Finding matched champions…");
  try {
    await refreshLobby();
    if (turn !== navigation) return;
    camp.show("duel-lobby");
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
$("mode-duel").addEventListener("click", () => void navigate("duel-lobby"));
function closeLobby() {
  if (busy) return;
  camp.show("modes");
  $("mode-duel").focus();
}
$("duel-close").addEventListener("click", closeLobby);
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
/** Restart a one-shot CSS animation class on an element. */
function restartAnimation(el: Element | null, name: string) {
  if (!el) return;
  el.classList.remove(name);
  void (el as HTMLElement).offsetWidth;
  el.classList.add(name);
}
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
    ? "THE ASH EXCHANGE"
    : "THE RELIQUARY";
  document.querySelector<HTMLElement>(".market-fine")!.textContent = exchange
    ? "The same NFT, with its upgrades and history. Seller receives 90%; game treasury receives 10%. Test NEAR only."
    : "10 coin + 0.01 test NEAR per weapon. Equip, upgrade, or resell.";
}
function renderExchange() {
  if (!marketState || !champion) return;
  const state = marketState;
  const ready = champion.chain?.features?.includes("exchange"),
    owner = champion.chain?.accountId;
  const entries = marketState.listings ?? [];
  $("exchange-listings").innerHTML = !ready
    ? `<p>${champion.chain ? "Trading is not available on this testnet contract yet." : "Connect testnet to browse and trade player relics."}</p>`
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
  const mintStep=reservation?.status==='minted'?2:reserved?1:0;
  $('mint-steps').innerHTML=['Reserve','Pay test NEAR','Minted'].map((name,i)=>`<li class="${i<mintStep?'done':i===mintStep?'current':''}" ${i===mintStep?'aria-current="step"':''}><b>${i<mintStep?'✓':i+1}</b>${name}</li>`).join('');
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
    actions = "Your relic is minted. Equip it from Inventory.";
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
async function openMarket() {
  await loadChampion();
  marketState = await api.market();
  saleInventory = (await api.nft()).tokens;
  showMarketTab(exchangeOpen);
  if (pendingMarket?.championId !== champion?.id) pendingMarket = null;
  renderMarket();
}
$("tab-mint").addEventListener("click", () => showMarketTab(false));
$("tab-exchange").addEventListener("click", () => showMarketTab(true));
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
    restartAnimation(document.querySelector('.relic-detail'), 'swap');
    restartAnimation(document.querySelector('.relic-art'), 'flash');
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
  const upgrade = (e.target as HTMLElement).closest<HTMLButtonElement>(
    "button[data-temper]",
  );
  if (upgrade && !upgrade.disabled) return void temper(upgrade.dataset.temper as GearSlot);
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
async function renderNft(flash?: { slot: GearSlot; held: boolean }) {
  const view = await api.nft();
  $("nft-intro").textContent = view.onChain
    ? "Your champion, equipment and history, saved on NEAR testnet. Temper equipped gear with Solo coin."
    : "Local preview. Temper equipped gear with Solo coin; connect testnet to mint and trade.";
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
      const primaryRows = rows.filter(([key],i)=>isChampion ? i<3 : ['Level','Damage','Kills'].includes(key));
      const otherRows = rows.filter(row=>!primaryRows.includes(row));
      const flashed = !isChampion && equipped && flash?.slot === slot ? ` data-flash="${flash.held ? "held" : "burned"}"` : "";
      return `<article class="nft-card${isChampion ? " champion" : equipped ? " equipped" : ""}"${flashed}><span class="eyebrow">${isChampion ? "CHAMPION" : equipped ? `IN USE · ${slot.toUpperCase()}` : slot === "weapon" ? "WEAPON" : "ARMOR"}</span>${!isChampion && x.kind === "weapon" ? `${relicImage(identity, weapon(identity).name)}` : `<div class="nft-crest" aria-hidden="true">${skillIcon(isChampion ? "ember" : x.kind === "armor" ? "iron" : "sword-1")}</div>`}<strong>${escapeHtml(token.title)}</strong><dl>${primaryRows.map(([k, v]) => `<dt>${k}</dt><dd>${escapeHtml(v)}</dd>`).join("")}</dl><details class="token-details"><summary>Details & ownership</summary><dl>${otherRows.map(([k,v])=>`<dt>${k}</dt><dd>${escapeHtml(v)}</dd>`).join("")}<dt>Token</dt><dd>${escapeHtml(shortAccount(token.tokenId))}</dd><dt>Owner</dt><dd>${view.onChain ? `<a href="${EXPLORER}/address/${encodeURIComponent(token.ownerId)}" target="_blank" rel="noopener noreferrer">${escapeHtml(shortAccount(token.ownerId))} ↗</a>` : escapeHtml(token.ownerId)}</dd></dl></details>${isChampion ? skillBadge({}, (Array.isArray(x.skills) ? x.skills : []) as SkillId[]) : ""}${!isChampion && equipped ? temperHtml(slot) : ""}${flash?.slot===slot&&equipped?`<p class="temper-outcome ${flash.held?'held':'failed'}" role="status">${flash.held?'TEMPER HELD':'TEMPER FAILED'}<small>+${x.level} ${flash.held?'FORGED':'UNCHANGED'}</small></p>`:""}${gearButton}</article>`;
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
async function openInventory() {
  await loadChampion();
  await renderNft();
  claimArmed = false;
  claimSourceId = champion?.id ?? null;
  $("claim-button").textContent = "CLAIM TO WALLET";
  $("claim-result").textContent = "";
}
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
/** The temper action lives on the equipped item it changes. */
function temperHtml(slot: GearSlot) {
  if (!champion) return "";
  const level = champion.build[slot === "weapon" ? "weaponLevel" : "armorLevel"];
  const max = level >= MAX_GEAR_LEVEL;
  const cost = upgradeCost(level);
  const odds = upgradeChance(level);
  const available =
    (!champion.chain || champion.chain.features?.includes("upgrade")) &&
    !!champion.equipped?.[slot];
  const confirming = pendingUpgrade?.championId === champion.id && pendingUpgrade.slot === slot;
  const otherPending = pendingUpgrade?.championId === champion.id && !confirming;
  const blocked = busy || otherPending || (!confirming && (max || champion.coins < cost || !available));
  const short = !max && available && !confirming && champion.coins < cost;
  return `<div class="temper"><span class="eyebrow">TEMPER</span><div class="temper-step"><b>+${level}</b>${max ? "" : `<i>→</i><b>+${level + 1}</b>`}<span>${GEAR[slot].effect(level)}${max ? "" : ` → ${GEAR[slot].effect(level + 1)}`}</span></div><small>${max ? "Nothing left to temper." : short ? `${cost - champion.coins} more coin needed. Earn coin in Solo.` : odds === 100 ? "Always holds." : `${odds}% to hold. A failure burns only the coin.`}</small><button class="btn" data-temper="${slot}" ${blocked ? "disabled" : ""}>${confirming ? "CONFIRM UPGRADE" : !available ? "NOT AVAILABLE" : max ? "AT ITS LIMIT" : `TEMPER · ${cost} COIN`}</button></div>`;
}
async function temper(slot: GearSlot) {
  if (busy || !champion) return;
  busy = true;
  for (const button of $("nft-tokens").querySelectorAll<HTMLButtonElement>("button"))
    button.disabled = true;
  notice("");
  let flash: { slot: GearSlot; held: boolean } | undefined;
  try {
    if (!pendingUpgrade || pendingUpgrade.championId !== champion.id)
      pendingUpgrade = { id: crypto.randomUUID(), championId: champion.id, slot };
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
    if (!response.upgrade.error) flash = { slot, held: response.upgrade.success };
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
    await renderNft(flash).catch(() => {});
  }
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
  $('loadout-weapons').innerHTML = loadoutOptions.map(t=>`<button data-loadout="${escapeHtml(t.tokenId)}" aria-pressed="${t.tokenId===loadoutToken}" ${preparationBusy||t.blocked?'disabled':''}>${relicImage(t.identity,weapon(t.identity).name)}<strong>${weapon(t.identity).name} <em>+${t.level}</em></strong><small>${t.blocked?'Unavailable · listed or equipped elsewhere':t.tokenId===champion!.equipped?.weapon?'IN HAND':weapon(t.identity).className}</small></button>`).join('') || '<p>Your starting blade is ready.</p>';
  const build = document.querySelector<HTMLElement>('.preparation-build')!;
  if (build.dataset.weapon !== identity) {
    build.dataset.weapon = identity;
    restartAnimation(build, 'swap');
    restartAnimation(document.querySelector('.preparation-theatre'), 'flash');
  }
  void paintRelics($('loadout-weapons'));
  $('loadout-name').textContent=spec.name;
  $('loadout-description').textContent=spec.description;
  const equipped=weapon(champion.build.weaponId),damageDiff=spec.damage+(selected?.level??champion.build.weaponLevel)*2-(equipped.damage+champion.build.weaponLevel*2),rangeDiff=spec.reach-equipped.reach;
  const delta=(n:number)=>n?`<em class="${n>0?'better':'worse'}">${n>0?'+':''}${Number(n.toFixed(1))}</em>`:'';
  $('loadout-stats').innerHTML=`<span><b>${spec.damage+(selected?.level??champion.build.weaponLevel)*2}</b> damage ${delta(damageDiff)}</span><span><b>${spec.reach}m</b> reach ${delta(rangeDiff)}</span><span><b>${selected?.kills??0}</b> kills</span>`;
  $('loadout-techniques').innerHTML=weaponTechniques(identity).map((id,i)=>`<button data-loadout-preview="${id}" title="Preview ${TECHNIQUES[id].name}"><kbd>${i+1}</kbd><span>${TECHNIQUES[id].name}<small>${champion!.skills.includes(id)?'LEARNED':'NOT LEARNED · PREVIEW ONLY'}</small></span></button>`).join('');
  loadoutStage ??= new RelicStage($<HTMLCanvasElement>('loadout-stage'),$('loadout-preview-label'));
  void loadoutStage.select(identity); loadoutStage.preview(null);
  $<HTMLButtonElement>('loadout-start').disabled=preparationBusy||!!champion.chain?.pending||!!selected?.blocked;
  $('loadout-start').textContent=preparationBusy?'PREPARING…':pendingMarket?'CHECK PENDING ACTION ↻':'TAKE THE DESCENT ↘';
}
async function openPreparation(turn = navigation) {
  if(busy||verifying)return;
  notice('');
  try {
    await loadChampion(); const inventory=await api.nft();
    if (turn !== navigation) return;
    loadoutOptions=loadoutWeapons(inventory.tokens,champion!.id);
    loadoutToken=champion!.equipped?.weapon ?? loadoutOptions.find(t=>!t.blocked)?.tokenId ?? null;
    camp.show('preparation');
    $('loadout-status').textContent='Choose your weapon and preview its techniques. Locked skills must be learned before use.';
    renderPreparation(); $('preparation-close').focus();
  } catch(e){notice((e as Error).message);}
}
function closePreparation() {
  if(busy||preparingRun)return;
  camp.show('modes'); $('mode-solo').focus();
}
$('preparation-close').onclick=closePreparation;
$('loadout-weapons').onclick=e=>{
  const button=(e.target as HTMLElement).closest<HTMLButtonElement>('[data-loadout]');
  if(!button||button.disabled||busy||preparingRun)return;
  loadoutToken=button.dataset.loadout!; renderPreparation();
};
$('loadout-techniques').onclick=e=>{
  const button=(e.target as HTMLElement).closest<HTMLButtonElement>('[data-loadout-preview]');
  if(!button)return;
  for(const other of $('loadout-techniques').querySelectorAll('button'))other.classList.toggle('previewing',other===button);
  loadoutStage?.preview(button.dataset.loadoutPreview as AbilityId);
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
  renderForge(); $('forge-close').classList.remove('hidden'); camp.show('forge'); $('forge-close').focus();
};

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
  skillTree.render(champion, busy);
}
$("forge-close").addEventListener("click", () => {
  if (!forgeFromPreparation || busy) return;
  forgeFromPreparation = false;
  $("forge-close").classList.add("hidden");
  skillTree.close();
  renderPreparation();
  camp.show("preparation");
  $("loadout-train").focus();
});

/** Open the destination immediately; keep its controls inert while data arrives. */
let navigation = 0;
async function navigate(page: CampPage) {
  if (mode !== "menu" || preparingRun || verifying) return;
  if (page === camp.page) return;
  const turn = ++navigation;
  const nav = $("camp-nav");
  nav.dataset.loading = camp.tab(page);
  const destination=$(page);
  camp.show(page);
  destination.inert=true;
  destination.setAttribute('aria-busy','true');
  destination.dataset.load=String(turn);
  const placeholder=document.createElement('div');placeholder.className='page-loading';placeholder.setAttribute('role','status');placeholder.innerHTML='<span>Gathering your champion…</span><i></i><i></i><i></i>';destination.append(placeholder);
  notice("");
  try {
    if (page !== "forge" || !forgeFromPreparation) {
      if (page !== "forge") skillTree.close();
      forgeFromPreparation = false;
      $("forge-close").classList.add("hidden");
    }
    if (page === "forge") {
      await loadChampion();
      if (turn === navigation) renderForge();
    } else if (page === "nft") await openInventory();
    else if (page === "market") await openMarket();
    else if (page === "preparation") return void (await openPreparation());
    else if (page === "duel-lobby") return void (await openLobby());
    if (turn === navigation) camp.show(page);
  } catch (e) {
    if (turn === navigation) notice((e as Error).message);
  } finally {
    placeholder.remove();
    if (destination.dataset.load === String(turn)) {
      destination.removeAttribute("aria-busy");delete destination.dataset.load;
      destination.inert=camp.page!==page;
    }
    if (turn === navigation) delete nav.dataset.loading;
  }
}
for (const button of document.querySelectorAll<HTMLElement>("[data-camp],[data-camp-link]"))
  button.addEventListener("click", () =>
    void navigate((button.dataset.camp ?? button.dataset.campLink) as CampPage),
  );
$("camp-home").addEventListener("click", () => void navigate("modes"));
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
  camp.enter("modes");
  $("mode-solo").focus();
  void loadChampion().catch((e) => notice(e.message));
});
$("mode-solo").addEventListener("click", () => void navigate("preparation"));
$("again").addEventListener("click", () => {
  if (world.mode === "duel") {
    toMenu();
    void openLobby();
  } else void startRun();
});
$("same-seed").addEventListener("click", () => void startRun(challenge?.id));
$("retry-verification").addEventListener("click", () => void verifyRun());
$("to-menu").addEventListener("click", toMenu);
for(const id of ['end-skills','end-inventory'])$(id).onclick=()=>{if(verifying)return;toMenu();void navigate(id==='end-skills'?'forge':'nft');};
$('camp-nav').addEventListener('keydown',e=>{if(!['ArrowUp','ArrowDown','Home','End'].includes(e.key))return;const buttons=[...$('camp-nav').querySelectorAll<HTMLButtonElement>('button')];const i=buttons.indexOf(document.activeElement as HTMLButtonElement);if(i<0)return;e.preventDefault();buttons[e.key==='Home'?0:e.key==='End'?buttons.length-1:(i+(e.key==='ArrowUp'?-1:1)+buttons.length)%buttons.length].focus();});
$('reward-cards').addEventListener('keydown',e=>{if(!['ArrowLeft','ArrowRight'].includes(e.key))return;const buttons=[...$('reward-cards').querySelectorAll<HTMLButtonElement>('button')];const i=buttons.indexOf(document.activeElement as HTMLButtonElement);if(i<0)return;e.preventDefault();buttons[(i+(e.key==='ArrowLeft'?-1:1)+buttons.length)%buttons.length].focus();});
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
const settings = new SettingsPanel((values) => {
  sound.setVolume(values.volume);
  view.setShake(values.shake);
  view.setQuality(values.quality);
  document.documentElement.classList.toggle("calm", !values.motion);
  $("help").classList.toggle("hidden", !values.hints);
});
$("settings-open").addEventListener("click", () => settings.show($("settings-open")));
$("pause-settings").addEventListener("click", () => settings.show($("pause-settings")));
// Escape always steps back one level: the sheet, then a sub-page, then the tab.
window.addEventListener(
  "keydown",
  (e) => {
    if (e.key !== "Escape") return;
    if (settings.open) {
      e.preventDefault();
      e.stopImmediatePropagation();
      settings.close();
      return;
    }
    if (mode !== "menu" || !camp.active || document.querySelector(".skill-theatre.expanded")) return;
    if (camp.page === "preparation") closePreparation();
    else if (camp.page === "duel-lobby") closeLobby();
    else if (camp.page === "forge" && forgeFromPreparation) $("forge-close").click();
    else if (camp.page !== "modes") void navigate("modes");
  },
  true,
);

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
let enragedBoss: number | null = null;
function frame(now: number) {
  const dt = Math.min(0.1, (now - last) / 1000);
  last = now;
  if (document.hidden) { requestAnimationFrame(frame); return; }
  entranceT=Math.max(0,entranceT-dt);
  if (mode === "run" && !paused && !ended && !busy && entranceT<=0) {
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
            ? bot(world, params.get("bosses") === "1")
            : readInput();
      choiceQueued = 0;
      const packed = packInput(input);
      replay.push(packed);
      // Play exactly the input recorded for the referee (jump shares the technique bits).
      step(world, unpackInput(packed));
      acc -= DT;
      n++;
      const phaseBoss=world.enemies.find(e=>e.kind==='warden'&&(e.enraged||e.hp<e.maxHp*.5));
      if(phaseBoss&&phaseBoss.id!==enragedBoss){enragedBoss=phaseBoss.id;freeze=Math.max(freeze,.09);restartAnimation($('vignette'),'ult');showBanner('THE RITUAL DEEPENS',1.25);}
      for (const e of world.events) {
        if (e.type === "floor")
          showBanner(
            world.bossEncounter === "active" ? BOSSES[(["warden","witness","cantor"] as const)[BOSS_FLOORS.indexOf(world.floor as 2|4|5)]].name.toUpperCase() : `CIRCLE ${ROMAN[world.floor - 1]} / ${CIRCLES[world.floor - 1].name}`,
          );
        if (e.type === "hit") {
          chain += 1;
          chainT = 3;
        }
        if (e.type === "ability" && e.side !== "enemy" && e.stage === "charge" && e.ability) {
          const technique = techniqueId(e.ability);
          restartAnimation(technique ? $("technique-" + technique.slice(-1)) : isSpell(e.ability) ? $("cast-slot") : $("core-slot"), "fired");
          if (!technique && !isSpell(e.ability)) restartAnimation($("vignette"), "ult");
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
        if (e.type === "cleared" || e.type === "won" || e.type === "kill" && e.kind === "warden") slow = 0.55;
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
