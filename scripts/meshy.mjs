#!/usr/bin/env node
// Meshy helper for the art pipeline. Reads MESHY_API_KEY from .env and never prints it.
//   node scripts/meshy.mjs balance
//   node scripts/meshy.mjs library <words...>
//   node scripts/meshy.mjs character <image> <name> --actions 0,1,2 [--poly 15000] [--height 1.9]
//   node scripts/meshy.mjs prop <image> <name> [--poly 6000]
import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { extname } from "node:path";

const root = new URL("../", import.meta.url);
const envFile = new URL(".env", root);
const env = existsSync(envFile)
  ? Object.fromEntries(
      readFileSync(envFile, "utf8")
        .split("\n")
        .filter((l) => l.includes("=") && !l.trim().startsWith("#"))
        .map((l) => [l.slice(0, l.indexOf("=")).trim(), l.slice(l.indexOf("=") + 1).trim()]),
    )
  : {};
const KEY = process.env.MESHY_API_KEY || env.MESHY_API_KEY;
const API = "https://api.meshy.ai/openapi";
const OUT = new URL("art/source/", root);
const LOG = new URL("art/source/meshy-tasks.json", root);

function flag(name, fallback) {
  const i = process.argv.indexOf(`--${name}`);
  return i > 0 ? process.argv[i + 1] : fallback;
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function call(method, path, body) {
  if (!KEY) throw new Error("MESHY_API_KEY is missing from .env");
  const res = await fetch(`${API}${path}`, {
    method,
    headers: { Authorization: `Bearer ${KEY}`, "Content-Type": "application/json" },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`${method} ${path} -> ${res.status} ${text.slice(0, 400)}`);
  return text ? JSON.parse(text) : {};
}

async function wait(path, label) {
  let last = -1;
  for (;;) {
    let task;
    try {
      task = await call("GET", path);
    } catch (e) {
      console.log(`${label}: retrying after ${String(e.message).slice(0, 80)}`);
      await sleep(8000);
      continue;
    }
    if (task.progress !== last) {
      last = task.progress;
      console.log(`${label}: ${task.status} ${task.progress ?? 0}%`);
    }
    if (task.status === "SUCCEEDED") return task;
    if (task.status === "FAILED" || task.status === "CANCELED")
      throw new Error(`${label} ${task.status}: ${task.task_error?.message ?? ""}`);
    await sleep(6000);
  }
}

async function download(url, name) {
  mkdirSync(OUT, { recursive: true });
  const res = await fetch(url);
  if (!res.ok) throw new Error(`download ${name} -> ${res.status}`);
  const bytes = Buffer.from(await res.arrayBuffer());
  writeFileSync(new URL(name, OUT), bytes);
  console.log(`saved art/source/${name} (${(bytes.length / 1e6).toFixed(2)} MB)`);
}

function record(name, entry) {
  const all = existsSync(LOG) ? JSON.parse(readFileSync(LOG, "utf8")) : {};
  all[name] = { ...(all[name] ?? {}), ...entry };
  writeFileSync(LOG, JSON.stringify(all, null, 2) + "\n");
}

function dataUri(path) {
  const type = { ".jpg": "jpeg", ".jpeg": "jpeg", ".png": "png", ".webp": "webp" }[extname(path).toLowerCase()];
  if (!type) throw new Error("image must be jpg, png or webp");
  return `data:image/${type};base64,${readFileSync(path).toString("base64")}`;
}

async function imageTo3d(image, name, poly, pose) {
  const body = {
    image_url: dataUri(image),
    model_type: "smart-topology",
    ai_model: "meshy-t2.5",
    target_polycount: poly,
    should_texture: true,
  };
  if (pose) body.pose_mode = pose;
  const { result: id } = await call("POST", "/v1/image-to-3d", body);
  record(name, { image, imageTask: id });
  const task = await wait(`/v1/image-to-3d/${id}`, `${name} model`);
  record(name, { modelCredits: task.consumed_credits ?? null });
  return { id, task };
}

const [, , command, ...rest] = process.argv;
if (command === "balance") {
  console.log(await call("GET", "/v1/balance"));
} else if (command === "library") {
  const words = rest.map((w) => w.toLowerCase());
  const res = await fetch("https://api.meshy.ai/web/public/animations/resources");
  const json = await res.json();
  const list = Array.isArray(json) ? json : (json.result?.list ?? json.result ?? []);
  for (const a of list) {
    const text = `${a.name} ${a.category ?? ""} ${a.subCategory ?? a.subcategory ?? ""}`.toLowerCase();
    if (words.length === 0 || words.some((w) => text.includes(w)))
      console.log(`${String(a.action_id ?? a.id).padStart(4)}  ${a.name}  [${a.category ?? ""} / ${a.subCategory ?? a.subcategory ?? ""}]`);
  }
  console.log(`(${list.length} animations in the catalog)`);
} else if (command === "character") {
  const [image, name] = rest;
  const actions = String(flag("actions", "")).split(",").filter(Boolean).map(Number);
  const { id } = await imageTo3d(image, name, Number(flag("poly", 15000)), "a-pose");
  const { result: rigId } = await call("POST", "/v1/rigging", { input_task_id: id, height_meters: Number(flag("height", 1.9)) });
  record(name, { rigTask: rigId });
  const rig = await wait(`/v1/rigging/${rigId}`, `${name} rig`);
  await download(rig.result.rigged_character_glb_url, `${name}.glb`);
  if (actions.length) {
    const { result: animId } = await call("POST", "/v1/animations", { rig_task_id: rigId, action_ids: actions });
    record(name, { animationTask: animId, actions });
    const anim = await wait(`/v1/animations/${animId}`, `${name} animations`);
    await download(anim.result.animation_glb_url, `${name}-actions.glb`);
  }
  console.log(await call("GET", "/v1/balance"));
} else if (command === "animate") {
  const [rigId, name] = rest;
  const actions = String(flag("actions", "")).split(",").filter(Boolean).map(Number);
  const { result: animId } = await call("POST", "/v1/animations", { rig_task_id: rigId, action_ids: actions });
  record(name, { animationTask: animId, actions });
  const anim = await wait(`/v1/animations/${animId}`, `${name} animations`);
  await download(anim.result.animation_glb_url, `${name}-actions.glb`);
} else if (command === "prop") {
  const [image, name] = rest;
  const { task } = await imageTo3d(image, name, Number(flag("poly", 6000)), null);
  await download(task.model_urls.glb, `${name}.glb`);
  console.log(await call("GET", "/v1/balance"));
} else {
  console.log("usage: balance | library <words> | character <image> <name> --actions ids | animate <rigTaskId> <name> --actions ids | prop <image> <name>");
}
