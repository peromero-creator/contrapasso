import * as T from 'three';
import { clone } from 'three/addons/utils/SkeletonUtils.js';

type Echo = { root: T.Object3D; nodes: T.Object3D[]; materials: T.Material[]; life: number };
/** Reuse frozen skeleton poses, including the held weapon, instead of allocating
 * a rig and dozens of materials every 55 ms during a lunge. */
export class Afterimages {
  private source: T.Object3D[] = [];
  private pool: Echo[] = [];
  private scene: T.Scene;
  constructor(scene: T.Scene) { this.scene=scene; }
  emit(actor: T.Object3D) {
    const nodes: T.Object3D[] = [];
    actor.traverse(node => nodes.push(node));
    if (nodes.length !== this.source.length || nodes.some((node,i)=>node!==this.source[i])) {
      this.dispose(); this.source=nodes;
    }
    let echo = this.pool.find(e=>e.life<=0);
    if (!echo && this.pool.length >= 4) echo = this.pool.reduce((a,b)=>a.life<b.life?a:b);
    if (!echo) {
      const root=clone(actor), copies:T.Object3D[]=[], materials:T.Material[]=[];
      root.traverse(node=>{
        copies.push(node);
        if (!(node instanceof T.Mesh)) return;
        const tint=(material:T.Material)=>{
          const copy=material.clone();copy.transparent=true;copy.depthWrite=false;
          copy.onBeforeCompile=material.onBeforeCompile;
          copy.customProgramCacheKey=material.customProgramCacheKey;
          if(copy instanceof T.MeshStandardMaterial){copy.color.setHex(0x647c89);copy.emissive.setHex(0);}
          materials.push(copy);return copy;
        };
        node.material=Array.isArray(node.material)?node.material.map(tint):tint(node.material);
      });
      echo={root,nodes:copies,materials,life:0};this.pool.push(echo);this.scene.add(root);
    }
    for(let i=0;i<nodes.length;i++){
      const from=nodes[i],to=echo.nodes[i];
      to.position.copy(from.position);to.quaternion.copy(from.quaternion);to.scale.copy(from.scale);
      // An echo is pigment, not another light source. Changing the light count
      // recompiles every lit material in the arena when each ghost appears.
      to.visible=from.visible && !(to instanceof T.Light);
    }
    echo.life=.22; echo.root.visible=true;
    for(const material of echo.materials)material.opacity=.14;
  }
  update(dt:number) {
    for(const echo of this.pool){
      echo.life=Math.max(0,echo.life-dt);echo.root.visible=echo.life>0;
      for(const material of echo.materials)material.opacity=.14*echo.life/.22;
    }
  }
  clear(){for(const echo of this.pool){echo.life=0;echo.root.visible=false;}}
  dispose(){
    for(const echo of this.pool){
      const skeletons=new Set<T.Skeleton>();
      for(const node of echo.nodes)if(node instanceof T.SkinnedMesh)skeletons.add(node.skeleton);
      for(const skeleton of skeletons)skeleton.dispose();
      for(const material of echo.materials)material.dispose();
      echo.root.removeFromParent();
    }
    this.pool=[];this.source=[];
  }
}
