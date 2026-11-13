import {readFile} from 'node:fs/promises';
import {NodeIO} from '@gltf-transform/core';
import {ALL_EXTENSIONS} from '@gltf-transform/extensions';
import {MeshoptDecoder} from 'meshoptimizer';
import assert from 'node:assert/strict';
import { createWorld, step, DT, type Enemy, type Input } from '../src/sim/world.ts';
import { BOSS_IDS, bossMove, bossWindup, GAZE_HALF_WIDTH, SLAM_RADIUS, type BossId } from '../src/sim/bosses.ts';
import { WEAPON_IDS } from '../src/sim/weapons.ts';
import { SKILL_IDS } from '../src/sim/skills.ts';
import { packInput, unpackInput } from '../src/sim/input.ts';
import { bot } from '../src/dev/bot.ts';
import { EnemyThreat, enemyThreat } from '../src/render/enemy-threat.ts';
const idle:Input={move:-1,aim:512,attack:false,dash:false};
function arena(boss:BossId,pattern=1){
  const w=createWorld(73);w.spawnDelay=999;w.player.x=6;w.player.z=0;
  const e:Enemy={id:90,kind:'warden',boss,x:0,z:0,hp:900,maxHp:900,r:1.5,state:'windup',t:0,cd:0,dx:1,dz:0,hitDone:false,pattern,flash:0,spawn:0,burnT:0,burnCd:0};e.t=bossWindup(e);w.enemies=[e];return w;
}
for(let seed=0;seed<3;seed++){
  const w=createWorld(seed);w.floor=5;w.wavesInFloor=1;w.spawnDelay=DT/2;step(w,idle);
  assert.equal(w.enemies.find(e=>e.kind==='warden')?.boss,BOSS_IDS[seed]);
}
// Locked aim, exact contact shape, no early damage, a real dodge opening.
for(const [boss,pattern] of [['witness',1],['cantor',2]] as const){
  for(const avoid of [false,true]){
    const w=arena(boss,pattern),e=w.enemies[0];
    w.player.x=boss==='witness'?8:4;
    w.player.z=avoid?(boss==='witness'?GAZE_HALF_WIDTH+.01:4):0;
    const cue=enemyThreat(e)!;
    assert.equal(cue.shape,boss==='witness'?'charge':'circle');
    if(boss==='cantor')assert.equal(cue.radius,SLAM_RADIUS);
    while(e.t>DT){step(w,idle);assert.equal(w.player.hp,100);assert.equal(e.dx,1);assert.equal(e.dz,0);}
    step(w,idle);assert.equal(e.state,'recover');assert.equal(w.player.hp,avoid?100:boss==='witness'?81:77);
    for(let n=0;n<30;n++)step(w,idle);assert.equal(w.player.hp,avoid?100:boss==='witness'?81:77,'one contact only');
  }
}
for(const [boss,pattern,expected] of [['witness',3,10],['cantor',1,3]] as const){
  const w=arena(boss,pattern),e=w.enemies[0];e.t=DT/2;step(w,idle);assert.equal(w.shots.length,expected);assert.equal(e.state,'recover');
}
// Phase is locked at windup start: damage mid-warning cannot add extra rays.
const phase=arena('cantor',0);const pe=phase.enemies[0];pe.state='seek';pe.hp=440;step(phase,idle);assert.equal(pe.enraged,true);pe.t=DT/2;step(phase,idle);assert.equal(phase.shots.length,5);
for(const wid of WEAPON_IDS){
  const w=createWorld(1,[],{weaponId:wid,weaponLevel:0,armorLevel:0});w.spawnDelay=999;
  step(w,{...idle,attack:true});
  while(w.player.attackCd>.1)step(w,idle);
  step(w,{...idle,attack:true,aim:200}); // released before cooldown is ready
  for(let i=0;i<12;i++)step(w,idle);
  assert.equal(w.player.swingN,2,`${wid}: buffered tap runs once`);
  assert.equal(w.player.attackQueue,0);
  for(let i=0;i<60;i++)step(w,idle);assert.equal(w.player.swingN,2,`${wid}: no repeated ghost attacks`);
}
for(const cancel of ['dash','jump','cast'] as const){
  const w=createWorld(1,['ember']);w.spawnDelay=999;w.player.attackCd=.08;
  step(w,{...idle,attack:true});step(w,{...idle,[cancel]:true});
  for(let i=0;i<70;i++)step(w,idle);assert.equal(w.player.swingN,0,`${cancel} clears buffered attack`);
}
// Heavy damage rewards the recovery window exactly once; idle attacks do not.
for(const open of [false,true]){
  const w=arena('witness'),e=w.enemies[0];w.player.x=2;w.player.swingN=2;e.state=open?'recover':'windup';e.t=5;
  step(w,{...idle,attack:true});assert.equal(e.hp,900-(open?58:48));assert.equal(!!e.openingSpent,open);
  w.player.attackCd=w.player.swingT=0;w.player.swingN=2;step(w,{...idle,attack:true});assert.equal(e.hp,900-(open?58:48)-48,'no repeated recovery extension');
}
// Ranged finishers receive the same opening, not one bonus per staff projectile.
const ranged=arena('witness');ranged.enemies[0].state='recover';ranged.enemies[0].t=5;
ranged.shots=[{id:92,x:0,z:0,vx:0,vz:0,life:1,dmg:20,side:'player',heavy:true,finisher:true}];step(ranged,idle);assert.equal(ranged.enemies[0].hp,876);
const spellShot=arena('witness');spellShot.enemies[0].state='recover';spellShot.enemies[0].t=5;
spellShot.shots=[{id:93,x:0,z:0,vx:0,vz:0,life:1,dmg:20,side:'player',heavy:true}];step(spellShot,idle);
assert.equal(spellShot.enemies[0].hp,880);assert.equal(spellShot.enemies[0].openingSpent,undefined,'heavy spell preserves the basic-finisher opening');
// Fully packed-input replay for every boss/weapon, including active skills.
let rounds=0;
for(const boss of BOSS_IDS)for(const weaponId of WEAPON_IDS){
  const w=arena(boss),r=arena(boss);
  for(const q of [w,r]){const p=createWorld(73,SKILL_IDS,{weaponId,weaponLevel:2,armorLevel:1,core:'ember'}).player;p.x=6;p.z=0;p.charge=100;q.player=p;}
  for(let i=0;i<6000&&w.phase==='fight'&&w.enemies.some(e=>e.kind==='warden');i++){
    const input=unpackInput(packInput(bot(w)));step(w,input);step(r,input);
    assert.equal(JSON.stringify(w),JSON.stringify(r));
    assert.ok(w.shots.length<80,'bounded projectiles');
    assert.ok(w.enemies.every(e=>Number.isFinite(e.x+e.z+e.hp)));
    w.events.length=r.events.length=0;
  }
  assert.ok(w.phase==='dead'||!w.enemies.some(e=>e.kind==='warden'),`${boss}/${weaponId} terminates`);rounds++;
}
const threat=new EnemyThreat();const w=arena('witness');threat.sync(w.enemies[0],{x:3,z:2});assert.equal(threat.root.position.x,3);w.enemies[0].hp=0;threat.sync(w.enemies[0],w.enemies[0]);assert.equal(threat.root.visible,false);threat.dispose();
console.log(`Bosses: PASS (3 identities, locked tells/contact/dodge, phases, ${rounds} boss/weapon replays, buffered combos/cancel, one finisher opening, following tells)`);

await MeshoptDecoder.ready;
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({'meshopt.decoder':MeshoptDecoder});
const manifest=JSON.parse(await readFile(new URL('../public/assets/manifest.json',import.meta.url),'utf8'));
for(const id of ['witness','cantor']) {
  const spec=manifest.models[id];
  assert.ok(spec.bytes < 600_000, `${id}: packed asset budget`);
  const d=await io.read(new URL('../public'+spec.file,import.meta.url).pathname);
  const triangles=d.getRoot().listMeshes().flatMap(m=>m.listPrimitives()).reduce((n,p)=>n+(p.getIndices()?.getCount()??p.getAttribute('POSITION')!.getCount())/3,0);
  assert.ok(triangles<7000, `${id}: geometry budget`);
  for(const clip of ['idle','run','attack','death',...(id==='cantor'?['attack-slam']:[])]) assert.ok(d.getRoot().listAnimations().some(a=>a.getName()===clip), `${id}: ${clip}`);
  assert.ok(d.getRoot().listSkins().length>0);
  for(const t of d.getRoot().listTextures()) assert.ok((t.getSize()??[9999,9999]).every(n=>n<=512));
}
console.log('Boss assets: PASS (two animated rigs, required clips, <7k triangles and <600 KB each, 512px textures)');
