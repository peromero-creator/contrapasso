import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { createWorld, step } from '../src/sim/world.ts';
import { packInput } from '../src/sim/input.ts';
import { bot } from '../src/dev/bot.ts';
import { weaponTechniques, techniqueId } from '../src/sim/techniques.ts';
import { isSpell } from '../src/sim/abilities.ts';
import { testnetProvider } from '../server/rpc.ts';
if(!process.argv.includes('--execute'))throw new Error('Authorized testnet writes require --execute');
const config=JSON.parse(readFileSync('.data/near.json','utf8'));
const provider=testnetProvider(config.rpcUrl);
assert.equal((await provider.viewNodeStatus()).chain_id,'testnet');
const cookies=JSON.parse(readFileSync('.data/near-smoke-sessions.json','utf8')).cookies;
const path='.data/near-weapon-skills-session.json';
const saved:any=existsSync(path)?JSON.parse(readFileSync(path,'utf8')):{};
const save=()=>writeFileSync(path,JSON.stringify(saved),{mode:0o600});
async function api(path:string,body?:unknown){
 const r=await fetch(`http://127.0.0.1:5173/api/${path}`,{method:body===undefined?'GET':'POST',headers:{cookie:cookies.alice,'Content-Type':'application/json'},body:body===undefined?undefined:JSON.stringify(body),signal:AbortSignal.timeout(90000)});
 const value:any=await r.json();if(!r.ok)throw new Error(`${path}: ${value.error}`);return value;
}
let profile=await api('profile');
assert.notEqual(profile.id,'c09951f2-1696-4663-ac6c-ab91b7b4cac1');
assert.ok(profile.chain.features.includes('weapon_skills'));
if(!saved.before){saved.before={id:profile.id,coins:profile.coins,skills:profile.skills,weaponId:profile.build.weaponId};saved.training=[];save();}
for(const id of weaponTechniques(profile.build.weaponId)){
 if(!profile.skills.includes(id)){
  profile=await api('train',{skill:id});assert.equal(profile.chain.pending,false);assert.ok(profile.skills.includes(id));
  saved.training.push({skill:id,coinsAfter:profile.coins,transaction:profile.chain.lastTransaction});save();
 }
}
if(!saved.run){saved.startedAt=Date.now();saved.run=await api('runs',{});save();}
if(!saved.inputs){
 const w=createWorld(saved.run.seed,saved.run.skills,saved.run.equipment),inputs:number[]=[];let casts=0,ultimates=0;const techniques:Record<string,number>={};
 while(!['dead','won'].includes(w.phase)&&w.tick<36000){
  const input=bot(w);inputs.push(packInput(input));step(w,input);
  for(const e of w.events)if(e.type==='ability'&&e.stage==='charge'){if(techniqueId(e.ability))techniques[e.ability!]=(techniques[e.ability!]??0)+1;else if(isSpell(e.ability))casts++;else ultimates++;}
  w.events.length=0;
 }
 assert.ok(['dead','won'].includes(w.phase));assert.ok(Object.keys(techniques).length===4,'All four weapon techniques must execute');
 saved.inputs=inputs;saved.combat={ticks:w.tick,casts,ultimates,techniques,kills:w.player.kills,floor:w.floor,outcome:w.phase};save();
}
const finish=saved.startedAt+saved.combat.ticks*1000/60+1500;
while(Date.now()<finish){const left=finish-Date.now();console.log(`Silent replay: ${Math.ceil(left/1000)} seconds remaining`);await new Promise(r=>setTimeout(r,Math.min(30000,left)));}
const result=await api('results',{id:saved.run.id,inputs:saved.inputs});
const duplicate=await api('results',{id:saved.run.id,inputs:saved.inputs});
assert.equal(result.receipt.signature,duplicate.receipt.signature);assert.equal(result.champion.coins,duplicate.champion.coins);
saved.result=result;save();
const chain:any=await provider.callFunction({contractId:config.contractId,method:'get_champion',args:{champion_id:profile.id}});
assert.equal(chain.coins,result.champion.coins);for(const id of weaponTechniques(profile.build.weaponId))assert.ok(chain.skills.includes(id));
const original:any=await provider.callFunction({contractId:config.contractId,method:'get_champion',args:{champion_id:'c09951f2-1696-4663-ac6c-ab91b7b4cac1'}});assert.equal(original.coins,76);
const proof={network:'testnet',contractId:config.contractId,verifiedAt:new Date().toISOString(),championId:profile.id,before:saved.before,training:saved.training,combat:saved.combat,resultTransaction:result.champion.chain.lastTransaction,coinsAfter:chain.coins,skillsAfter:chain.skills,duplicateSafe:true,originalOwnerCoin:original.coins};
writeFileSync('docs/testnet-weapon-skills-proof.json',JSON.stringify(proof,null,2)+'\n');console.log(JSON.stringify(proof,null,2));
