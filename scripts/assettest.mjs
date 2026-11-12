import assert from "node:assert/strict";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Document, NodeIO } from "@gltf-transform/core";
import { ALL_EXTENSIONS } from "@gltf-transform/extensions";
import { MeshoptDecoder } from "meshoptimizer";
import { buildAssets } from "./assets.mjs";

const folder = await mkdtemp(join(tmpdir(), "contrapasso-assets-"));
try {
  const io = new NodeIO();
  const base = new Document(); const buffer = base.createBuffer();
  const positions = base.createAccessor().setType("VEC3").setArray(new Float32Array([0,0,0, 1,0,0, 0,1,0])).setBuffer(buffer);
  const mesh = base.createMesh().addPrimitive(base.createPrimitive().setAttribute("POSITION", positions));
  const root = base.createNode("Root").setMesh(mesh); base.createScene().addChild(root);
  await io.write(join(folder, "base.glb"), base);
  const clip = new Document(); const clipBuffer = clip.createBuffer(); const node = clip.createNode("Root"); clip.createScene().addChild(node);
  const times = clip.createAccessor().setType("SCALAR").setArray(new Float32Array([0, 1])).setBuffer(clipBuffer);
  const values = clip.createAccessor().setType("VEC3").setArray(new Float32Array([0,0,0, 0,0.5,0])).setBuffer(clipBuffer);
  const sampler = clip.createAnimationSampler().setInput(times).setOutput(values);
  clip.createAnimation("Export").addSampler(sampler).addChannel(clip.createAnimationChannel().setTargetNode(node).setTargetPath("translation").setSampler(sampler));
  await io.write(join(folder, "run.glb"), clip);
  const config = { output: "packed", models: { hero: { source: "base.glb", clips: { run: "run.glb" }, requiredClips: ["run"] } } };
  const file = join(folder, "config.json"); await writeFile(file, JSON.stringify(config));
  const manifest = await buildAssets(file); assert.ok(manifest.models.hero.bytes > 0); assert.deepEqual(manifest.models.hero.clips, ["run"]);
  await MeshoptDecoder.ready;
  const packed = await new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({ "meshopt.decoder": MeshoptDecoder }).read(join(folder, "packed", manifest.models.hero.file.replace("/assets/", "")));
  assert.equal(packed.getRoot().listMeshes().length, 1);
  assert.equal(packed.getRoot().listAnimations()[0].listChannels()[0].getTargetNode().getName(), "Root");
  assert.ok(packed.getRoot().listExtensionsRequired().some(ext => ext.extensionName === "EXT_meshopt_compression"));
  config.models.hero.requiredClips = ["idle"]; await writeFile(file, JSON.stringify(config));
  await assert.rejects(buildAssets(file), /required clip/);
  node.setName("DifferentRig"); await io.write(join(folder, "run.glb"), clip);
  config.models.hero.requiredClips = []; await writeFile(file, JSON.stringify(config));
  await assert.rejects(buildAssets(file), /matching rig node/);
  console.log("Asset pipeline: PASS (clip merge, shared rig, web compression, missing clips, incompatible rig)");
} finally { await rm(folder, { recursive: true, force: true }); }
