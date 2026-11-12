import * as T from 'three';

// Original sculpted silhouettes. Translucent pigment, never additive light.
function mesh(root: T.Group, geometry: T.BufferGeometry, color: number, opacity: number) {
  const part=new T.Mesh(geometry,new T.MeshBasicMaterial({color,transparent:true,opacity,depthWrite:false,side:T.DoubleSide}));
  part.userData.alpha=opacity; root.add(part); return part;
}
function cut(points: number[][], depth=.08) {
  const shape=new T.Shape(); points.forEach(([x,y],i)=>i?shape.lineTo(x,y):shape.moveTo(x,y)); shape.closePath();
  return new T.ExtrudeGeometry(shape,{depth,bevelEnabled:false});
}
/** A horned soul at the head of Astral Funeral's real projectile fan. */
export function dragonSoul(root: T.Group, color: number) {
  const head=new T.Group();head.scale.setScalar(.65);root.add(head);
  const skull=new T.Shape();
  skull.moveTo(-.48,0);skull.bezierCurveTo(-.48,-.36,-.08,-.42,.2,-.29);
  skull.bezierCurveTo(.4,-.22,.35,-.12,.78,-.13);skull.lineTo(.94,-.04);skull.lineTo(.76,.09);
  skull.bezierCurveTo(.4,.1,.34,.3,.12,.33);skull.bezierCurveTo(-.14,.38,-.49,.27,-.48,0);
  for(const side of [-1,1]){const eye=new T.Path();eye.absellipse(.12,side*.19,.11,.045,0,Math.PI*2,true,side*.2);skull.holes.push(eye);}
  const bone=mesh(head,new T.ExtrudeGeometry(skull,{depth:.16,bevelEnabled:false}),0x8daca3,.55);bone.rotation.x=-Math.PI/2;
  const jaw=mesh(head,cut([[-.05,-.16],[.55,-.15],[.86,0],[.32,.12],[-.05,.1]],.04),0x405d58,.65);jaw.rotation.x=-Math.PI/2;jaw.position.y=-.1;
  for(const side of [-1,1]) {
    const horn=new T.Shape();horn.moveTo(-.22,side*.18);horn.bezierCurveTo(-.5,side*.3,-.85,side*.32,-1.03,side*.67);horn.bezierCurveTo(-.6,side*.49,-.33,side*.39,-.12,side*.28);horn.closePath();
    const tip=mesh(head,new T.ExtrudeGeometry(horn,{depth:.05,bevelEnabled:false}),0xbbb99a,.58);tip.rotation.x=-Math.PI/2;tip.position.y=.08;
    const eye=mesh(head,new T.SphereGeometry(.035,5,4),0xd6ae67,.75);eye.position.set(.12,.14,side*.19);
    const thread=mesh(head,new T.TubeGeometry(new T.CatmullRomCurve3([new T.Vector3(.4,-.04,side*.1),new T.Vector3(-.1,.02,side*.42),new T.Vector3(-.8,.08,side*.35),new T.Vector3(-1.5,.01,side*.6)]),16,.016,3,false),color,.26);
    thread.userData.alpha=.26;
    for(let i=0;i<3;i++){const tooth=mesh(head,new T.ConeGeometry(.035,.12,3),0xbbb99a,.5);tooth.rotation.z=Math.PI;tooth.position.set(.42+i*.11,-.04,side*.1);}
  }
}
export function brokenCathedral(radius: number, color: number) {
  const root=new T.Group(),pieces:T.Mesh[]=[];
  for(let i=0;i<12;i++) {
    const a=i*Math.PI/6, distance=radius*(.35+(i%3)*.17);
    const plate=mesh(root,cut([[-.2,-.12],[.18,-.25],[.45,.05],[.04,.24],[-.33,.14]],.1+(i%3)*.08),i%3===0?color:0x736756,i%3===0?.3:.24);
    plate.scale.setScalar(.55);plate.rotation.x=-Math.PI/2;plate.rotation.z=a;plate.position.set(Math.cos(a)*distance,.04,Math.sin(a)*distance);pieces.push(plate);
  }
  return {root,animate:(t:number)=>pieces.forEach((p,i)=>{p.position.y=.03+Math.sin(Math.PI*t)*(.3+(i%3)*.18);p.rotation.y=Math.sin(Math.PI*t)*((i%2?1:-1)*.3);})};
}
