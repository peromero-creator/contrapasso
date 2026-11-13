import assert from 'node:assert/strict';
import * as T from 'three';
import { batchScenery } from '../src/render/static-batch.ts';
import { Afterimages } from '../src/render/afterimages.ts';
import { Gore } from '../src/render/gore.ts';
import { AnimatedModel } from '../src/render/assets.ts';
import { PresentationSample } from '../src/render/presentation-sample.ts';
import { EffectAnchor, attachmentFor, isPassivePulse } from '../src/render/effect-anchor.ts';
import { createWorld, step, type Enemy } from '../src/sim/world.ts';
import { EnemyThreat, enemyThreat } from '../src/render/enemy-threat.ts';
import { programSamples } from '../src/render/program-warmup.ts';

// Baking scenery preserves bounds under nested, rotated and scaled parents.
const root = new T.Group(), parent = new T.Group(), moving = new T.Group();
root.position.set(3,2,-4);root.rotation.y=.3;parent.rotation.z=.4;parent.scale.set(2,1,3);root.add(parent,moving);
const material = new T.MeshStandardMaterial();
for(let i=0;i<6;i++){const mesh=new T.Mesh(new T.BoxGeometry(1,2,3),material);mesh.position.x=i*2;parent.add(mesh);}
const cloth=new T.Mesh(new T.PlaneGeometry(2,3),material);cloth.position.x=-5;moving.add(cloth);
const before=new T.Box3().setFromObject(root,true);
batchScenery(root,new Set([moving]));
const after=new T.Box3().setFromObject(root,true);
assert.ok(before.min.distanceTo(after.min)<1e-5 && before.max.distanceTo(after.max)<1e-5);
assert.equal(root.getObjectByName('scenery-batch')!.type,'Mesh');assert.equal(parent.children.length,0);assert.equal(cloth.parent,moving);

// Six overlapping emissions stay at four rigs. Reuse copies bones and gear;
// replacing the source frees materials and skeletons, never shared geometry.
const scene = new T.Scene(), source=new T.Group(), bone=new T.Bone();bone.name='Hand';
source.add(bone);const weapon=new T.Mesh(new T.BoxGeometry(),material);bone.add(weapon);
bone.add(new T.PointLight(0xffffff, .1));
const echoes=new Afterimages(scene);
for(let i=0;i<12;i++){bone.rotation.z=i*.1;source.position.x=i;echoes.emit(source);echoes.update(.03);}
assert.equal(scene.children.length,4);assert.equal(scene.children.at(-1)?.getObjectByName('Hand')?.type,'Bone');
let ghostLights=0;scene.traverseVisible(node=>{if(node instanceof T.Light)ghostLights++;});
assert.equal(ghostLights,0,'afterimages never change the scene light count or recompile its shaders');
echoes.update(1);assert.ok(scene.children.every(node=>!node.visible));
echoes.emit(source);assert.equal(scene.children.length,4);echoes.clear();assert.ok(scene.children.every(node=>!node.visible));
source.add(new T.Group());echoes.emit(source);assert.equal(scene.children.length,1);echoes.dispose();assert.equal(scene.children.length,0);

// Blood is still bounded and expires, but its draw count is independent of count.
const blood=new Gore(scene);blood.spray(0,0,220,1,0);blood.shatter(0,0,60);blood.update(.016);
assert.equal(scene.children.length,2);
assert.equal(scene.children.reduce((n,node)=>n+(node as T.InstancedMesh).count,0),180);
for(let i=0;i<400;i++)blood.update(.05);
assert.equal(scene.children.reduce((n,node)=>n+(node as T.InstancedMesh).count,0),0);
blood.spray(0,0,30,1,0);blood.update(0);blood.clear();assert.ok(scene.children.every(n=>(n as T.InstancedMesh).count===0));

// Fitting a second instance no longer scans vertices; height and origin stay exact.
const shape=new T.Mesh(new T.BoxGeometry(2,4,1),material);shape.position.set(2,3,-1);
const template={scene:new T.Group(),animations:[]} as any;template.scene.add(shape);
const first=new AnimatedModel(template,2,90);
let measurements=0;const original=T.Mesh.prototype.getVertexPosition;
T.Mesh.prototype.getVertexPosition=function(...args){measurements++;return original.apply(this,args);};
const second=new AnimatedModel(template,3,90);
T.Mesh.prototype.getVertexPosition=original;
assert.equal(measurements,0);
const bounds=new T.Box3().setFromObject(second.root,true);
assert.ok(Math.abs(bounds.min.y)<1e-6 && Math.abs(bounds.max.y-3)<1e-6);
assert.ok(Math.abs(bounds.getCenter(new T.Vector3()).x)<1e-6);
first.dispose();second.dispose();

