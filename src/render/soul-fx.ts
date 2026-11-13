import { EffectAnchor, attachmentFor, isPassivePulse } from "./effect-anchor.ts";
import { ModelLibrary, type AnimatedModel } from "./assets";
import { mountGrip, starterWeapon } from "./weapon-pose";
import { dragonSoul, brokenCathedral, ritualPulse, ritualCharge, covenantWard, bloodThread, weaponImpact } from "./signatures";
import { previewVolley } from "./combat-motion";
import { weapon, type WeaponId } from "../sim/weapons";
import { TECHNIQUES, techniqueId, familyOf } from "../sim/techniques";
import * as T from "three";
import { CORES, CAST_TIME, CORE_TIME, abilityContact, type AbilityId } from "../sim/abilities";
import type { SimEvent, World } from "../sim/world";

// Matte, layered silhouettes: no additive bloom, full-screen flashes or strobing.
// Geometry is shared; at most 32 transient motifs and 4 trails per tick survive.
const guardModels = new ModelLibrary();
const colors = {
  lance: 0x9dc2c5,
  ember: CORES.ember.color,
  ash: CORES.ash.color,
  iron: CORES.iron.color,
};
const wispPlane = new T.PlaneGeometry(1.7,.65), sealPlane = new T.PlaneGeometry(2,2);
wispPlane.userData.sharedEffect = sealPlane.userData.sharedEffect = true;
const ring = new T.RingGeometry(0.89, 1, 64);
const shard = new T.PlaneGeometry(0.65, 2.4);
const lanceGeo = new T.ConeGeometry(0.1, 1.2, 5).rotateZ(-Math.PI / 2);
const thrownKnife = new T.BufferGeometry();
thrownKnife.setAttribute('position',new T.Float32BufferAttribute([-.28,0,-.055,.12,0,-.09,.58,0,0,.12,0,.09,-.28,0,.055],3));
thrownKnife.setIndex([0,1,2,0,2,3,0,3,4]);
const trailGeo = new T.PlaneGeometry(1.5, 0.1).rotateX(-Math.PI / 2);
const blade = new T.TorusGeometry(1, 0.035, 4, 32, Math.PI * 0.8);
const orbitBlade = new T.BufferGeometry();
const strip: number[] = [],
  indices: number[] = [];
