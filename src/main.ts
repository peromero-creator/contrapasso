import * as THREE from "three";
import { View, CIRCLES } from "./render/view";
import { createWorld, step, DT, FLOORS, type Input, type World } from "./sim/world";
import { dirIndex, DIRS } from "./sim/dirs";

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const ROMAN = ["I", "II", "III", "IV", "V", "VI", "VII", "VIII", "IX"];

const view = new View($<HTMLCanvasElement>("game"));
let world: World = createWorld(1);
let mode: "menu" | "run" = "menu";
let ended = false;

// input
const keys = new Set<string>();
let mouseX = window.innerWidth / 2;
let mouseY = window.innerHeight / 3;
let mouseDown = false;
let dashQueued = false;
let aim = Math.floor(DIRS * 0.75);
const tmp = new THREE.Vector3();

// every tick's input is kept so the referee server can replay the run
let replay: number[] = [];
const pack = (i: Input) => (i.move + 1) | (i.aim << 11) | ((i.attack ? 1 : 0) << 21) | ((i.dash ? 1 : 0) << 22);

function readInput(): Input {
  let ix = 0;
  let iz = 0;
  if (keys.has("KeyW") || keys.has("ArrowUp")) iz -= 1;
  if (keys.has("KeyS") || keys.has("ArrowDown")) iz += 1;
  if (keys.has("KeyA") || keys.has("ArrowLeft")) ix -= 1;
  if (keys.has("KeyD") || keys.has("ArrowRight")) ix += 1;
  const move = ix || iz ? dirIndex(ix, iz) : -1;
  if (view.groundPoint(mouseX, mouseY, tmp)) {
    const dx = tmp.x - world.player.x;
    const dz = tmp.z - world.player.z;
    if (dx * dx + dz * dz > 0.04) aim = dirIndex(dx, dz);
  }
  const dash = dashQueued;
  dashQueued = false;
  return { move, aim, attack: mouseDown || keys.has("KeyJ"), dash };
}

window.addEventListener("keydown", (e) => {
  if (e.code === "Space" || e.code.startsWith("Arrow")) e.preventDefault();
  if (!e.repeat && (e.code === "Space" || e.code === "ShiftLeft" || e.code === "KeyK")) dashQueued = true;
  if (!e.repeat && e.code === "KeyR" && mode === "run") startRun();
  keys.add(e.code);
});
window.addEventListener("keyup", (e) => keys.delete(e.code));
window.addEventListener("blur", () => {
  keys.clear();
  mouseDown = false;
});
window.addEventListener("mousemove", (e) => {
  mouseX = e.clientX;
  mouseY = e.clientY;
});
const canvas = $<HTMLCanvasElement>("game");
canvas.addEventListener("mousedown", (e) => {
  if (e.button === 0) mouseDown = true;
  if (e.button === 2) dashQueued = true;
});
window.addEventListener("mouseup", (e) => {
  if (e.button === 0) mouseDown = false;
});
canvas.addEventListener("contextmenu", (e) => e.preventDefault());
window.addEventListener("resize", () => view.resize());

// hud
const hpFill = $("hp-fill");
const hpText = $("hp-text");
const dashPip = $("dash-pip");
const coinN = $("coin-n");
const circleEl = $("circle");
const waveEl = $("wave");
const banner = $("banner");
let bannerT = 0;

function showBanner(text: string, seconds = 2.2) {
  banner.textContent = text;
  banner.classList.add("show");
  bannerT = seconds;
}

function updateHud(dt: number) {
  const p = world.player;
  hpFill.style.width = `${(p.hp / p.maxHp) * 100}%`;
  hpText.textContent = `${Math.ceil(p.hp)} / ${p.maxHp}`;
  dashPip.classList.toggle("ready", p.dashCd <= 0);
  coinN.textContent = String(p.coins);
  circleEl.textContent = `CIRCLE ${ROMAN[world.floor - 1]} · ${CIRCLES[world.floor - 1].name}`;
  waveEl.textContent = world.phase === "cleared" ? "CLEARED" : `WAVE ${world.wave + 1}/${world.wavesInFloor}`;
  if (bannerT > 0) {
    bannerT -= dt;
    if (bannerT <= 0) banner.classList.remove("show");
  }
}

function showEnd(won: boolean) {
  ended = true;
  $("end-title").textContent = won ? "THE FIFTH CIRCLE IS BEHIND YOU" : "YOU FELL";
  $("end-sub").textContent = won
    ? "Four more wait below."
    : `Circle ${ROMAN[world.floor - 1]} · ${CIRCLES[world.floor - 1].name} keeps you.`;
  $("end-coins").textContent = `${world.player.coins} COIN`;
  $("end-kills").textContent = `${world.player.kills} SLAIN`;
  $("end").classList.remove("hidden");
}

function startRun() {
  const seed = (Date.now() ^ Math.floor(Math.random() * 0xffffffff)) >>> 0;
  world = createWorld(seed);
  replay = [];
  acc = 0;
  freeze = 0;
  ended = false;
  mode = "run";
  $("end").classList.add("hidden");
  $("hud").classList.remove("hidden");
  showBanner(`CIRCLE I · ${CIRCLES[0].name}`);
}

// menus
const embers = $("embers");
for (let i = 0; i < 46; i++) {
  const e = document.createElement("i");
  e.style.left = `${Math.random() * 100}%`;
  e.style.setProperty("--drift", `${(Math.random() - 0.5) * 220}px`);
  e.style.animationDuration = `${5 + Math.random() * 9}s`;
  e.style.animationDelay = `${-Math.random() * 12}s`;
  embers.appendChild(e);
}
$("play").addEventListener("click", () => $("landing").classList.add("up"));
$("mode-solo").addEventListener("click", () => {
  $("modes").classList.add("gone");
  startRun();
});
$("again").addEventListener("click", () => startRun());
$("to-menu").addEventListener("click", () => {
  mode = "menu";
  $("end").classList.add("hidden");
  $("hud").classList.add("hidden");
  $("modes").classList.remove("gone");
});

// main loop: fixed 60 Hz simulation, free-running render
let acc = 0;
let freeze = 0;
let last = performance.now();

function frame(now: number) {
  const dt = Math.min(0.1, (now - last) / 1000);
  last = now;
  if (mode === "run") {
    if (freeze > 0) freeze -= dt;
    else acc += dt;
    let n = 0;
    while (acc >= DT && n < 6 && freeze <= 0) {
      const input = readInput();
      replay.push(pack(input));
      step(world, input);
      acc -= DT;
      n++;
      if (world.events.length) {
        for (const e of world.events) {
          if (e.type === "floor") showBanner(`CIRCLE ${ROMAN[world.floor - 1]} · ${CIRCLES[world.floor - 1].name}`);
          if (e.type === "cleared") showBanner("THE WAY DOWN IS OPEN", 3);
        }
        freeze = Math.max(freeze, view.consume(world.events));
        world.events.length = 0;
      }
    }
    if (!ended && (world.phase === "dead" || world.phase === "won")) showEnd(world.phase === "won");
  }
  view.sync(world, dt);
  if (mode === "run") updateHud(dt);
  view.render();
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);

// handy while developing and for automated checks
(window as unknown as Record<string, unknown>).__game = {
  get world() {
    return world;
  },
  get replay() {
    return replay;
  },
  startRun,
  FLOORS,
};