// A 120 Hz screen receives intermediate poses without predicting a future contact.
const sample=new PresentationSample();
sample.sample(1,0,0,'attack-1',{weapon:'starter',combo:1,elapsed:0},1);
const halfway=sample.sample(2,1,2,'attack-1',{weapon:'starter',combo:1,elapsed:1/60},.5);
assert.equal(halfway.x,.5);assert.equal(halfway.z,1);assert.equal(halfway.motion!.elapsed,1/120);
const repeated=sample.sample(2,1,2,'attack-1',{weapon:'starter',combo:1,elapsed:1/60},.9);
assert.ok(repeated.motion!.elapsed>halfway.motion!.elapsed && repeated.motion!.elapsed<1/60);
const reset=sample.sample(0,20,10,'attack-2',undefined,.2);assert.equal(reset.x,20);

// Windup life is authoritative, including pauses; actor attachment uses the drawn
// stride position while released ground effects retain their original world anchor.
const world=createWorld(1,['ember']);world.player.castId='lance';world.player.castT=.6;world.player.castPending=true;
const anchor=new EffectAnchor({type:'ability',stage:'charge',ability:'lance',side:'player',x:0,z:0},'charge');
const remaining=anchor.chargeRemaining(world)!;assert.ok(remaining>0);
for(let i=0;i<30;i++)assert.equal(anchor.chargeRemaining(world),remaining);
assert.deepEqual(anchor.position(world,{x:3,z:5}),{x:3,z:5});
world.player.castT-=.1;assert.ok(anchor.chargeRemaining(world)!<remaining);
world.player.castPending=false;assert.equal(anchor.chargeRemaining(world),null);
console.log('Render regression: PASS (scenery bounds, bounded rig reuse, instanced gore, cached fit, sub-tick poses, paused windups, drawn anchors)');

const passive = {type:'ability',stage:'pulse',ability:'ash',x:2,z:3} as const;
assert.equal(isPassivePulse(passive),true);
assert.equal(attachmentFor(passive,'starter'),null,'unattached nova keeps its impact origin');
assert.equal(attachmentFor({...passive,followsCaster:true},'starter'),'wielder','caster dash echoes follow the hero');
assert.equal(attachmentFor({type:'echo',x:0,z:0,followsCaster:true},'starter'),'wielder');
assert.equal(isPassivePulse({...passive,side:'player'}),false);
assert.equal(attachmentFor({...passive,side:'player'},'starter'),'wielder','active orbit still follows its caster');

// Real skeleton clones own their GPU bone textures; pooling must not dispose the actor.
const skinGeometry=new T.BoxGeometry(1,1,1), vertexCount=skinGeometry.attributes.position.count;
skinGeometry.setAttribute('skinIndex',new T.Uint16BufferAttribute(new Uint16Array(vertexCount*4),4));
const weights=new Float32Array(vertexCount*4);for(let i=0;i<vertexCount;i++)weights[i*4]=1;
skinGeometry.setAttribute('skinWeight',new T.Float32BufferAttribute(weights,4));
const rig=new T.Group(), joint=new T.Bone(), skin=new T.SkinnedMesh(skinGeometry,new T.MeshStandardMaterial());
skin.name='body';rig.add(joint,skin);skin.bind(new T.Skeleton([joint]));skin.skeleton.computeBoneTexture();
const prepared = new AnimatedModel({ scene: rig, animations: [] } as any, 2, 0);
prepared.root.traverse(node => {
  if (node instanceof T.SkinnedMesh) {
    assert.ok(node.boundingSphere, 'body and outline have a cached sorting bound before first draw');
    assert.equal(node.frustumCulled, false, 'approximate sorting sphere never clips animated limbs');
  }
});
prepared.dispose();
const skinnedEchoes=new Afterimages(scene);skinnedEchoes.emit(rig);
const copy=scene.children.find(n=>n.getObjectByName('body'))!.getObjectByName('body') as T.SkinnedMesh;
assert.notEqual(copy.skeleton,skin.skeleton);assert.notEqual(copy.skeleton.bones[0],joint);
copy.skeleton.computeBoneTexture();let boneTexturesDisposed=0,sourceDisposed=0;
copy.skeleton.boneTexture!.addEventListener('dispose',()=>boneTexturesDisposed++);
skin.skeleton.boneTexture!.addEventListener('dispose',()=>sourceDisposed++);
joint.rotation.z=.7;skinnedEchoes.update(1);skinnedEchoes.emit(rig);
assert.equal(copy.skeleton.bones[0].rotation.z,.7);
skinnedEchoes.dispose();assert.equal(boneTexturesDisposed,1);assert.equal(sourceDisposed,0);
console.log('Skeleton lifecycle: PASS (bone poses reused, owned textures disposed, source retained)');

