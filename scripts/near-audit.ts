import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFileSync, writeFileSync, existsSync, renameSync } from 'node:fs';
import { createWorld, createDuelWorld, step } from '../src/sim/world.ts';
import { packInput, unpackInput, SIM_VERSION } from '../src/sim/input.ts';
import { bot } from '../src/dev/bot.ts';
import { testnetProvider } from '../server/rpc.ts';

if (!process.argv.includes('--execute')) throw new Error('Authorized testnet verification only: pass --execute');
const config=JSON.parse(readFileSync('.data/near.json','utf8'));
assert.equal(config.network,'testnet');
const provider=testnetProvider(config.rpcUrl);
assert.equal((await provider.viewNodeStatus()).chain_id,'testnet');
const cookies=JSON.parse(readFileSync('.data/near-smoke-sessions.json','utf8')).cookies;
const path='.data/chain-audit-session.json';
const saved:any=existsSync(path)?JSON.parse(readFileSync(path,'utf8')):{version:SIM_VERSION,runs:{}};
assert.equal(saved.version,SIM_VERSION,'Keep each simulation audit in its own saved session');
const save=()=>{writeFileSync(path+'.tmp',JSON.stringify(saved),{mode:0o600});renameSync(path+'.tmp',path);};
const view=(method:string,args:Record<string,unknown>)=>provider.callFunction<any>({contractId:config.contractId,method,args});
async function api(name:string,path:string,body?:unknown){
 assert.ok(cookies[name]);
 const r=await fetch('http://127.0.0.1:8787/api/'+path,{method:body===undefined?'GET':'POST',headers:{Cookie:cookies[name],'Content-Type':'application/json'},body:body===undefined?undefined:JSON.stringify(body),signal:AbortSignal.timeout(90000)});
 const v:any=await r.json();if(!r.ok)throw new Error(`${name} ${path}: ${v.error}`);return v;
}
const original=await view('get_champion',{champion_id:'c09951f2-1696-4663-ac6c-ab91b7b4cac1'});assert.equal(original.coins,76);
for (const name of ['alice','bob']) {
 const profile=await api(name,'profile');assert.notEqual(profile.id,original.id);assert.equal(profile.chain.pending,false);
 let run=saved.runs[name];
 if(!run){run=saved.runs[name]={profile,startedAt:Date.now(),challenge:await api(name,'runs',{})};save();}
 if(!run.inputs){
  const c=run.challenge,w=createWorld(c.seed,c.skills,c.equipment),inputs:number[]=[];let jumps=0,plunges=0;
  while(!['dead','won'].includes(w.phase)&&w.tick<36000){
   const input=bot(w);
   if(w.phase==='fight'&&w.tick%180===60&&w.player.jumpCd<=0&&w.player.castT<=0&&w.player.dashT<=0){input.jump=true;input.attack=false;input.dash=false;input.technique=0;input.cast=false;input.ultimate=false;}
   if(w.player.jumpT>0){input.attack=true;input.dash=false;}
   inputs.push(packInput(input));step(w,input);
   for(const e of w.events){if(e.type==='jump')jumps++;if(e.type==='plunge')plunges++;}w.events.length=0;
  }
  assert.ok(['dead','won'].includes(w.phase));assert.ok(jumps>0&&plunges>0);
  run.inputs=inputs;run.combat={ticks:w.tick,jumps,plunges,kills:w.player.kills,floor:w.floor,outcome:w.phase};save();
 }
 console.log(`${name}: replay ready; ${run.combat.jumps} jumps, ${run.combat.plunges} plunges, ${run.combat.kills} kills`);
 if(!run.result){
  const end=run.startedAt+run.inputs.length*1000/60+1500;
  while(Date.now()<end){const left=end-Date.now();console.log(`${name}: silent replay pacing ${Math.ceil(left/1000)}s`);await new Promise(r=>setTimeout(r,Math.min(10000,left)));}
  run.result=await api(name,'results',{id:run.challenge.id,inputs:run.inputs});save();
 }
 const again=await api(name,'results',{id:run.challenge.id,inputs:run.inputs});assert.equal(again.receipt.signature,run.result.receipt.signature);
 const receiptId=`solo:${run.challenge.id}`;assert.ok(await view('receipt_applied',{receipt_id:receiptId}));
 const chain=await view('get_champion',{champion_id:profile.id});assert.equal(chain.coins,again.champion.coins);assert.equal(again.champion.chain.pending,false);
 run.confirmed={receiptId,championId:profile.id,coins:run.result.champion.coins,runs:run.result.champion.runs,transaction:run.result.champion.chain.lastTransaction,duplicateSafe:true};save();
 console.log(`${name}: confirmed on testnet; ${chain.coins} coin; duplicate submission unchanged`);
}
assert.equal((await view('get_champion',{champion_id:original.id})).coins,76);
writeFileSync('.data/chain-audit-proof.json',JSON.stringify({network:'testnet',contractId:config.contractId,version:SIM_VERSION,verifiedAt:new Date().toISOString(),runs:Object.fromEntries(Object.entries(saved.runs).map(([k,v]:[string,any])=>[k,{...v.confirmed,...v.combat}]))},null,2)+'\n');

