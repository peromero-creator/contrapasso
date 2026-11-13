import * as T from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

// Original sculpted silhouettes. Translucent pigment, never additive light.
function mesh(root: T.Group, geometry: T.BufferGeometry, color: number, opacity: number) {
  const part=new T.Mesh(geometry,new T.MeshBasicMaterial({color,transparent:true,opacity,depthWrite:false,side:T.DoubleSide,forceSinglePass:true,vertexColors:geometry.hasAttribute('color')}));
  part.userData.alpha=opacity; root.add(part); return part;
}
function cut(points: number[][], depth=.08) {
  const shape=new T.Shape(); points.forEach(([x,y],i)=>i?shape.lineTo(x,y):shape.moveTo(x,y)); shape.closePath();
  return new T.ExtrudeGeometry(shape,{depth,bevelEnabled:false});
}
// These silhouettes are immutable. Repeated casts reuse their GPU buffers.
const signatureGeometry = new Map<string, T.BufferGeometry>();
function cachedShape(key: string, build: () => T.BufferGeometry) {
  let geometry = signatureGeometry.get(key);
  if (!geometry) { geometry = build(); geometry.userData.sharedEffect = true; signatureGeometry.set(key, geometry); }
  return geometry;
}
function joined(parts: T.BufferGeometry[]) {
  const result = mergeGeometries(parts)!;
  for (const part of parts) part.dispose();
  return result;
}
/** A horned soul at the head of Astral Funeral's real projectile fan. */
function sculptDragon(root: T.Group, color: number) {
  const head=new T.Group();head.scale.setScalar(.48);root.add(head);
  const skull=new T.Shape();
  skull.moveTo(-.48,0);skull.bezierCurveTo(-.48,-.36,-.08,-.42,.2,-.29);
  skull.bezierCurveTo(.4,-.22,.35,-.12,.78,-.13);skull.lineTo(.94,-.04);skull.lineTo(.76,.09);
  skull.bezierCurveTo(.4,.1,.34,.3,.12,.33);skull.bezierCurveTo(-.14,.38,-.49,.27,-.48,0);
  for(const side of [-1,1]){const eye=new T.Path();eye.absellipse(.12,side*.19,.11,.045,0,Math.PI*2,true,side*.2);skull.holes.push(eye);}
  const bone=mesh(head,new T.ExtrudeGeometry(skull,{depth:.16,bevelEnabled:false}),0x688e85,.4);bone.rotation.x=-Math.PI/2;
  const jaw=mesh(head,cut([[-.05,-.16],[.55,-.15],[.86,0],[.32,.12],[-.05,.1]],.04),0x405d58,.65);jaw.rotation.x=-Math.PI/2;jaw.position.y=-.1;
  for(const side of [-1,1]) {
    const horn=new T.Shape();horn.moveTo(-.22,side*.18);horn.bezierCurveTo(-.5,side*.3,-.85,side*.32,-1.03,side*.67);horn.bezierCurveTo(-.6,side*.49,-.33,side*.39,-.12,side*.28);horn.closePath();
    const tip=mesh(head,new T.ExtrudeGeometry(horn,{depth:.05,bevelEnabled:false}),0x9da78d,.44);tip.rotation.x=-Math.PI/2;tip.position.y=.08;
    const eye=mesh(head,new T.SphereGeometry(.035,5,4),0xd6ae67,.75);eye.position.set(.12,.14,side*.19);
    const thread=mesh(head,new T.TubeGeometry(new T.CatmullRomCurve3([new T.Vector3(.4,-.04,side*.1),new T.Vector3(-.1,.02,side*.42),new T.Vector3(-.8,.08,side*.35),new T.Vector3(-1.5,.01,side*.6)]),16,.016,3,false),color,.26);
    thread.userData.alpha=.26;
    for(let i=0;i<3;i++){const tooth=mesh(head,new T.ConeGeometry(.035,.12,3),0x9da78d,.4);tooth.rotation.z=Math.PI;tooth.position.set(.42+i*.11,-.04,side*.1);}
  }
}
// All horns, teeth and whiskers share one draw call and one immutable GPU buffer.
let soulHeadGeometry:T.BufferGeometry | null=null;
export function dragonSoul(root:T.Group,_color:number) {
  if(!soulHeadGeometry) {
    const source=new T.Group();sculptDragon(source,0x91b7b8);source.updateMatrixWorld(true);
    const positions:number[]=[],colors:number[]=[];
    source.traverse(node=>{if(node instanceof T.Mesh) {
      const geometry=node.geometry.index?node.geometry.toNonIndexed():node.geometry.clone();geometry.applyMatrix4(node.matrixWorld);
      const attr=geometry.getAttribute('position'),color=(node.material as T.MeshBasicMaterial).color;
      for(let i=0;i<attr.count;i++){positions.push(attr.getX(i),attr.getY(i),attr.getZ(i));colors.push(color.r,color.g,color.b,node.userData.alpha);}
      geometry.dispose();node.geometry.dispose();(node.material as T.Material).dispose();
    }});
    soulHeadGeometry=new T.BufferGeometry();soulHeadGeometry.setAttribute('position',new T.Float32BufferAttribute(positions,3));soulHeadGeometry.setAttribute('color',new T.Float32BufferAttribute(colors,4));soulHeadGeometry.userData.sharedEffect=true;
  }
  const head=mesh(root,soulHeadGeometry,_color===0xb15b64?0xe0a3a3:0xffffff,1);return head;
}
export function brokenCathedral(radius: number, color: number) {
  const root=new T.Group(),pieces:T.Mesh[]=[];
  for(let i=0;i<12;i++) {
    const a=i*Math.PI/6, distance=radius*(.35+(i%3)*.17);
    const plate=mesh(root,cachedShape(`plate-${i%3}`,()=>cut([[-.2,-.12],[.18,-.25],[.45,.05],[.04,.24],[-.33,.14]],.1+(i%3)*.08)),i%3===0?color:0x736756,i%3===0?.3:.24);
    plate.scale.setScalar(.55);plate.rotation.x=-Math.PI/2;plate.rotation.z=a;plate.position.set(Math.cos(a)*distance,.04,Math.sin(a)*distance);pieces.push(plate);
  }
  return {root,animate:(t:number)=>pieces.forEach((p,i)=>{p.position.y=.03+Math.sin(Math.PI*t)*(.3+(i%3)*.18);p.rotation.y=Math.sin(Math.PI*t)*((i%2?1:-1)*.3);})};
}

