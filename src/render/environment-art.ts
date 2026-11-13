import * as T from 'three';
import { ARENA_HX, ARENA_HZ, PORTAL, type World } from '../sim/world';

// Non-uniform UV spacing seats both illustrated door recesses behind the real gates.
function facade(){
  const g=new T.BufferGeometry(),vertices:number[]=[],uv:number[]=[],xs=[-21,-10,0,21],us=[0,.17,.55,1];
  for(let i=0;i<3;i++)for(const [x,y,u,v]of [[xs[i],-4,us[i],0],[xs[i+1],-4,us[i+1],0],[xs[i+1],4,us[i+1],1],[xs[i],-4,us[i],0],[xs[i+1],4,us[i+1],1],[xs[i],4,us[i],1]]){vertices.push(x,y,0);uv.push(u,v);}
  g.setAttribute('position',new T.Float32BufferAttribute(vertices,3));g.setAttribute('uv',new T.Float32BufferAttribute(uv,2));return g;
}
/** Painted architectural silhouettes: fixed geometry, one draw per visible piece. */
export class EnvironmentArt {
  readonly root=new T.Group();
  readonly exit=new T.Group();
  readonly ready:Promise<void>;
  private wall=new T.Mesh(facade(),new T.MeshBasicMaterial({color:0xa8a39b}));
  private exitMat=new T.MeshBasicMaterial({color:0xffffff,side:T.DoubleSide});
  private walls:T.Texture[]=[];
  constructor(scene:T.Scene) {
    scene.add(this.root);this.root.add(this.wall,this.exit);
    this.wall.position.set(0,3.95,-ARENA_HZ-1.5);
    const points=[[.302,.97],[.302,.87],[.264,.86],[.264,.34],[.332,.34],[.35,.24],[.4,.13],[.5,.04],[.6,.13],[.65,.24],[.668,.34],[.736,.34],[.736,.86],[.698,.87],[.698,.97]];
    const shape=new T.Shape(points.map(([u,v])=>new T.Vector2((u-.5)*8.8,(.97-v)*5)));
    const g=new T.ShapeGeometry(shape),p=g.attributes.position,uv=g.attributes.uv;
    for(let i=0;i<p.count;i++)uv.setXY(i,p.getX(i)/8.8+.5,1-(.97-p.getY(i)/5));
    this.exit.add(new T.Mesh(g,this.exitMat));this.exit.position.set(PORTAL.x,0,-ARENA_HZ+.1);
    const borderMat=new T.MeshBasicMaterial({color:0xaca49a});
    for(const [x,z,length,turn] of [[0,-ARENA_HZ-1.1,ARENA_HX*2+4.4,0],[0,ARENA_HZ+1.1,ARENA_HX*2+4.4,0],[-ARENA_HX-1.1,0,ARENA_HZ*2,Math.PI/2],[ARENA_HX+1.1,0,ARENA_HZ*2,Math.PI/2]]) {
      const g=new T.PlaneGeometry(length,2.2),uv=g.attributes.uv;for(let i=0;i<uv.count;i++)uv.setX(i,uv.getX(i)*length/4);
      const edge=new T.Mesh(g,borderMat);edge.rotation.set(-Math.PI/2,0,turn);edge.position.set(x,-.03,z);this.root.add(edge);
    }
    const loader=new T.TextureLoader();
    const load=async(path:string)=>{const t=await loader.loadAsync(path);t.colorSpace=T.SRGBColorSpace;t.anisotropy=4;return t;};
    this.ready=Promise.all([
      load('/art/stone-border.jpg').then(t=>{t.wrapS=T.RepeatWrapping;borderMat.map=t;borderMat.needsUpdate=true;}),
      load('/art/pilgrim-exit.jpg').then(t=>{this.exitMat.map=t;this.exitMat.needsUpdate=true;}),
      ...['limbo','lust','gluttony','greed','wrath'].map((name,i)=>load(`/art/wall-${name}.jpg`).then(t=>{t.offset.y=.155;t.repeat.y=.845;this.walls[i]=t;})),
    ]).then(()=>{this.wall.material.map=this.walls[0];this.wall.material.needsUpdate=true;});
  }
  prepare(renderer:T.WebGLRenderer) { for(const texture of this.walls)renderer.initTexture(texture); }
  sync(w:World,chamber:boolean) {
    this.root.visible=w.mode==='solo';
    this.exit.visible=!chamber;
    this.exitMat.color.setHex(w.phase==='cleared'?0xe5d4b7:0x59544d);
    const map=this.walls[Math.max(0,w.floor-1)]??this.walls[0];
    if(map&&this.wall.material.map!==map){this.wall.material.map=map;this.wall.material.needsUpdate=true;}
  }
}
