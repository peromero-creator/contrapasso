import { readFile, writeFile, mkdir, rename, rm } from "node:fs/promises";
import { execFileSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createHash } from "node:crypto";
import { dirname, resolve, extname, basename } from "node:path";
import { fileURLToPath } from "node:url";
import { NodeIO } from "@gltf-transform/core";
import { ALL_EXTENSIONS } from "@gltf-transform/extensions";
import { copyToDocument, dedup, prune, resample, unpartition, weld, meshopt, simplify } from "@gltf-transform/functions";
import { MeshoptEncoder, MeshoptDecoder, MeshoptSimplifier } from "meshoptimizer";

/** Pack local rig exports. No API calls, downloads or generation credits. */
export async function buildAssets(configFile) {
  await Promise.all([MeshoptEncoder.ready, MeshoptDecoder.ready]);
  const config = JSON.parse(await readFile(configFile, "utf8"));
  const root = dirname(resolve(configFile));
  const output = resolve(root, config.output ?? "public/assets");
  const io = new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({ "meshopt.encoder": MeshoptEncoder, "meshopt.decoder": MeshoptDecoder });
  const manifest = { version: 1, models: {}, floors: {} };
  await mkdir(resolve(output, "models"), { recursive: true });
  for (const [name, spec] of Object.entries(config.models ?? {})) {
    if (!/^[a-z][a-z0-9-]*$/.test(name)) throw new Error(`Invalid model name: ${name}`);
    const sourcePath = resolve(root, spec.source);
    const document = await io.read(sourcePath);
    const nodes = new Map();
    for (const node of document.getRoot().listNodes()) {
      const name = node.getName();
      if (!name) continue;
      if (nodes.has(name)) throw new Error(`Duplicate rig node: ${name}`);
      nodes.set(name, node);
    }
    for (const [name, clip] of Object.entries(spec.clips ?? {})) {
      const path = resolve(root, typeof clip === "string" ? clip : clip.file);
      const source = path === sourcePath ? document : await io.read(path);
      const clips = source.getRoot().listAnimations();
      const selected = typeof clip === "object" && typeof clip.clip === "string" ? clips.find(a => a.getName() === clip.clip) : clips[typeof clip === "object" && typeof clip.clip === "number" ? clip.clip : 0];
      if (!selected) throw new Error(`Missing ${name} animation in ${basename(path)}`);
      if (source === document) { selected.setName(name); continue; }
      const animation = document.createAnimation(name);
      for (const channel of selected.listChannels()) {
        const sourceNode = channel.getTargetNode();
        const target = nodes.get(sourceNode?.getName());
        if (!target) throw new Error(`${name}: no matching rig node '${sourceNode?.getName()}'`);
        // Clip exports must use the same rest pose; do not silently retarget an unrelated rig.
        const sourcePose = [...sourceNode.getTranslation(), ...sourceNode.getRotation(), ...sourceNode.getScale()];
        const targetPose = [...target.getTranslation(), ...target.getRotation(), ...target.getScale()];
        if (sourcePose.some((v, i) => Math.abs(v - targetPose[i]) > 0.001)) throw new Error(`${name}: rest pose differs at '${target.getName()}'`);
        const sampler = channel.getSampler();
        const map = copyToDocument(document, source, [sampler.getInput(), sampler.getOutput()]);
        const copy = document.createAnimationSampler().setInterpolation(sampler.getInterpolation()).setInput(map.get(sampler.getInput())).setOutput(map.get(sampler.getOutput()));
        animation.addSampler(copy);
        animation.addChannel(document.createAnimationChannel().setTargetNode(target).setTargetPath(channel.getTargetPath()).setSampler(copy));
      }
    }
    // Optional: shrink oversized textures (uses macOS `sips`; skipped when it is unavailable).
    if (spec.textureSize) {
      for (const texture of document.getRoot().listTextures()) {
        const size = texture.getSize();
        if (!size || Math.max(...size) <= spec.textureSize) continue;
        const extension = texture.getMimeType() === "image/png" ? "png" : "jpg";
        const scratch = join(tmpdir(), `contrapasso-texture-${process.pid}.${extension}`);
        try {
          await writeFile(scratch, texture.getImage());
          execFileSync("sips", ["-Z", String(spec.textureSize), ...(extension === "jpg" ? ["-s", "formatOptions", "85"] : []), scratch], { stdio: "ignore" });
          texture.setImage(await readFile(scratch));
        } catch {
          console.warn(`${name}: texture left at ${size.join("x")} (sips unavailable)`);
        } finally {
          await rm(scratch, { force: true });
        }
      }
    }
    for (const required of spec.requiredClips ?? []) if (!document.getRoot().listAnimations().some(a => a.getName() === required)) throw new Error(`${name}: required clip '${required}' is missing`);
    await document.transform(resample(), dedup(), prune(), unpartition(), weld());
    if (spec.simplify) {
      const { ratio, error } = spec.simplify;
      if (!(ratio > 0 && ratio <= 1 && error > 0 && error <= .01)) throw new Error(`${name}: invalid simplification limits`);
      await document.transform(simplify({ simplifier: MeshoptSimplifier, ratio, error }));
    }
    await document.transform(meshopt({ encoder: MeshoptEncoder, level: "medium" }));
    const binary = await io.writeBinary(document);
    const hash = createHash("sha256").update(binary).digest("hex").slice(0, 12);
    const file = `models/${name}-${hash}.glb`;
    await writeFile(resolve(output, `${file}.tmp`), binary);
    await rename(resolve(output, `${file}.tmp`), resolve(output, file));
    manifest.models[name] = { file: `/assets/${file}`, height: spec.height ?? 2.2, rotationY: spec.rotationY ?? 90, clips: document.getRoot().listAnimations().map(a => a.getName()), bytes: binary.byteLength, windows: spec.windows ?? {}, credit: spec.credit ?? null };
  }
  for (const [name, file] of Object.entries(config.floors ?? {})) {
    if (!["LIMBO", "LUST", "GLUTTONY", "GREED", "WRATH"].includes(name)) throw new Error(`Unknown circle: ${name}`);
    const extension = extname(file).toLowerCase();
    if (![".png", ".jpg", ".jpeg", ".webp"].includes(extension)) throw new Error(`Unsupported floor image: ${file}`);
    await mkdir(resolve(output, "floors"), { recursive: true });
    const image = await readFile(resolve(root, file));
    const hash = createHash("sha256").update(image).digest("hex").slice(0, 12);
    const target = `floors/${name.toLowerCase()}-${hash}${extension}`;
    await writeFile(resolve(output, `${target}.tmp`), image);
    await rename(resolve(output, `${target}.tmp`), resolve(output, target));
    manifest.floors[name] = `/assets/${target}`;
  }
  // Publish the manifest last so a failed build cannot point at half-written assets.
  await writeFile(resolve(output, "manifest.json.tmp"), JSON.stringify(manifest, null, 2) + "\n");
  await rename(resolve(output, "manifest.json.tmp"), resolve(output, "manifest.json"));
  return manifest;
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const manifest = await buildAssets(resolve(process.argv[2] ?? "art.config.json"));
  console.log(`Assets ready: ${Object.keys(manifest.models).length} models, ${Object.keys(manifest.floors).length} painted floors. Missing models use the original placeholders.`);
}
