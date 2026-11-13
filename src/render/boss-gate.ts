import * as THREE from 'three';
import { ARENA_HZ, BOSS_GATE, bossAvailable, type World } from '../sim/world';

// Painted geometry: the silhouette and hinged leaves share one Flow illustration.
// Four opaque draws plus two soft ground shadows; no lights, particles or per-frame geometry.
// The painting itself is never altered: it is only seated in the room with shade and the circle's light.
export class BossGate {
  readonly root = new THREE.Group();
  private leaves: THREE.Group[] = [];
  private opening = 0;
  private material: THREE.MeshBasicMaterial;
  private tint = new THREE.Color(0xffffff);
  readonly ready: Promise<void>;
  /** Let the unlit painting take a little of the room's light so it belongs to each circle. */
  setTint(light: number) {
    this.material.color.copy(this.tint.set(0xffffff).lerp(new THREE.Color(light), 0.3)).multiplyScalar(0.94);
  }
  constructor() {
    this.root.position.set(BOSS_GATE.x, 0, -ARENA_HZ);
    const material = this.material = new THREE.MeshBasicMaterial({color:0xffffff, side:THREE.DoubleSide});
    this.ready = new THREE.TextureLoader().loadAsync('/art/penitent-gate.jpg').then(texture=>{
      texture.colorSpace=THREE.SRGBColorSpace; texture.anisotropy=4;
      material.map=texture; material.needsUpdate=true;
    });
    const point=([u,v]:number[])=>new THREE.Vector2((u-.5)*10.75,(.98-v)*6.3);
    const outer=[[.275,.98],[.29,.88],[.295,.53],[.28,.44],[.31,.35],[.32,.24],[.35,.28],[.39,.15],[.45,.10],[.445,.02],[.48,.09],[.5,.045],[.53,.09],[.555,.02],[.55,.10],[.61,.15],[.65,.28],[.68,.24],[.69,.35],[.72,.44],[.705,.53],[.71,.88],[.725,.98]];
    const inner=[[.355,.95],[.355,.39],[.39,.29],[.44,.22],[.5,.19],[.56,.22],[.61,.29],[.645,.39],[.645,.95]];
    const geometry=(shape:THREE.Shape)=>{const g=new THREE.ShapeGeometry(shape);const pos=g.attributes.position;const uv=g.attributes.uv;for(let i=0;i<pos.count;i++)uv.setXY(i,pos.getX(i)/10.75+.5,1-(.98-pos.getY(i)/6.3));return g;};
    const frame=new THREE.Shape(outer.map(point));frame.holes.push(new THREE.Path(inner.map(point)));
    this.root.add(new THREE.Mesh(geometry(frame),material));
    const dark=new THREE.Mesh(geometry(new THREE.Shape(inner.map(point))),new THREE.MeshBasicMaterial({color:0x030303,side:THREE.DoubleSide}));dark.position.z=-.04;this.root.add(dark);
    for(const side of [-1,1]){
      const points= side<0 ? [[.355,.95],[.355,.39],[.39,.29],[.44,.22],[.5,.19],[.5,.95]] : [[.5,.95],[.5,.19],[.56,.22],[.61,.29],[.645,.39],[.645,.95]];
      const pivot=new THREE.Group();const hinge=side*.145*10.75;
      const g=geometry(new THREE.Shape(points.map(point)));g.translate(-hinge,0,0);
      pivot.add(new THREE.Mesh(g,material));pivot.position.set(hinge,0,.015);this.root.add(pivot);this.leaves.push(pivot);
    }
    // Grounding: a contact shadow where the jambs meet the floor, and a pocket of
    // darkness behind the arch so the bone frame reads against depth, not open ground.
    const canvas=document.createElement('canvas');canvas.width=canvas.height=128;
    const ink=canvas.getContext('2d')!,fade=ink.createRadialGradient(64,64,6,64,64,64);
    fade.addColorStop(0,'rgba(0,0,0,1)');fade.addColorStop(.55,'rgba(0,0,0,.55)');fade.addColorStop(1,'rgba(0,0,0,0)');
    ink.fillStyle=fade;ink.fillRect(0,0,128,128);
    const shade=new THREE.CanvasTexture(canvas);
    const pool=(w:number,d:number,y:number,z:number,opacity:number)=>{
      const m=new THREE.Mesh(new THREE.PlaneGeometry(w,d),new THREE.MeshBasicMaterial({map:shade,color:0x050403,transparent:true,opacity,depthWrite:false}));
      m.rotation.x=-Math.PI/2;m.position.set(0,y,z);m.renderOrder=-1;this.root.add(m);
    };
    pool(7.4,3.4,.02,.75,.62);
    pool(13,9,-.02,-3.6,.9);
    this.root.visible=false;
  }
  update(w:World,dt:number){
    this.root.visible=bossAvailable(w)||w.bossEncounter==='active'||w.bossEncounter==='defeated';
    const target=w.bossEncounter==='waiting'?0:1;
    this.opening+=(target-this.opening)*(1-Math.exp(-dt*4));
    this.leaves[0].rotation.y=this.opening*1.35;this.leaves[1].rotation.y=-this.opening*1.35;
    this.root.visible &&= w.mode!=='duel';
  }
}