/** A tapering brush ribbon, sampled as a silhouette instead of a glowing tube. */
function ribbon(path: (t:number)=>T.Vector3, width:number) {
  const vertices:number[]=[],colors:number[]=[],indices:number[]=[];
  for(let i=0;i<=28;i++) {
    const t=i/28,p=path(t),tangent=path(Math.min(1,t+.01)).sub(path(Math.max(0,t-.01))).normalize();
    const side=new T.Vector3(-tangent.z,0,tangent.x).normalize();
    const w=width*Math.sin(Math.PI*t)**.65;
    for(const edge of [-1,0,1]) {
      vertices.push(p.x+side.x*w*edge,p.y,p.z+side.z*w*edge);
      colors.push(1,1,1,edge===0?Math.sin(Math.PI*t)**.45:0);
    }
    if(i<28)for(let k=0;k<2;k++){const j=i*3+k;indices.push(j,j+1,j+3,j+1,j+4,j+3);}
  }
  const geometry=new T.BufferGeometry();geometry.setAttribute('position',new T.Float32BufferAttribute(vertices,3));geometry.setAttribute('color',new T.Float32BufferAttribute(colors,4));geometry.setIndex(indices);return geometry;
}
export type RitualKind='furnace'|'harvest'|'covenant'|'orbit';
/** Each pulse has a leading silhouette, then a slower settling tail. */
export function ritualPulse(kind:RitualKind,radius:number,color:number,flame?:T.Texture) {
  const root=new T.Group(), strokes:T.Mesh[]=[], tongues:{mesh:T.Mesh;angle:number;height:number}[]=[];
  const count=kind==='orbit'?3:kind==='furnace'?9:7;
  const geometry=cachedShape(`pulse-${kind}-${radius}`,()=>joined(Array.from({length:count},(_,i)=>{
    const a=i*Math.PI*2/count;
    return ribbon(t=>{
      const angle=a+(kind==='furnace'?.23:kind==='orbit'?1.8:1.05)*t;
      const r=kind==='orbit'?radius*(.8+.2*t):kind==='furnace'?radius*(.55+.24*t):radius*(.12+.88*t);
      const y=kind==='furnace'?.045:kind==='orbit'?.45+Math.sin(Math.PI*t)*.35:Math.sin(Math.PI*t)*1.25+.15;
      return new T.Vector3(Math.cos(angle)*r,y,Math.sin(angle)*r);
    },kind==='furnace'?.12:kind==='orbit'?.23:.18);
  })));
  strokes.push(mesh(root,geometry,color,kind==='furnace'?.65:.55));
  for(let i=0;i<count;i++) {
    const a=i*Math.PI*2/count;
    if(kind==='furnace' && flame) {
      const height=.9+(i%3)*.35;
      const tongue=mesh(root,cachedShape(`tongue-${height}`,()=>new T.PlaneGeometry(.8,height)),0xffffff,.67);
      (tongue.material as T.MeshBasicMaterial).map=flame;
      tongue.rotation.y=.6; tongues.push({mesh:tongue,angle:a,height});
    }
  }
  return {root,animate:(t:number)=>{
    const front=1-(1-Math.min(1,t/.45))**3;
    tongues.forEach(({mesh:part,angle,height})=>{
      const distance=radius*(.22+.58*front);
      part.position.set(Math.cos(angle)*distance,height*.43,Math.sin(angle)*distance);
      part.scale.set(.6+.4*Math.sin(Math.PI*t),.35+1.1*Math.sin(Math.PI*t),1);
      part.rotation.z=Math.sin(angle+t*2)*.15;
      part.userData.fade=Math.min(1,t/.07)*(1-t)**.65;
    });
    strokes.forEach(stroke=>{
      const inward=kind==='harvest'||kind==='covenant';
      const scale=inward?1-.82*(1-(1-t)**2):kind==='orbit'?1:.28+.72*front;
      stroke.scale.x=stroke.scale.z=scale;
      stroke.scale.y=kind==='furnace'?.35+Math.sin(Math.PI*t)*1.1:1;
      stroke.rotation.y=(inward?-.75:kind==='orbit'?1.8:.12)*t;
      stroke.position.y=inward?.6*t:0;
      stroke.userData.fade=Math.min(1,t/.055)*(1-t)**(kind==='furnace'?.5:.25);
    });
  }};
}
/** Quiet gathering wisps grow denser before release; they never fill the whole arena. */
export function ritualCharge(color:number) {
  const root=new T.Group(), wisps:T.Mesh[]=[];
  const geometry=cachedShape('charge',()=>joined(Array.from({length:5},(_,i)=>{
    const a=i*Math.PI*2/5;
    return ribbon(t=>{const r=1.15*(1-t)+.16,angle=a+t*1.1;return new T.Vector3(Math.cos(angle)*r,.08+t*t*1.6,Math.sin(angle)*r);},.075);
  })));
  wisps.push(mesh(root,geometry,color,.32));
  return {root,animate:(t:number)=>{
    root.rotation.y=t*.55;root.scale.setScalar(1-.24*t);
    wisps.forEach(w=>{w.userData.fade=Math.sin(Math.PI*Math.min(.95,t))**.6;});
  }};
}
/** Open gothic ribs leave the champion and held weapon readable inside the ward. */
export function covenantWard() {
  const root=new T.Group();
  for(let i=0;i<5;i++) {
    const a=i*Math.PI*2/5;
    const rib=mesh(root,ribbon(t=>{
      const angle=a+(t-.5)*.72,r=.92;
      return new T.Vector3(Math.cos(angle)*r,.35+Math.sin(Math.PI*t)*1.1,Math.sin(angle)*r);
    },.075),0xa76a7a,.24);
    rib.userData.alpha=.24;
  }
  return root;
}