// Resumable paid checks use only the two existing test guests and their test funds.
saved.intents ??={};saved.economy ??={};const economy=saved.economy;
async function act(name:string,label:string,operation:string,data:Record<string,unknown>){
 const key=name+':'+label,id=saved.intents[key]??=randomUUID();save();
 let result;
 for(let n=0;n<20;n++){
  result=await api(name,'market',{id,operation,data});
  if(result.intent.complete){assert.ok(!result.intent.error,result.intent.error);return result;}
  await new Promise(r=>setTimeout(r,1500));
 }
 throw new Error(`${key} still pending; rerun with the same saved intent`);
}
if(!economy.round){
 const [a,b,m]=await Promise.all([api('alice','profile'),api('bob','profile'),api('alice','market')]);
 assert.ok(m.round&&m.revenueMode==='treasury');assert.ok(a.coins>=45&&b.coins>=10);
 economy.round=m.round.id;economy.before={alice:a,bob:b,treasury:m.treasuryYocto};save();
}
if(!economy.minted){
 await act('alice','reserve','reserve_mint',{roundId:economy.round,weaponId:'cinder-requiem'});
 const minted=await act('alice','mint','mint',{roundId:economy.round});
 economy.minted={tokenId:minted.market.reservation.tokenId,transaction:minted.intent.transaction};save();
 console.log('Mint: edition paid and NFT confirmed on testnet');
}
const tokenId=economy.minted.tokenId;
if(!economy.upgraded){
 await act('alice','equip','equip_gear',{slot:'weapon',gearId:tokenId});
 const id=saved.intents['alice:upgrade']??=randomUUID();save();
 let upgrade=await api('alice','upgrade',{slot:'weapon',id});
 for(let n=0;upgrade.champion.chain.pending&&n<20;n++){await new Promise(r=>setTimeout(r,1500));upgrade=await api('alice','upgrade',{slot:'weapon',id});}
 assert.equal(upgrade.champion.chain.pending,false);assert.ok(!upgrade.upgrade.error);assert.equal(upgrade.upgrade.level,1);
 const again=await api('alice','upgrade',{slot:'weapon',id});assert.equal(again.champion.coins,upgrade.champion.coins);assert.equal(again.champion.build.weaponLevel,1);
 const token=await view('nft_token',{token_id:tokenId});economy.upgraded={traits:JSON.parse(token.metadata.extra),coins:again.champion.coins,transaction:upgrade.champion.chain.lastTransaction};save();
 console.log('Upgrade: +1 confirmed; repeated request charged once');
}
const priceYocto='1000000000000000000000';
if(!economy.sold){
 await act('alice','unequip','unequip_gear',{slot:'weapon'});
 const listed=await act('alice','list','list_gear',{tokenId,priceYocto});
 economy.listing??=listed.market.listings.find((l:any)=>l.tokenId===tokenId);save();assert.ok(economy.listing);
 const quote={tokenId,priceYocto,listingId:economy.listing.id};
 const bought=await act('bob','buy','buy_gear',quote),again=await act('bob','buy','buy_gear',quote);
 assert.equal(bought.intent.transaction,again.intent.transaction);
 const token=await view('nft_token',{token_id:tokenId}),traits=JSON.parse(token.metadata.extra);
 assert.equal(token.owner_id,economy.before.bob.chain.accountId);
 for(const k of ['weaponId','level','kills','damage','reach'])assert.deepEqual(traits[k],economy.upgraded.traits[k]);
 assert.ok(traits.pastOwners.includes(economy.before.alice.chain.accountId));
 economy.sold={transaction:bought.intent.transaction,traits,owner:token.owner_id,duplicateSafe:true};save();
 console.log('Marketplace: paid resale, retained traits/owner history and duplicate protection confirmed');
}
if(!economy.withdrawn){
 const market=await api('alice','market');assert.ok(BigInt(market.proceedsYocto)>=BigInt(priceYocto)*9n/10n);
 const withdrawal=await act('alice','withdraw','withdraw_sales',{});
 assert.equal(withdrawal.market.proceedsYocto,'0');assert.equal(withdrawal.market.proceedsPending,false);
 economy.withdrawn={transaction:withdrawal.intent.transaction};save();
}
if(!economy.cancelled){
 await act('bob','equip-purchased','equip_gear',{slot:'weapon',gearId:tokenId});
 const purchased=await api('bob','profile');assert.equal(purchased.build.weaponId,'cinder-requiem');assert.equal(purchased.build.weaponLevel,1);
 await act('bob','restore-weapon','equip_gear',{slot:'weapon',gearId:economy.before.bob.equipped.weapon});
 const relisted=await act('bob','list-cancel','list_gear',{tokenId,priceYocto});
 economy.cancelListing??=relisted.market.listings.find((l:any)=>l.tokenId===tokenId);save();assert.ok(economy.cancelListing);
 const cancelled=await act('bob','cancel-sale','cancel_sale',{tokenId,listingId:economy.cancelListing.id});assert.ok(!cancelled.market.listings.some((l:any)=>l.tokenId===tokenId));
 const before=await api('alice','profile');economy.refundBefore??=before.coins;save();
 await act('alice','reserve-cancel','reserve_mint',{roundId:economy.round,weaponId:'widows-fang'});
 const refunded=await act('alice','cancel-mint','cancel_mint',{roundId:economy.round});assert.equal(refunded.champion.coins,economy.refundBefore);
 economy.cancelled=true;save();console.log('Inventory and refunds: purchased weapon equips; listing cancellation and mint-access refund confirmed');
}
if(!saved.duel){
 // Bring the existing defender into the public matchmaking band using earned coin.
 for (const skill of ['ember','spear-1','spear-2']) {
  const defender=await api('bob','profile');
  if(!defender.skills.includes(skill)) { const trained=await api('bob','train',{skill});assert.equal(trained.chain.pending,false); }
 }
 if((await api('bob','profile')).build.core!=='ember')await api('bob','attune',{core:'ember'});
 await api('bob','defense',{enabled:true});
 const lobby=await api('alice','duel-lobby');assert.ok(lobby.opponents.some((p:any)=>p.id===economy.before.bob.id),'Test guests must match before staking');
 const a=await api('alice','profile'),b=await api('bob','profile');
 saved.duel={before:a.coins+b.coins,startedAt:Date.now(),challenge:await api('alice','duels',{opponentId:b.id})};save();
}
const duel=saved.duel;
if(!duel.inputs){
 const c=duel.challenge,w=createDuelWorld(c.seed,c.challengerBuild,c.opponent.build),inputs:number[]=[];
 while(!['dead','won'].includes(w.phase)&&w.tick<6000){const input=bot(w);inputs.push(packInput(input));step(w,unpackInput(inputs.at(-1)!));w.events.length=0;}
 assert.ok(['dead','won'].includes(w.phase));duel.inputs=inputs;duel.outcome=w.phase;save();
}
if(!duel.result){
 const end=duel.startedAt+duel.inputs.length*1000/60+1500;
 while(Date.now()<end){const left=end-Date.now();console.log(`Duel: silent replay pacing ${Math.ceil(left/1000)}s`);await new Promise(r=>setTimeout(r,Math.min(10000,left)));}
 duel.result=await api('alice','results',{id:duel.challenge.id,inputs:duel.inputs});save();
}
const repeatedDuel=await api('alice','results',{id:duel.challenge.id,inputs:duel.inputs});assert.equal(repeatedDuel.receipt.signature,duel.result.receipt.signature);
const a=await view('get_champion',{champion_id:economy.before.alice.id}),b=await view('get_champion',{champion_id:economy.before.bob.id});
assert.equal(a.coins+b.coins,duel.before,'Duel stake is conserved');assert.equal(a.lockedBy,null);assert.equal(b.lockedBy,null);
const market=await api('alice','market');assert.equal(BigInt(market.treasuryYocto)-BigInt(economy.before.treasury),10000000000000000000000n+BigInt(priceYocto)/10n,'Mint price plus 10% resale royalty credited');
assert.equal((await view('get_champion',{champion_id:original.id})).coins,76);
const proof=JSON.parse(readFileSync('.data/chain-audit-proof.json','utf8'));
proof.economy={mint:economy.minted,upgrade:economy.upgraded,resale:economy.sold,withdrawal:economy.withdrawn,cancellationsAndEquip:true,treasuryAfter:market.treasuryYocto};
proof.duel={transaction:repeatedDuel.champion.chain.lastTransaction,outcome:duel.outcome,coinTotalBefore:duel.before,coinTotalAfter:a.coins+b.coins,locksReleased:true,duplicateSafe:true};
proof.verifiedAt=new Date().toISOString();writeFileSync('.data/chain-audit-proof.json',JSON.stringify(proof,null,2)+'\n');
console.log('End-to-end testnet audit PASS: Solo, mint, upgrade, resale, royalties, withdrawal, refunds, purchased gear, Duel and duplicate requests');
