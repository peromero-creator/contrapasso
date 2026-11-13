import assert from "node:assert/strict";
import { verify } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Referee, DAILY_CAP } from "../server/referee.ts";
import { createWorld, step } from "../src/sim/world.ts";
import { packInput, unpackInput } from "../src/sim/input.ts";
import { SKILLS, SKILL_IDS } from "../src/sim/skills.ts";
import { bot } from "../src/dev/bot.ts";

let now = Date.UTC(2026, 10, 12, 12);
const directory = mkdtempSync(join(tmpdir(), "contrapasso-referee-"));
try {
  const referee = new Referee({ directory, now: () => now, seed: () => 42 });
  const { owner } = referee.createSession();
  const stranger = referee.createSession().owner;
  assert.equal(referee.profile(owner).coins, 0);
  assert.throws(() => referee.train(owner, "iron"), /coin/);
  const challenge = referee.begin(owner);
  assert.throws(() => referee.submit(stranger, challenge.id, [0]), /not found/);
  assert.throws(() => referee.submit(owner, challenge.id, []), /length/);
  assert.throws(() => referee.submit(owner, challenge.id, [NaN]), /input/);
  assert.throws(() => referee.submit(owner, challenge.id, [packInput({ move: -1, aim: 0, attack: false, dash: false, choice: 1 })]), /selection/);
  assert.throws(() => referee.submit(owner, challenge.id, [0]), /Finish/);
  const play = (run: ReturnType<Referee["begin"]>) => {
    const world = createWorld(run.seed, run.skills); const inputs: number[] = [];
    while (world.phase !== "dead" && world.phase !== "won" && world.tick < 60 * 300) {
      const input = bot(world); inputs.push(packInput(input)); step(world, input); world.events.length = 0;
    }
    assert.ok(world.phase === "dead" || world.phase === "won");
    return { world, inputs };
  };
  const { world, inputs } = play(challenge);
  assert.throws(() => referee.submit(owner, challenge.id, inputs), /faster/);
  now += Math.ceil(world.tick / 60 * 1000);
  const first = referee.submit(owner, challenge.id, inputs);
  assert.equal(first.champion.coins, world.player.coins);
  assert.ok(verify(null, Buffer.from(JSON.stringify(first.receipt.result)), referee.publicKey, Buffer.from(first.receipt.signature, "base64")));
  const tampered = { ...first.receipt.result, awardedCoins: 99999 };
  assert.equal(verify(null, Buffer.from(JSON.stringify(tampered)), referee.publicKey, Buffer.from(first.receipt.signature, "base64")), false);
  assert.deepEqual(referee.submit(owner, challenge.id, inputs), first, "resubmission must not award twice");
  assert.throws(() => referee.submit(owner, challenge.id, [...inputs, 0]), /different result/);
  const restarted = new Referee({ directory, now: () => now });
  assert.deepEqual(restarted.profile(owner), first.champion, "coin and training survive restarts");
  for (let i = 0; i < 8; i++) {
    const run = referee.begin(owner, challenge.id); const next = play(run);
    assert.equal(run.seed, challenge.seed);
    now += Math.ceil(next.world.tick / 60 * 1000);
    referee.submit(owner, run.id, next.inputs);
  }
  assert.equal(referee.profile(owner).earnedToday, DAILY_CAP);
  assert.equal(referee.profile(owner).coins, DAILY_CAP);
  const trained = referee.train(owner, "iron");
  assert.equal(trained.coins, DAILY_CAP - SKILLS.iron.cost);
  assert.deepEqual(trained.skills, ["iron"]);
  assert.throws(() => referee.train(owner, "iron"), /already/);
  assert.throws(() => referee.train(owner, "unknown"), /Unknown/);
  const next = referee.begin(owner); assert.deepEqual(next.skills, ["iron"]);
  const replacement = referee.begin(owner, undefined, next.id);
  assert.throws(() => referee.submit(owner, next.id, [0]), /not found/);
  now += 31 * 60_000;
  assert.throws(() => referee.submit(owner, replacement.id, [0]), /expired/);
  now += 24 * 60 * 60_000;
  assert.equal(referee.profile(owner).earnedToday, 0);
  for (let i = 0; i < 12; i++) {
    now += 24 * 60 * 60_000;
    const run = referee.begin(owner); const next = play(run);
    now += Math.ceil(next.world.tick / 60 * 1000);
    referee.submit(owner, run.id, next.inputs);
  }
  for (const id of SKILL_IDS.filter(id => !id.includes("-"))) if (!referee.profile(owner).skills.includes(id)) referee.train(owner, id);
  const final = referee.begin(owner); const finish = play(final);
  now += Math.ceil(finish.world.tick / 60 * 1000);
  const won = referee.submit(owner, final.id, finish.inputs);
  assert.equal(won.receipt.result.outcome, "won");
  assert.equal(won.champion.victories, 1);
  // "+" upgrade: a forced good roll, then a forced bad one at a risky level
  const rolls = [0, 99];
  const forge = new Referee({ now: () => now, roll: () => rolls.shift()! });
  const smith = forge.createSession().owner;
  const account = (forge as unknown as { state: { accounts: Record<string, { coins: number; build: { weaponLevel: number } }> } }).state.accounts[smith];
  account.coins = 100;
  assert.deepEqual(forge.upgrade(smith, "weapon"), { slot: "weapon", success: true, level: 1, cost: 15 });
  account.build.weaponLevel = 4;
  assert.deepEqual(forge.upgrade(smith, "weapon"), { slot: "weapon", success: false, level: 4, cost: 55 });
  assert.equal(forge.profile(smith).coins, 30);
  assert.throws(() => forge.upgrade(smith, "weapon"), /coin/);
  assert.throws(() => forge.upgrade(smith, "ring"), /Unknown gear/);
  console.log("Referee: PASS (replay, ownership, signatures, tampering, idempotency, persistence, training, gear upgrades, daily cap, expiry)");
  // Both complete routes must verify: skip every boss or take all three gates.
  const gates = new Referee({directory:join(directory,"gates"),now:()=>now,seed:()=>5});
  for(const visit of [false,true]) {
    const player=gates.createSession().owner;
    const fixture=(gates as unknown as {state:{accounts:Record<string,any>}}).state.accounts[player];
    fixture.skills=[...SKILL_IDS];fixture.build.weaponLevel=3;fixture.build.armorLevel=3;fixture.build.core='ember';
    const challenge=gates.begin(player), w=createWorld(challenge.seed,challenge.skills,challenge.equipment);
    const replay:number[]=[], bosses=new Set<string>();
    for(let i=0;i<30000 && w.phase!=='won' && w.phase!=='dead';i++) {
      const input=packInput(bot(w,visit));replay.push(input);step(w,unpackInput(input));
      for(const e of w.enemies)if(e.boss)bosses.add(e.boss);
      w.events.length=0;
    }
    assert.equal(w.phase,'won');assert.deepEqual([...bosses],visit?['warden','witness','cantor']:[]);
    now+=Math.ceil(w.tick/60*1000);
    const result=gates.submit(player,challenge.id,replay);
    assert.equal(result.receipt.result.outcome,'won');
    assert.equal(result.champion.victories,1);
    assert.deepEqual(gates.submit(player,challenge.id,replay),result,'optional bosses cannot pay twice');
  }
  console.log('Optional boss routes: PASS (all three gates and all skips replayed by the referee; one settlement)');

} finally { rmSync(directory, { recursive: true, force: true }); }
