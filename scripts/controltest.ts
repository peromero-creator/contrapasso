import assert from 'node:assert/strict';
import { SkillInputBuffer } from '../src/ui/skill-input.ts';
import { createWorld, step, DT } from '../src/sim/world.ts';
import { packInput, unpackInput } from '../src/sim/input.ts';
const world=createWorld(31,['sword-1','sword-2','nova-spell'],{weaponId:'starter',weaponLevel:0,armorLevel:0,spell:'nova-spell'});
world.spawnDelay=999;
const queue=new SkillInputBuffer(),idle={move:-1,aim:0,attack:false,dash:false};
step(world,{...idle,attack:true});queue.press(1);
let casts=0;
for(let i=0;i<30;i++) {
  const input={...idle,attack:true,...queue.take(world.player,false)};
  const decoded=unpackInput(packInput(input));
  world.events.length=0;
  step(world,decoded);
  casts+=world.events.filter(e=>e.stage==='charge').length;
}
assert.equal(casts,1,'one skill press during a held attack starts exactly once after recovery');
assert.equal(world.player.castId,'sword-1');
world.player.castT=0;world.player.swingT=0;world.player.attackCd=0;
queue.press(2);queue.press('cast');assert.deepEqual(queue.take(world.player,false),{cast:true},'most recent deliberate input wins');
queue.press(2);assert.deepEqual(queue.take(world.player,true),{});assert.deepEqual(queue.take(world.player,false),{},'dash cancels a pending skill');
queue.press(4);assert.deepEqual(queue.take(world.player,false),{},'unlearned skills are not queued');
queue.press('ultimate');assert.deepEqual(queue.take(world.player,false),{},'an uncharged ultimate is not stored for later');
world.player.castT=1;queue.press(2);for(let i=0;i<20;i++)assert.deepEqual(queue.take(world.player,false),{});
world.player.castT=0;assert.deepEqual(queue.take(world.player,false),{},'early presses expire during a long committed cast');
world.player.swingT=.1;queue.press(2);queue.clear();world.player.swingT=0;assert.deepEqual(queue.take(world.player,false),{},'pause/menu reset clears the pending input');
world.player.techniqueCd[1]=DT;queue.press(2);assert.deepEqual(queue.take(world.player,false),{technique:2});
console.log('Controls: PASS (attack-to-skill buffer, one-use input, existing replay codec, latest intent, dash/pause/expiry/paid gates)');
