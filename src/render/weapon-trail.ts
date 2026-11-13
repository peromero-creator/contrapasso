import * as T from 'three';
import { FX_ORDER } from './effect-policy.ts';

/** Six short painted ribbons, sampled from the actual held weapon. No lights or clones. */
export class WeaponTrail {
  private positions=new Float32Array(6*6*3);
  private geometry=new T.BufferGeometry();
  private material=new T.MeshBasicMaterial({color:0xc6b08d,transparent:true,opacity:.22,depthWrite:false,side:T.DoubleSide,forceSinglePass:true});
  private mesh=new T.Mesh(this.geometry,this.material);
  private a=new T.Vector3();private b=new T.Vector3();
  private previousA=new T.Vector3();private previousB=new T.Vector3();
  private live=false;private cursor=0;private remaining=0;
  constructor(scene:T.Scene){this.geometry.setAttribute('position',new T.BufferAttribute(this.positions,3).setUsage(T.DynamicDrawUsage));this.mesh.frustumCulled=false;this.mesh.renderOrder=FX_ORDER.skill;this.mesh.visible=false;scene.add(this.mesh);}
  update(dt:number,grip:T.Object3D,active:boolean,length:number,color:number,flow:boolean){
    if(!active){this.live=false;this.remaining-=dt;this.material.opacity=Math.max(0,this.remaining/.13)*.22;this.mesh.visible=this.remaining>0;return;}
    grip.updateWorldMatrix(true,false);grip.localToWorld(this.a.set(length*.65,0,0));grip.localToWorld(this.b.set(length,0,0));
    if(!this.live||this.b.distanceToSquared(this.previousB)>9){this.positions.fill(0);this.cursor=0;this.live=true;}
    else {
      let offset=this.cursor*18;
      for(const p of [this.previousA,this.previousB,this.b,this.previousA,this.b,this.a]){this.positions[offset++]=p.x;this.positions[offset++]=p.y;this.positions[offset++]=p.z;}
      this.cursor=(this.cursor+1)%6;
    }
    this.previousA.copy(this.a);this.previousB.copy(this.b);this.geometry.attributes.position.needsUpdate=true;
    this.material.color.setHex(color);this.material.opacity=flow?.3:.18;this.remaining=.13;this.mesh.visible=true;
  }
  clear(){this.live=false;this.remaining=0;this.mesh.visible=false;this.positions.fill(0);}
}
