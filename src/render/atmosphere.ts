import * as T from 'three';

/** Sparse perimeter flecks: 24 instances, one material, no lights or growing pool. */
export class Atmosphere {
  readonly mesh: T.InstancedMesh<T.BufferGeometry,T.MeshBasicMaterial>;
  private dummy=new T.Object3D();
  private time=0;
  private circle=-1;
  constructor() {
    const shape=new T.Shape();shape.moveTo(0,.6);shape.quadraticCurveTo(.45,.1,0,-.6);shape.quadraticCurveTo(-.4,-.1,0,.6);
    this.mesh=new T.InstancedMesh(new T.ShapeGeometry(shape,2),new T.MeshBasicMaterial({color:0xa99c83,transparent:true,opacity:.24,depthWrite:false,side:T.DoubleSide}),24);
    this.mesh.name='circle-motes';this.mesh.frustumCulled=false;
    this.mesh.material.forceSinglePass=true;
    this.mesh.instanceMatrix.setUsage(T.DynamicDrawUsage);
    this.update(0,0);
  }
  update(dt:number,circle:number,reducedMotion=false) {
    const changed=circle!==this.circle;
    if(changed){this.circle=circle;this.mesh.material.color.setHex([0xa99c83,0xa77d78,0x8d9980,0xb5a47d,0x91796b,0xa49483][circle]??0xa99c83);}
    if(reducedMotion&&!changed)return;
    if(!reducedMotion)this.time+=Math.max(0,Math.min(.05,dt));
    const t=this.time;
    for(let i=0;i<this.mesh.count;i++){
      const phase=i*.61803398875%1,side=i%2?1:-1;
      // Nothing sweeps across the centre or competes with an enemy tell.
      const z=-11+(i*7%24),y=.5+((phase*3.3-t*.18+300)%3.3);
      this.dummy.position.set(side*(15.4+Math.sin(t*.19+i)*.7),y,z+Math.sin(t*.15+i)*.3);
      this.dummy.rotation.set(.3+Math.sin(t*.2+i)*.25,phase*6.28,t*.16+i);
      const size=(circle===1?.13:.07)*(0.65+phase*.6);
      this.dummy.scale.setScalar(size);this.dummy.updateMatrix();this.mesh.setMatrixAt(i,this.dummy.matrix);
    }
    this.mesh.instanceMatrix.needsUpdate=true;
  }
}