// Transient disposal must not delete the material owner keeping a shader warm.
const shaderSource = new T.Mesh(new T.BoxGeometry(), new T.MeshBasicMaterial());
shaderSource.material.onBeforeCompile = shader => { shader.vertexShader += '\n// warmup variant'; };
shaderSource.material.customProgramCacheKey = () => 'warmup-regression';
const programs = programSamples([shaderSource]);
const retained = (programs.children[0] as T.Mesh).material as T.Material;
assert.notEqual(retained, shaderSource.material);
assert.equal(retained.onBeforeCompile, shaderSource.material.onBeforeCompile);
assert.equal(retained.customProgramCacheKey(), 'warmup-regression');
let retainedDisposals = 0; retained.addEventListener('dispose', () => retainedDisposals++);
shaderSource.material.dispose(); assert.equal(retainedDisposals, 0);
assert.equal((programs.children[0] as T.Mesh).geometry, shaderSource.geometry);

// Warnings read authoritative timing and direction, and never follow actor recoil.
const threatEnemy: Enemy = {id:99,kind:'imp',x:0,z:0,hp:55,maxHp:55,r:.55,state:'windup',t:.42,cd:0,dx:1,dz:0,hitDone:false,pattern:1,flash:0,spawn:0,burnT:0,burnCd:0};
const warning = new EnemyThreat();
assert.equal(enemyThreat(threatEnemy)!.progress,0);
assert.equal(enemyThreat(threatEnemy)!.radius,2.3);
const contactWorld=createWorld(3,[]);contactWorld.spawnDelay=999;contactWorld.player.x=2.2;contactWorld.player.z=0;contactWorld.enemies=[threatEnemy];
const initialLife=contactWorld.player.hp;
for(let i=0;i<25;i++)step(contactWorld,{move:-1,aim:0,attack:false,dash:false});
assert.equal(contactWorld.player.hp,initialLife,'warning never implies an early hit');
assert.ok(enemyThreat(threatEnemy)!.progress>.98);
step(contactWorld,{move:-1,aim:0,attack:false,dash:false});
assert.equal(contactWorld.player.hp,initialLife-10);
assert.equal(enemyThreat(threatEnemy),null,'warning expires on actual contact');
const brute={...threatEnemy,kind:'brute',r:.95,state:'windup',t:.325,dx:0,dz:1} as Enemy;
warning.sync(brute,{x:3,z:4});
assert.deepEqual(warning.root.position.toArray(),[3,0,4]);
assert.equal(warning.root.rotation.y,-Math.PI/2);
assert.equal(enemyThreat(brute)!.length,17*.55);
assert.equal(enemyThreat(brute)!.progress,.5);
assert.ok(enemyThreat({...brute,z:9.5})!.length<.56,'charge guide ends at the arena clamp');
let litWarnings=0;warning.root.traverse(node=>{if(node instanceof T.Light)litWarnings++;});assert.equal(litWarnings,0);
assert.equal(enemyThreat({...brute,kind:'warden',pattern:3})!.shape,'burst','radial shots must not masquerade as a charge lane');
assert.equal(enemyThreat({...brute,kind:'archer'})!.shape,'aim');
assert.equal(enemyThreat({...brute,spawn:.1}),null);
assert.equal(enemyThreat({...brute,hp:0}),null);
assert.equal(enemyThreat({...brute,state:'recover'}),null);
const otherWarning=new EnemyThreat();otherWarning.sync(brute,brute);
assert.equal((warning.root.children[0] as T.Mesh).geometry,(otherWarning.root.children[0] as T.Mesh).geometry);
let sharedDisposed=false;(warning.root.children[0] as T.Mesh).geometry.addEventListener('dispose',()=>sharedDisposed=true);
warning.dispose();assert.equal(sharedDisposed,false);otherWarning.dispose();
console.log('Enemy tells: PASS (real contact clock, locked charge, radial volley, no lights, shared geometry lifetime)');

// Real simulated attacks stay escapable along the direction the tell advertises.
function chargeTrial(dodge: boolean) {
  const arena=createWorld(4,[]);arena.spawnDelay=999;arena.player.x=6;arena.player.z=0;
  arena.enemies=[{...brute,x:0,z:0,dx:1,dz:0,t:.65,hp:170,maxHp:170}];
  for(let i=0;i<85;i++)step(arena,{move:dodge?256:-1,aim:0,attack:false,dash:false});
  return arena.player.hp;
}
assert.equal(chargeTrial(false),80,'standing in the shown lane takes the charge');
assert.equal(chargeTrial(true),100,'sidestepping the locked lane avoids it');
const volley=createWorld(5,[]);volley.spawnDelay=999;volley.player.x=6;
volley.enemies=[{...brute,kind:'warden',r:1.5,x:0,z:0,t:.01,pattern:3,hp:900,maxHp:900}];
step(volley,{move:-1,aim:0,attack:false,dash:false});
assert.equal(volley.shots.length,12);assert.equal(volley.enemies[0].state,'recover');
