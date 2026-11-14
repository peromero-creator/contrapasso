import assert from 'node:assert/strict';
import * as T from 'three';
import { SkillWeight } from '../src/render/skill-weight.ts';
import { EnemyThreat } from '../src/render/enemy-threat.ts';
import { WeaponTrail } from '../src/render/weapon-trail.ts';
import { Sound } from '../src/audio/sound.ts';
import { inkFamily } from '../src/render/skill-ink.ts';
import type { Enemy } from '../src/sim/world.ts';
import { createWorld, step } from '../src/sim/world.ts';
import { Atmosphere } from '../src/render/atmosphere.ts';

// CPU-side canvas substitute: verify pooling and lifetime, not raster appearance.
const oldDocument=Object.getOwnPropertyDescriptor(globalThis,'document');
Object.defineProperty(globalThis,'document',{configurable:true,value:{createElement:()=>({width:0,height:0,getContext:()=>new Proxy({}, {get:()=>()=>{}})})}});
const scene=new T.Scene(),weight=new SkillWeight(scene);
// A real Ash Step dash emits a passive pulse, not a charged Reaping Orbit.
const dashWorld=createWorld(17,['ash']);
step(dashWorld,{move:-1,aim:0,attack:false,dash:true});
const dashPulse=dashWorld.events.find(e=>e.type==='ability'&&e.stage==='pulse')!;
assert.ok(dashPulse);assert.equal(dashPulse.side,undefined);
for(const ability of ['ash','iron','ember'] as const){
  assert.equal(weight.event({...dashPulse,ability}),null,'passive echoes cannot trigger ultimate camera response or hit-stop');
  assert.ok(weight.root.children.every(n=>!n.visible),'passive echoes cannot leave an ultimate aftermath');
}
assert.equal(weight.chain,0);
weight.event({type:'ability',stage:'charge',ability:'hammer-4',side:'player',x:0,z:0});
assert.equal(weight.event(dashPulse),null,'passive proc leaves the active skill response untouched');
const realContact=weight.event({type:'ability',stage:'pulse',ability:'hammer-4',side:'player',x:0,z:0})!;
assert.equal(realContact.stop,.045,'the actual committed heavy contact keeps its first-contact accent');
assert.equal(weight.chain,1);
// Ground stamps are disabled (owner request): skills land their camera weight but never draw an area.
assert.ok(weight.root.children.every(n=>!n.visible),'a committed skill draws no hitbox-style ground stamp');
weight.clear();
for(const ability of ['sword-1','hammer-2','staff-3'] as const){weight.event({type:'ability',stage:'charge',ability,side:'player',x:0,z:0});weight.event({type:'ability',stage:'pulse',ability,side:'player',x:0,z:0});}
assert.equal(weight.chain,3);assert.equal(weight.peakChain,3);
const tell=new EnemyThreat();tell.sync({kind:'warden',boss:'cantor',hp:100,spawn:0,state:'windup',pattern:2,t:.4,r:1,x:0,z:0,dx:1,dz:0} as Enemy,{x:0,z:0});
let highestPlayer=0;weight.root.traverse(o=>{if(o instanceof T.Mesh)highestPlayer=Math.max(highestPlayer,o.renderOrder);});
tell.root.traverse(o=>{if(o instanceof T.Mesh)assert.ok(o.renderOrder>highestPlayer,'enemy tells stay above player effects');});
weight.clear(false);assert.equal(weight.peakChain,3,'room transitions preserve the descent peak');
weight.clear();weight.event({type:'ability',stage:'charge',ability:'ash',side:'player',x:0,z:0});
for(let i=0;i<6;i++){weight.event({type:'ability',stage:'pulse',ability:'ash',side:'player',x:i,z:0});weight.update(.08);}
assert.equal(weight.root.children.filter(n=>n.visible).length,0,'orbit pulses leave no ground stamp');
weight.update(1);assert.ok(weight.root.children.every(n=>!n.visible));
for(let i=0;i<100;i++)weight.event({type:'ability',stage:'pulse',ability:'hammer-1',side:'player',x:i,z:0});
assert.equal(weight.root.children.length,6,'fixed stamp pool remains bounded');
assert.ok(weight.root.children.every(n=>!n.visible),'no stamp ever becomes visible');
const beforeFinisher=weight.root.children.map(s=>s.position.toArray());
weight.finisher(99,99,0,0xaabbcc);
assert.deepEqual(weight.root.children.map(s=>s.position.toArray()),beforeFinisher,'a finisher never evicts or draws');
weight.clear();weight.finisher(2,3,.6,0xaabbcc);
assert.ok(weight.root.children.every(n=>!n.visible),'closing brush marks are disabled with the stamps');
weight.update(.35);assert.ok(weight.root.children.every(n=>!n.visible));
weight.event({type:'ability',stage:'pulse',ability:'staff-2',side:'player',x:0,z:0});
assert.ok(weight.root.children.every(n=>!n.visible),'reused slots stay hidden');
weight.clear();assert.equal(weight.peakChain,0);
assert.equal(new Set(['ember','ash','iron'].map(id=>inkFamily(id as 'ember'))).size,3,'ultimates have distinct masks');
if(oldDocument)Object.defineProperty(globalThis,'document',oldDocument);else Reflect.deleteProperty(globalThis,'document');
const trailScene=new T.Scene(),trail=new WeaponTrail(trailScene),grip=new T.Group();
for(let i=0;i<300;i++){grip.rotation.y=i*.03;trail.update(1/120,grip,true,1.6,0xaabbcc,true);}
assert.equal(trailScene.children.length,1);assert.equal((trailScene.children[0] as T.Mesh).geometry.attributes.position.count,36);
trail.update(.2,grip,false,1.6,0xffffff,false);assert.equal(trailScene.children[0].visible,false);
let audioContexts=0;
Object.defineProperty(globalThis,'AudioContext',{configurable:true,value:class{constructor(){audioContexts++;throw new Error('Audio must stay locked');}}});
const sound=new Sound(true);sound.toggle();sound.muted=false;sound.unlock();sound.setVolume(1);sound.setPaused(false);
sound.consume([{type:'ability',stage:'charge',ability:'ember',side:'player',x:0,z:0},{type:'ability',stage:'pulse',ability:'ember',side:'player',x:0,z:0},{type:'ability',stage:'release',ability:'lance',side:'player',x:0,z:0},{type:'ability',stage:'pulse',ability:'sword-1',side:'player',x:0,z:0}]);
sound.bell();sound.bossWarn();sound.bossPhase();sound.bossDeath();sound.gateOpen();sound.rewardOpen();sound.rewardPick();sound.waveArrive();sound.say('limbo');
assert.equal(audioContexts,0,'silent mode never creates an audio context, including new presentation cues');
console.log('Polish: PASS (warning priority, bounded ink/trails, lasting orbit, distinct cores, hard audio lock, new cues silent under lock)');
const atmosphere=new Atmosphere(),buffer=atmosphere.mesh.instanceMatrix.array;
for(let i=0;i<3000;i++)atmosphere.update(1/120,i%6);
assert.equal(atmosphere.mesh.count,24);assert.equal(atmosphere.mesh.instanceMatrix.array,buffer);
assert.ok(Array.from(buffer).every(Number.isFinite));assert.equal(atmosphere.mesh.material.blending,T.NormalBlending);
assert.equal(atmosphere.mesh.material.forceSinglePass,true);
const paused=Array.from(buffer);atmosphere.update(1,5,true);assert.deepEqual(Array.from(buffer),paused,'reduced motion freezes ambient flecks');
atmosphere.mesh.geometry.dispose();atmosphere.mesh.material.dispose();
console.log('Atmosphere: PASS (24 reused instances, finite transforms, one pass, reduced motion)');