for (let i = 0; i <= 32; i++) {
  const t = i / 32,
    a = t * 1.65,
    edge = 0.92,
    inner = edge - 0.16 * Math.sin(Math.PI * t);
  strip.push(
    Math.cos(a) * edge,
    0,
    Math.sin(a) * edge,
    Math.cos(a) * inner,
    0,
    Math.sin(a) * inner,
  );
  if (i < 32) {
    const j = i * 2;
    indices.push(j, j + 1, j + 2, j + 1, j + 3, j + 2);
  }
}
orbitBlade.setAttribute("position", new T.Float32BufferAttribute(strip, 3));
orbitBlade.setIndex(indices);
interface Motif {
  root: T.Group;
  life: number;
  max: number;
  radius: number;
  kind: AbilityId | "combo" | "trail";
  inward: boolean;
  travel?: boolean;
  speed?: number;
  contract?: boolean;
  sweep?: number;
  extend?: boolean;
  animate?: (t: number) => void;
  parts?: T.Mesh[];
  spinners?: T.Object3D[];
  anchor?: EffectAnchor;
}
export class SoulFx {
  private motifs: Motif[] = [];
  private guards: {actor: AnimatedModel; life: number; angle: number; enemy: boolean; anchor?: EffectAnchor; centerX?: number; centerZ?: number; materials:T.MeshStandardMaterial[]}[] = [];
  private guardLoad?: Promise<void>;
  private prepareGuards() {
    this.guardLoad ??= Promise.all(Array.from({length:4},()=>guardModels.create('hero',1.9))).then(actors=>{
      for(const actor of actors) if(actor) {
        const grip=new T.Group(), hand=actor.bone('RightHand');
        if(hand){mountGrip(hand,grip);grip.add(starterWeapon());}
        const materials=new Set<T.MeshStandardMaterial>();
        actor.root.traverse(n=>{if(n instanceof T.Mesh) {
          for(const material of (Array.isArray(n.material)?n.material:[n.material])) {
            if(material.side===T.BackSide){n.visible=false;continue;}
            if(material instanceof T.MeshStandardMaterial){materials.add(material);material.map=null;material.color.setHex(0x9aada4);material.emissive.setHex(0x263830);material.emissiveIntensity=.3;material.transparent=true;material.depthWrite=false;material.opacity=.24;material.needsUpdate=true;}
          }
        }});
        actor.root.visible=false;this.root.add(actor.root);this.guards.push({actor,life:0,angle:0,enemy:false,materials:[...materials]});
      }
    });
    return this.guardLoad;
  }
  prepare() { return this.prepareGuards(); }
  private root = new T.Group();
  private time = 0;
  private ward = covenantWard();
  private core = new T.Mesh(
    new T.OctahedronGeometry(0.11),
    new T.MeshBasicMaterial({ color: 0xcba670 }),
  );
  private seal: T.CanvasTexture;
  private flame: T.CanvasTexture;
  private wisp: T.CanvasTexture;
  private trackActors: boolean;
  constructor(scene: T.Scene, trackActors = false) {
    this.trackActors = trackActors;
    scene.add(this.root);
    this.root.add(this.ward, this.core);
    const c = document.createElement("canvas");
    c.width = c.height = 512;
    const g = c.getContext("2d")!;
    g.translate(256, 256);
    g.strokeStyle = "#d2bc96";
    g.lineWidth = 3;
    for (const r of [163, 190, 230]) {
      g.beginPath();
      g.arc(0, 0, r, 0, Math.PI * 2);
      g.stroke();
    }
    for (let i = 0; i < 12; i++) {
      g.save();
      g.rotate((i * Math.PI) / 6);
      g.beginPath();
      g.moveTo(-7, -200);
      g.lineTo(0, -222);
      g.lineTo(7, -200);
      g.moveTo(0, -207);
      g.lineTo(0, -187);
      g.stroke();
      g.restore();
    }
    g.beginPath();
    for (let i = 0; i < 6; i++) {
      const a = (i * Math.PI * 4) / 5 - Math.PI / 2;
      g.lineTo(Math.cos(a) * 160, Math.sin(a) * 160);
    }
    g.stroke();
    const flame = document.createElement("canvas");
    flame.width = 256;
    flame.height = 512;
    const f = flame.getContext("2d")!;
    // Painted tapered tongues with transparent edges, not geometric spikes.
    for (let layer = 0; layer < 4; layer++) {
      const inset = layer * 18;
      const gradient = f.createLinearGradient(0, 500, 0, 15 + layer * 65);
      gradient.addColorStop(0, "rgba(88,32,24,0)");
      gradient.addColorStop(0.16, "rgba(166,67,38,.48)");
      gradient.addColorStop(
        0.5,
        layer > 1 ? "rgba(224,165,92,.72)" : "rgba(192,94,45,.50)",
      );
      gradient.addColorStop(1, "rgba(190,105,66,0)");
      f.fillStyle = gradient;
      f.beginPath();
      f.moveTo(40 + inset, 490);
      f.bezierCurveTo(20 + inset, 350, 160, 320, 85 + inset, 190);
      f.bezierCurveTo(150, 240, 110, 80, 158, 12 + layer * 60);
      f.bezierCurveTo(115, 190, 245 - inset, 230, 196 - inset, 350);
      f.bezierCurveTo(230 - inset, 420, 190 - inset, 475, 178 - inset, 490);
      f.closePath();
      f.fill();
    }
    const ink=document.createElement('canvas');ink.width=256;ink.height=96;
    const brush=ink.getContext('2d')!;
    for(let i=0;i<3;i++) {
      const fade=brush.createLinearGradient(12,0,244,0);
      fade.addColorStop(0,'rgba(255,255,255,0)');fade.addColorStop(.65,`rgba(255,255,255,${.38+i*.12})`);fade.addColorStop(1,'rgba(255,255,255,.05)');
      brush.fillStyle=fade;brush.beginPath();brush.moveTo(12,48+i*8);
      brush.bezierCurveTo(70,8+i*10,180,22+i*8,244,48);
      brush.bezierCurveTo(178,42+i*5,95,48+i*9,12,48+i*8);brush.fill();
    }
    this.wisp=new T.CanvasTexture(ink);this.wisp.colorSpace=T.SRGBColorSpace;
    this.flame = new T.CanvasTexture(flame);
    this.flame.colorSpace = T.SRGBColorSpace;
    this.seal = new T.CanvasTexture(c);
    this.seal.colorSpace = T.SRGBColorSpace;

  }
  private part(
    root: T.Group,
    geo: T.BufferGeometry,
    color: number,
    opacity = 0.55,
  ) {
    const m = new T.Mesh(
      geo,
      new T.MeshBasicMaterial({
        color,
        transparent: true,
        opacity,
        depthWrite: false,
        side: T.DoubleSide,
        forceSinglePass: true,
      }),
    );
    root.add(m);
    m.userData.alpha = opacity;
    return m;
  }
  event(e: SimEvent, identity: WeaponId = "starter") {
    const mode = this.trackActors ? attachmentFor(e, identity) : null;
    const existing = mode ? new Set(this.motifs) : null;
    this.emit(e, identity);
    if (mode && existing) for (const motif of this.motifs) {
      if (!existing.has(motif)) motif.anchor = new EffectAnchor(e, mode);
    }
  }
  private emit(e: SimEvent, identity: WeaponId) {
    if (this.trackActors && isPassivePulse(e)) { this.passivePulse(e); return; }
    if (e.type === 'swing' || e.type === 'ranged') { this.strike(e, identity); return; }
    if (e.type !== "ability" && e.type !== "combo" && e.type !== "echo") return;
    if (e.ability && e.stage !== 'charge' && e.stage !== 'release' && previewVolley(e.ability, identity)) { this.volley(e, identity); return; }
    if (e.ability === 'lance' && e.stage === 'release') { this.volley(e, identity); return; }
    if (e.ability === "siphon-spell") { this.thread(e); return; }
    if(e.ability==='lance'&&e.stage==='charge') {
      const sig=ritualCharge(e.side==='enemy'?0xb15b64:0x91b7b8),life=abilityContact('lance');
      sig.root.position.set(e.x,.04,e.z);this.root.add(sig.root);
      this.motifs.push({root:sig.root,life,max:life,radius:1,kind:'combo',inward:false,animate:sig.animate});
      while(this.motifs.length>32)this.dispose(this.motifs.shift()!);
      return;
    }
    if(e.type==='ability' && e.ability && ['ember','iron','ash','nova-spell','staff-2','staff-3'].includes(e.ability)) {
      if(e.ability==='ash') this.prepareGuards();
      if(e.stage==='release' && e.ability!=='nova-spell')return; // Cores/techniques hit on pulse; spells hit on release.
      const charge=e.stage==='charge', id=e.ability;
      const kind=id==='iron'?'covenant':id==='ash'?'orbit':id==='staff-3'?'harvest':'furnace';
      const color=e.side==='enemy'?0xb15b64:kind==='furnace'?0xb4794d:kind==='covenant'?0xb27e8c:0x8eaaa8;
      const radius=e.amount ?? (id==='iron'?5:id==='ash'||id==='staff-3'?4.5:id==='ember'?3.5:4);
      const sig=charge?ritualCharge(color):ritualPulse(kind,radius,color,this.flame);
      const life=charge?abilityContact(id):kind==='orbit'?.48:kind==='furnace'?.62:.7;
      sig.root.position.set(e.x,.04,e.z);this.root.add(sig.root);
      this.motifs.push({root:sig.root,life,max:life,radius:1,kind:'combo',inward:false,animate:sig.animate});
      if(!charge&&id==='ash')this.procession(e);
      if(!charge&&id==='ember')this.cathedral(e);
      while(this.motifs.length>32)this.dispose(this.motifs.shift()!);
      return;
    }
    if(e.ability==='hammer-4' && e.stage==='pulse') this.cathedral(e);
    const visualAbility = e.ability === "nova-spell" ? "ember" : e.ability;
    const technique = techniqueId(e.ability);
    if (technique) { this.technique(e, technique); return; }
    const kind =
      e.type === "combo" ? "combo" : e.type === "echo" ? "ash" : visualAbility as keyof typeof colors;
    const color =
      e.side === "enemy"
        ? 0xb15b64
        : kind === "combo"
          ? 0xb9a281
          : colors[kind];
    const root = new T.Group();
    root.position.set(e.x, 0.06, e.z);
    const charge = e.stage === "charge",
      lance = kind === "lance";
    const max = charge
      ? lance || e.ability === "nova-spell"
        ? CAST_TIME
        : CORE_TIME
      : kind === "combo"
        ? 0.4
        : kind === "ash" ? .46 : .72;
    const radius =
      e.amount ?? (e.ability === "nova-spell" ? 4 : undefined) ??
      (lance
        ? 1.2
        : charge
          ? 1.6
          : kind === "ash"
            ? 4.5
            : kind === "iron"
              ? 5
              : 3.5);
    if (lance && !charge) {
      root.rotation.y = (-(e.dir ?? 0) * Math.PI * 2) / 1024;
      for (const angle of [-0.17, 0, 0.17]) {
        const bolt = new T.Group();
        bolt.rotation.y = angle;
        root.add(bolt);
        const point = this.part(bolt, lanceGeo, color, 0.85);
        point.position.set(0.6, 0.95, 0);
        const trail = this.part(bolt, trailGeo, color, 0.4);
        trail.position.set(-0.5, 0.95, 0);
      }
    } else if (kind === "combo") {
      root.rotation.y = (-(e.dir ?? 0) * Math.PI * 2) / 1024;
      for (let i = 0; i < 3; i++) {
        const m = this.part(root, blade, color, 0.5 - i * 0.1);
        m.rotation.x = -Math.PI / 2;
        m.position.set(0.6, 0.5 + i * 0.13, 0);
        m.scale.setScalar(1.7 + i * 0.25);
      }
    } else {
      const glyph = this.part(
        root,
        new T.PlaneGeometry(2, 2),
        color,
        charge ? 0.35 : kind === "ash" ? .06 : 0.2,
      );
      (glyph.material as T.MeshBasicMaterial).map = this.seal;
      glyph.rotation.x = -Math.PI / 2;
      for (let i = 0; i < (kind === "ash" ? 3 : lance ? 6 : 12); i++) {
        const a = (i * Math.PI * 2) / (kind === "ash" ? 3 : lance ? 6 : 12),
          m = this.part(
            root,
            kind === "ash" ? orbitBlade : shard,
            kind === "ember" ? 0xffffff : color,
            kind === "ember" ? 0.42 : 0.23,
          );
        m.position.set(Math.cos(a) * 0.8, 0.15, Math.sin(a) * 0.8);
        if (kind === "ash") {
          m.position.set(0, 0.65, 0);
          m.rotation.y = a;
        } else {
          (m.material as T.MeshBasicMaterial).map = this.flame;
          m.rotation.z = kind === "iron" ? Math.PI : 0;
          m.scale.set(0.7, 0.55 + (i % 3) * 0.2, 0.7);
          m.position.y = 0.7;
        }
      }
      const rim = this.part(root, ring, color, kind === "ember" ? 0.1 : kind === "ash" ? .07 : .2);
      rim.rotation.x = -Math.PI / 2;
      rim.position.y = 0.02;
    }
    this.root.add(root);
    this.motifs.push({
      root,
      life: max,
      max,
      radius,
      kind,
      inward: charge || kind === "iron",
      travel: lance && !charge,
    });
    while (this.motifs.length > 32) this.dispose(this.motifs.shift()!);
  }
  /** A passive trigger is a small painted echo, never another cathedral or guard summon. */
  private passivePulse(e: SimEvent) {
    const root = new T.Group(), radius = e.amount ?? 2.5;
    const color = e.ability === 'ember' ? 0xa77551 : e.ability === 'iron' ? 0xa36b79 : 0x829c9b;
    root.position.set(e.x,.045,e.z);
    const rim = this.part(root, ring, color, .16);
    rim.rotation.x=-Math.PI/2;rim.scale.setScalar(radius);
    for(let i=0;i<3;i++) {
      const accent = this.part(root, e.ability === 'ember' ? shard : orbitBlade, color, .24);
      const angle=i*Math.PI*2/3;
      accent.position.set(Math.cos(angle)*radius*.55,.3,Math.sin(angle)*radius*.55);
      if(e.ability === 'ember') { (accent.material as T.MeshBasicMaterial).map=this.flame;accent.scale.set(.8,.45,1); }
      else { accent.rotation.x=-Math.PI/2;accent.scale.setScalar(.7); }
    }
    this.root.add(root);
    this.motifs.push({root,life:.32,max:.32,radius:1,kind:'combo',inward:false,animate:t=>root.scale.setScalar(.65+.35*t)});
    while(this.motifs.length>32)this.dispose(this.motifs.shift()!);
  }
  private procession(e: SimEvent) {
    for(let i=0;i<2;i++) {
      const guard=this.guards.find(g=>g.life<=0);if(!guard)break;
      const a=this.time*1.7+i*Math.PI;
      guard.life=.62;guard.angle=a;guard.enemy=e.side==='enemy';
      guard.anchor=this.trackActors?new EffectAnchor(e,'wielder'):undefined;
      guard.centerX=e.x;guard.centerZ=e.z;
      guard.actor.root.position.set(e.x+Math.cos(a)*2.6,-.18,e.z+Math.sin(a)*2.6);
      guard.actor.root.rotation.y=-a-Math.PI/2;guard.actor.root.visible=true;
      guard.actor.play('attack',.62,true);
    }
  }
  private cathedral(e: SimEvent) {
    const sig=brokenCathedral(e.amount??4.5,e.side==='enemy'?0xb15b64:0xb99769);
    sig.root.position.set(e.x,.03,e.z);this.root.add(sig.root);
    this.motifs.push({root:sig.root,life:.7,max:.7,radius:1,kind:'combo',inward:false,animate:sig.animate});
  }
  private thread(e: SimEvent) {
    const charge=e.stage==='charge',color=e.side==='enemy'?0xa95766:0xbc7b88;
    const sig=charge?ritualCharge(color):bloodThread(color),life=charge?abilityContact('siphon-spell'):.65;
    sig.root.position.set(e.x,.1,e.z);sig.root.rotation.y=-(e.dir??0)*Math.PI*2/1024;
    this.root.add(sig.root);
    this.motifs.push({root:sig.root,life,max:life,radius:1,kind:'combo',inward:false,animate:sig.animate});
    while(this.motifs.length>32)this.dispose(this.motifs.shift()!);
  }
  private strike(e: SimEvent, identity: WeaponId) {
    const spec=weapon(identity),root=new T.Group(),heavy=e.amount===2;
    root.position.set(e.x,.08,e.z);root.rotation.y=-(e.dir??0)*Math.PI*2/1024;
    const color=spec.color,reach=spec.reach+(identity==='acheron-needle'&&heavy?1.2:0);
    if(!spec.ranged) {
      const family=familyOf(identity),pattern=family==='spear'?'line':family==='hammer'?'burst':'arc';
      const sig=weaponImpact(family,pattern,reach,color);sig.root.position.copy(root.position);sig.root.rotation.copy(root.rotation);
      this.root.add(sig.root);
      const life=family==='dagger'?.13:family==='hammer'?.32:.23;
      this.motifs.push({root:sig.root,life,max:life,radius:1,kind:'combo',inward:false,animate:sig.animate});
      while(this.motifs.length>32)this.dispose(this.motifs.shift()!);
      return;
    }
    const curl=this.part(root,orbitBlade,color,.3);
    curl.position.set(.75,.95,0);curl.scale.setScalar(spec.ranged==='bolt'?.28:heavy?.65:.42);
    curl.rotation.x=Math.PI/2;
    const life=.22;
    this.root.add(root);
    this.motifs.push({root,life,max:life,radius:1,kind:'combo',inward:false});
    while(this.motifs.length>32)this.dispose(this.motifs.shift()!);
  }
  private volley(e: SimEvent, identity: WeaponId) {
    const volley = previewVolley(e.ability!, identity)!;
    const root = new T.Group(); root.position.set(e.x, .08, e.z);
    root.rotation.y = -(e.dir ?? 0) * Math.PI * 2 / 1024;
    const staff = e.ability === 'lance' || e.ability?.startsWith('staff');
    const dagger=e.ability==='dagger-2',spinners:T.Object3D[]=[];
    const color = e.side === 'enemy' ? 0xb15b64 : staff ? 0x91b7b8 : 0xc0ac8b;
    for (let i = 0; i < volley.count; i++) {
      const dart = new T.Group(), angle = (i - (volley.count - 1) / 2) * volley.step;
      dart.rotation.y = -angle; dart.position.set(Math.cos(angle)*.7, 1.3, Math.sin(angle)*.7);
      if(staff) {
        if(e.ability==='staff-4') dragonSoul(dart,color);
        const plume=this.part(dart,wispPlane,color,.68);
        (plume.material as T.MeshBasicMaterial).map=this.wisp;
        plume.rotation.x=-Math.PI/2;plume.position.x=-.25;
        const thread=this.part(dart,orbitBlade,color,.3);thread.scale.set(.7,1,.14);thread.rotation.y=Math.PI;thread.position.x=-.25;
      } else if(dagger) {
        const knife=this.part(dart,thrownKnife,0xb9b8a1,.7);spinners.push(knife);
        const wake=this.part(dart,trailGeo,0x94aa99,.2);wake.position.x=-.45;wake.scale.x=.45;
      } else {
        const tip=this.part(dart,lanceGeo,color,.55);tip.scale.set(.65,.45,.45);
        const tail=this.part(dart,trailGeo,color,.22);tail.position.x=-.55;tail.scale.x=.7;
      }
      root.add(dart);
    }
    this.root.add(root);
    const life = volley.reach / volley.speed;
    this.motifs.push({root,life,max:life,radius:1,kind:'combo',inward:false,travel:true,speed:volley.speed,spinners});
    while(this.motifs.length>32)this.dispose(this.motifs.shift()!);
  }
  private technique(e: SimEvent, id: import('../sim/techniques').TechniqueId) {
    if (e.stage === 'release') return;
    const spec = TECHNIQUES[id], charge = e.stage === 'charge', staff = id.startsWith('staff'), hammer = id.startsWith('hammer');
    const root = new T.Group(); root.position.set(e.x, .08, e.z);
    root.rotation.y = -(e.dir ?? 0) * Math.PI * 2 / 1024;
    const color = e.side === 'enemy' ? 0xb15b64 : staff ? id === 'staff-2' ? 0xb77d53 : 0x8db2b3 : id.startsWith('dagger') ? 0x9eae8f : id.startsWith('axe') ? 0xb66e59 : 0xc4ad88;
    if(!charge&&!staff) {
      const family=id.split('-')[0],sig=weaponImpact(family,spec.pattern,spec.reach,color);
      sig.root.position.copy(root.position);sig.root.rotation.copy(root.rotation);
      this.root.add(sig.root);
      const life=hammer?.55:family==='dagger'?.22:family==='spear'?.25:family==='axe'?.4:.3;
      this.motifs.push({root:sig.root,life,max:life,radius:1,kind:'combo',inward:false,contract:!!spec.pull,animate:sig.animate});
      while(this.motifs.length>32)this.dispose(this.motifs.shift()!);
      return;
    }
    if (charge && staff) {
      const sig=ritualCharge(color),life=spec.contact;
      sig.root.position.copy(root.position);sig.root.rotation.copy(root.rotation);this.root.add(sig.root);
      this.motifs.push({root:sig.root,life,max:life,radius:1,kind:'combo',inward:false,animate:sig.animate});
      while(this.motifs.length>32)this.dispose(this.motifs.shift()!);
      return;
    }
    // Only windup reaches this path; damaging contacts have distinct family strokes.
    const seal=this.part(root,sealPlane,color,.18);
    (seal.material as T.MeshBasicMaterial).map=this.seal;seal.rotation.x=-Math.PI/2;
    this.root.add(root);
    const life=spec.contact;
    this.motifs.push({root,life,max:life,radius:1,kind:'combo',inward:false});
    while(this.motifs.length>32)this.dispose(this.motifs.shift()!);
  }
  private dispose(m: Motif) {
    this.root.remove(m.root);
    m.root.traverse((n) => {
      if (n instanceof T.Mesh) {
        n.material.dispose();
        if (
          !n.geometry.userData.sharedEffect && ![ring, shard, blade, orbitBlade, lanceGeo, trailGeo, thrownKnife].includes(
            n.geometry,
          )
        )
          n.geometry.dispose();
      }
    });
  }
  clear() {
    for (const m of this.motifs) this.dispose(m);
    this.motifs = [];
    for(const guard of this.guards){guard.life=0;guard.actor.root.visible=false;}
  }
  sync(w: World, dt: number, hero = { x: w.player.x, z: w.player.z }) {
    this.time += dt;
    for(const guard of this.guards) {
      if(guard.life<=0)continue;
      if (guard.anchor) {
        const owner = guard.anchor.position(w, hero);
        if (!owner) { guard.life=0;guard.actor.root.visible=false;continue; }
        guard.actor.root.position.x += owner.x - guard.centerX!;
        guard.actor.root.position.z += owner.z - guard.centerZ!;
        guard.centerX=owner.x;guard.centerZ=owner.z;
      }
      guard.life-=dt;const t=1-Math.max(0,guard.life)/.62;
      guard.actor.root.visible=guard.life>0;
      guard.actor.root.position.y=-.18+.22*Math.sin(t*Math.PI);
      guard.actor.root.position.x-=Math.sin(guard.angle)*dt*1.1;
      guard.actor.root.position.z+=Math.cos(guard.angle)*dt*1.1;
      guard.actor.update(dt,{weapon:'starter',elapsed:t*.2,combo:1});
      for(const material of guard.materials) {
        material.opacity=.29*Math.sin(Math.PI*t)**.6;
        material.color.setHex(guard.enemy?0xb98087:0x9aada4);
      }
    }
    const p = w.player;
    this.core.visible = !!p.core && w.phase !== "dead";
    this.core.position.set(hero.x, 1.25, hero.z + 0.15);
    this.core.rotation.y = this.time;
    this.core.material.color.setHex(p.core ? CORES[p.core].color : 0x888888);
    this.core.scale.setScalar(0.7 + p.charge / 130);
    this.ward.visible = p.wardT > 0;
    this.ward.position.set(hero.x, 0, hero.z);
    this.ward.rotation.y = this.time * 0.4;
    for (const m of this.motifs) {
      if (m.anchor) {
        const owner = m.anchor.position(w, hero);
        if (!owner) { m.life=0;continue; }
        m.root.position.x=owner.x;m.root.position.z=owner.z;
      }
      m.life = m.anchor?.chargeRemaining(w) ?? m.life - dt;
      const t = 1 - Math.max(0, m.life) / m.max;
      m.animate?.(t);
      for(const spinner of m.spinners??[])spinner.rotation.y+=dt*16;
      if (m.sweep) m.root.rotation.y += m.sweep * dt;
      if (m.contract) m.root.scale.set(1-.85*t,1,1-.85*t);
      if (m.extend) m.root.scale.x = .55 + .45 * (1 - (1 - t) ** 3);
      if (m.travel) {
        for (const b of m.root.children) {
          b.position.x += Math.cos(b.rotation.y) * dt * (m.speed ?? 8);
          b.position.z -= Math.sin(b.rotation.y) * dt * (m.speed ?? 8);
        }
      } else if (m.kind !== "combo") {
        const size = m.inward
          ? m.radius * (1 - 0.55 * t)
          : m.radius * (0.25 + 0.75 * (1 - (1 - t) ** 3));
        m.root.scale.set(size, 1, size);
        m.root.rotation.y += (m.kind === "ash" ? 2.8 : 0.16) * dt;
      }
      if(!m.parts){m.parts=[];m.root.traverse(n=>{if(n instanceof T.Mesh)m.parts!.push(n);});}
      for(const n of m.parts) {
        (n.material as T.MeshBasicMaterial).opacity=n.userData.alpha*(n.userData.fade??(1-t)**.7);
        if(n.geometry===shard)n.position.y=.6+Math.sin(t*Math.PI)*(m.kind==='ember'?.5:.3);
      }
    }
    for (const m of this.motifs) if (m.life <= 0) this.dispose(m);
    this.motifs = this.motifs.filter((m) => m.life > 0);
  }
}
