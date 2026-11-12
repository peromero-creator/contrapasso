import assert from 'node:assert/strict';
import { createWorld, createDuelWorld, step, type Enemy, type Input } from '../src/sim/world.ts';
import { TECHNIQUE_IDS, TECHNIQUES, FAMILY_WEAPON, techniqueParents, type Family } from '../src/sim/techniques.ts';
import { SPELL_IDS, SPELLS } from '../src/sim/abilities.ts';
import { canLearn, type SkillId } from '../src/sim/skills.ts';
import { packInput, unpackInput } from '../src/sim/input.ts';
const idle: Input = { move:-1, aim:0, attack:false, dash:false };
const target = (x=2,z=0): Enemy => ({id:100,kind:'brute',x,z,hp:3000,maxHp:3000,r:.5,state:'recover',t:100,cd:100,dx:0,dz:0,hitDone:false,pattern:0,flash:0,spawn:0,burnT:0,burnCd:100});
function arena(skills: SkillId[], identity: keyof typeof import('../src/sim/weapons.ts').WEAPONS = 'starter') {
 const w=createWorld(17,skills,{weaponId:identity,weaponLevel:0,armorLevel:0,core:'ember'}); w.spawnDelay=100;w.player.x=w.player.z=0;w.enemies=[target()];return w;
}
for (const technique of [0,1,2,3,4]) for(const cast of [false,true]) for(const ultimate of [false,true]) {
 const input={...idle,cast,ultimate,technique,choice:0};assert.deepEqual(unpackInput(packInput(input)),input);
}
for(const value of [5<<27,6<<27,7<<27,0x40000000]) assert.throws(()=>unpackInput(value));
for(const id of TECHNIQUE_IDS) {
 const t=TECHNIQUES[id], family=id.split('-')[0] as Family, slot=Number(id.slice(-1));
 const a=arena([id,'ember'],FAMILY_WEAPON[family]);a.player.skills.ember=0;
 // Targets sit in the post-lunge contact lane, still inside the arena.
 a.enemies[0].x=2+Math.max(0,t.dash??0);
 const replay=structuredClone(a);
 for(let i=0;i<160;i++) {
  const input={...idle,technique:i===0||i===80?slot:0};
  step(a,input);step(replay,unpackInput(packInput(input)));assert.deepEqual(a,replay,`${id} replay tick ${i}`);
  if(i < Math.floor(t.contact*60)) assert.equal(a.enemies[0].hp,3000,`${id} hit before contact`);
  a.events.length=replay.events.length=0;
 }
 assert.ok(a.enemies[0].hp<3000,`${id} must hit`);
 assert.equal(a.player.castN,1,`${id} cooldown must prevent repeat`);
 assert.ok(a.player.charge>0,`${id} must charge equipped core`);
 const locked=arena([],FAMILY_WEAPON[family]);step(locked,{...idle,technique:slot});assert.equal(locked.player.castN,0);
 const wrong=arena([id],family==='sword'?'vesper-reed':'starter');step(wrong,{...idle,technique:slot});assert.equal(wrong.player.castN,0,'wrong weapon must reject technique');
 const parents=techniqueParents(id);assert.ok(canLearn(parents,id));if(parents.length)assert.ok(!canLearn(parents.slice(1),id));
}
// A lane misses a lateral target, a radial technique hits it; healing respects the cap.
const line=arena(['spear-1'],'acheron-needle');line.enemies=[target(0,3)];
for(let i=0;i<60;i++)step(line,{...idle,technique:i===0?1:0});assert.equal(line.enemies[0].hp,3000);
const circle=arena(['staff-3'],'vesper-reed');circle.player.hp=98;circle.enemies=[target(0,3)];
for(let i=0;i<60;i++)step(circle,{...idle,technique:i===0?3:0});assert.ok(circle.enemies[0].hp<3000);assert.equal(circle.player.hp,100);assert.ok(circle.enemies[0].z<3,'harvest pulls');
for(const spell of SPELL_IDS) {
 const w=arena([SPELLS[spell].skill]);w.player.spell=spell;w.player.hp=50;
 const a=structuredClone(w);
 for(let i=0;i<80;i++){const input={...idle,cast:i===0};step(w,input);step(a,unpackInput(packInput(input)));assert.deepEqual(w,a);w.events.length=a.events.length=0;}
 assert.ok(w.enemies[0].hp<3000,`${spell} makes contact`);
 if(spell==='siphon-spell')assert.ok(w.player.hp>50);
 const locked=arena([]);locked.player.spell=spell;step(locked,{...idle,cast:true});assert.equal(locked.player.castN,0);
}
// Q's first-contact weaving bonus also works on techniques, without multiplying every pulse.
const weave=arena(['sword-3']);weave.player.weaveT=2;
for(let i=0;i<100;i++)step(weave,{...idle,technique:i===0?3:0});
assert.equal(weave.player.weaveT,0);assert.equal(weave.enemies[0].hp,3000-Math.round(22*1.25)-44);
const lethal=arena(['staff-3'],'vesper-reed');lethal.player.hp=1;lethal.enemies[0].skills={reprisal:3};
for(let i=0;i<60;i++)step(lethal,{...idle,technique:i===0?3:0});assert.equal(lethal.player.hp,0,'harvest cannot resurrect retaliation death');
const build={skills:{'staff-1':1},weaponId:'vesper-reed' as const,weaponLevel:0,armorLevel:0};
const duel=createDuelWorld(12,build,build);duel.player.x=0;duel.player.z=0;duel.enemies[0].x=4;duel.enemies[0].z=0;duel.enemies[0].spawn=0;duel.enemies[0].cd=0;
step(duel,idle);assert.equal(duel.enemies[0].ability?.castId,'staff-1');
console.log('Weapon techniques: PASS (28 techniques, timed contacts, 30-bit replay, weapon/paid gates, converging prerequisites, charge, cooldowns, geometry, healing, Q selection, one-use combos and Duel casts)');

const { Referee } = await import('../server/referee.ts');
const { buildPower, sameBuild } = await import('../src/sim/build.ts');
const referee = new Referee();const owner=referee.createSession().owner;
// Isolated in-memory test fixture: no saved profiles or testnet coins are modified.
(referee as any).state.accounts[owner].coins=300;
assert.throws(()=>referee.train(owner,'sword-4'),/preceding/);
assert.throws(()=>referee.attune(owner,'nova-spell','spell'),/Learn/);
referee.train(owner,'sword-1');referee.train(owner,'sword-2');
assert.throws(()=>referee.train(owner,'sword-4'),/preceding/);
referee.train(owner,'sword-3');referee.train(owner,'sword-4');referee.train(owner,'nova-spell');
referee.attune(owner,'nova-spell','spell');
assert.equal(referee.profile(owner).coins,115);
assert.equal(referee.begin(owner).equipment.spell,'nova-spell');
assert.throws(()=>referee.train(owner,'sword-1'),/already/);
assert.throws(()=>referee.attune(owner,'invented','spell'),/Learn/);
assert.throws(()=>referee.attune(owner,'nova-spell','invented'),/Unknown/);
const power={skills:{'staff-1':1},weaponId:'starter' as const,weaponLevel:0,armorLevel:0};
assert.equal(buildPower(power),20,'inactive weapon knowledge cannot inflate Duel matching');
assert.equal(buildPower({...power,weaponId:'vesper-reed'}),22);
assert.equal(sameBuild({...power,spell:'lance'},{...power,spell:'nova-spell'}),false);
console.log('Weapon progression: PASS (earned-coin deductions, two-parent capstone, duplicate rejection, authenticated Q loadout and active-weapon Duel power)');
