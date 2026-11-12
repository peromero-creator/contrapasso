import assert from 'node:assert/strict';
import { loadoutWeapons } from '../src/ui/loadout.ts';
import type { NftToken } from '../src/shared/protocol.ts';
const token=(id:string, extra:Record<string,unknown>):NftToken=>({tokenId:id,ownerId:'owner',title:id,extra:{kind:'weapon',...extra}});
const rows=loadoutWeapons([
 token('own',{weaponId:'vesper-reed',level:3,kills:84}),
 token('legacy',{collection:'cinder-requiem',level:1}),
 token('bound',{bound:true,championId:'our-champion'}),
 token('foreign-bound',{bound:true,championId:'other'}),
 token('listed',{weaponId:'tollkeeper',listing:'sale-1'}),
 token('other-equipped',{weaponId:'gravewhisper',equippedTo:'other'}),
 token('equipped',{weaponId:'guillotine-hymn',equippedTo:'our-champion'}),
 token('armor',{kind:'armor'}),
],'our-champion');
assert.equal(rows.length,6);
assert.deepEqual(rows[0],{tokenId:'own',identity:'vesper-reed',level:3,kills:84,blocked:false});
assert.equal(rows[1].identity,'cinder-requiem');
assert.equal(rows.find(t=>t.tokenId==='listed')!.blocked,true);
assert.equal(rows.find(t=>t.tokenId==='other-equipped')!.blocked,true);
assert.equal(rows.find(t=>t.tokenId==='equipped')!.blocked,false);
console.log('Loadout: PASS (owned gear, bound champion, sale locks, legacy identity, retained upgrades and kills)');
