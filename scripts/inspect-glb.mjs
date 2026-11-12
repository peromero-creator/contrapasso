import { NodeIO } from "@gltf-transform/core";
import { ALL_EXTENSIONS } from "@gltf-transform/extensions";
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS);
for (const file of process.argv.slice(2)) {
  const doc = await io.read(file);
  const root = doc.getRoot();
  console.log("==", file);
  let verts = 0, tris = 0;
  for (const m of root.listMeshes()) for (const p of m.listPrimitives()) { verts += p.getAttribute("POSITION").getCount(); tris += (p.getIndices()?.getCount() ?? 0) / 3; }
  console.log(" meshes", root.listMeshes().length, "verts", verts, "tris", tris, "materials", root.listMaterials().length);
  for (const t of root.listTextures()) console.log(" texture", t.getName() || t.getURI(), t.getMimeType(), (t.getImage()?.byteLength / 1e6).toFixed(2) + "MB", t.getSize()?.join("x"));
  for (const s of root.listSkins()) console.log(" skin joints", s.listJoints().length, s.listJoints().slice(0, 30).map((j) => j.getName()).join(","));
  const scene = root.listScenes()[0];
  console.log(" scene roots:", scene.listChildren().map((n) => `${n.getName()} t=${n.getTranslation().map((v) => v.toFixed(2))} s=${n.getScale().map((v) => v.toFixed(3))} r=${n.getRotation().map((v) => v.toFixed(2))}`).join(" | "));
  let min = [1e9, 1e9, 1e9], max = [-1e9, -1e9, -1e9];
  for (const m of root.listMeshes()) for (const p of m.listPrimitives()) { const a = p.getAttribute("POSITION"); const lo = a.getMin([]), hi = a.getMax([]); for (let i = 0; i < 3; i++) { min[i] = Math.min(min[i], lo[i]); max[i] = Math.max(max[i], hi[i]); } }
  console.log(" local bbox min", min.map((v) => v.toFixed(2)), "max", max.map((v) => v.toFixed(2)));
  for (const a of root.listAnimations()) {
    let dur = 0; let rootMove = "";
    for (const c of a.listChannels()) {
      const s = c.getSampler(); const t = s.getInput().getArray(); dur = Math.max(dur, t[t.length - 1]);
      const node = c.getTargetNode();
      if (c.getTargetPath() === "translation" && node && /hips|root|pelvis/i.test(node.getName())) {
        const o = s.getOutput(); const first = o.getElement(0, []), last = o.getElement(o.getCount() - 1, []);
        let far = 0; for (let i = 0; i < o.getCount(); i++) { const e = o.getElement(i, []); far = Math.max(far, Math.hypot(e[0] - first[0], e[2] - first[2])); }
        rootMove += ` ${node.getName()}: end-start=(${(last[0] - first[0]).toFixed(2)},${(last[1] - first[1]).toFixed(2)},${(last[2] - first[2]).toFixed(2)}) maxXZ=${far.toFixed(2)}`;
      }
    }
    console.log(` clip "${a.getName()}" ${dur.toFixed(2)}s channels=${a.listChannels().length}${rootMove}`);
  }
}