export function bloodThread(color:number) {
  const root=new T.Group(), veins:T.Mesh[]=[];
  for(let i=0;i<4;i++) {
    const vein=mesh(root,ribbon(t=>new T.Vector3(.3+t*6.7,.5+Math.sin(t*Math.PI)*(.2+i*.08),(i-1.5)*.12+Math.sin(t*Math.PI*2+i)*.15),.06),color,.55-i*.06);
    veins.push(vein);
  }
  return {root,animate:(t:number)=>{
    root.scale.x=1-.88*(1-(1-t)**2);
    veins.forEach(v=>{v.userData.fade=Math.min(1,t/.045)*(1-t)**.5;});
  }};
}

// Reusable weapon strokes: fixed vertex counts, no geometry allocation on repeated hits.
const weaponStrokes=new Map<string,T.BufferGeometry>();
function weaponStroke(kind:string) {
  let geometry=weaponStrokes.get(kind);if(geometry)return geometry;
  if(kind==='fracture'||kind==='fault') {
    const points:number[]=[],colors:number[]=[],indices:number[]=[];
    const count=kind==='fault'?3:8;
    for(let i=0;i<count;i++)for(let j=0;j<6;j++) {
      const a=kind==='fault'?(i-1)*.055:i*Math.PI/4,d=.08+j*.175,bend=(j%2?1:-1)*.025;
      const x=Math.cos(a)*d,z=Math.sin(a)*d+bend,w=.016*(1-j/6);
      points.push(x,.012,z-w,x,.012,z+w);colors.push(1,1,1,.8,1,1,1,.8);
      if(j<5){const n=(i*6+j)*2;indices.push(n,n+1,n+2,n+1,n+3,n+2);}
    }
    geometry=new T.BufferGeometry();geometry.setAttribute('position',new T.Float32BufferAttribute(points,3));geometry.setAttribute('color',new T.Float32BufferAttribute(colors,4));geometry.setIndex(indices);
  } else if(kind==='thrust') {
    geometry=ribbon(t=>new T.Vector3(t,.015,Math.sin(t*Math.PI)*.018),.05);
  } else {
    const wide=kind==='cleave';
    geometry=ribbon(t=>{const a=-1.05+t*2.1;return new T.Vector3(Math.cos(a),.02+Math.sin(Math.PI*t)*(wide?.12:.035),Math.sin(a));},wide?.12:.065);
  }
  geometry.userData.sharedEffect=true;weaponStrokes.set(kind,geometry);return geometry;
}
export function weaponImpact(family:string,pattern:string,reach:number,color:number) {
  const root=new T.Group(),parts:T.Mesh[]=[];
  const hammer=family==='hammer',dagger=family==='dagger',line=pattern==='line',burst=pattern==='burst';
  const kind=hammer?(line?'fault':'fracture'):line?'thrust':family==='axe'?'cleave':'cut';
  const count=hammer?1:line?2:burst?3:dagger?2:1;
  for(let i=0;i<count;i++) {
    const part=mesh(root,weaponStroke(kind),color,hammer?.42:dagger?.6:.53);
    part.rotation.y=line?0:burst?i*Math.PI*2/3:dagger?(i-.5)*.45:0;
    part.position.y=hammer?0:line?.7+i*.12:.55+i*.16;
    part.scale.set(reach,1,line?1:reach);
    if(line)part.position.z=(i-.5)*.14;
    parts.push(part);
  }
  return {root,animate:(t:number)=>{
    const travel=1-(1-t)**3;
    parts.forEach((part,i)=>{
      if(line)part.scale.x=reach*(.35+.65*travel);
      else if(hammer)part.scale.set(reach*(.35+.65*travel),1,reach*(.35+.65*travel));
      else part.rotation.y=(burst?i*Math.PI*2/3:dagger?(i-.5)*.45:0)+(dagger?(i%2?-1:1):1)*(travel-.5)*(family==='axe'?1.1:.7);
      part.userData.fade=Math.min(1,t/.035)*(1-t)**(dagger?1.6:.75);
    });
  }};
}
