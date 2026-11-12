import { SPELL_IDS, SPELLS, spellId } from "../src/sim/abilities.ts";
import { coreId } from "../src/sim/abilities.ts";
import { WEAPON_IDS } from "../src/sim/weapons.ts";
import {
  MARKET_OPERATIONS,
  type MarketIntent,
  type MarketOperation,
} from "../src/shared/market.ts";
import {
  createHash,
  createPublicKey,
  generateKeyPairSync,
  randomBytes,
  randomInt,
  randomUUID,
  sign,
  type KeyObject,
} from "node:crypto";
import { mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { createWorld, createDuelWorld, step } from "../src/sim/world.ts";
import { SIM_VERSION, unpackInput } from "../src/sim/input.ts";
import {
  SKILL_IDS,
  SKILLS,
  canLearn,
  type SkillId,
} from "../src/sim/skills.ts";
import {
  copyBuild,
  fairMatch,
  DUEL_STAKE,
  MAX_GEAR_LEVEL,
  upgradeCost,
  upgradeChance,
} from "../src/sim/build.ts";
import type {
  Champion,
  Receipt,
  RunChallenge,
  RunResult,
  ChainOperation,
  ChainStatus,
  DuelOpponent,
  UpgradeOutcome,
} from "../src/shared/protocol.ts";

export const DAILY_CAP = 300;
export const MAX_TICKS = 60 * 60 * 20;
type Account = Omit<Champion, "dailyCap"> & {
  day: string;
  chainProvisioned?: boolean;
  /** Set once the champion NFT was handed to the player's own wallet. */
  claimedBy?: string;
  claimedSession?: string;
};
type Run = RunChallenge & {
  owner: string;
  createdAt: number;
  inputHash?: string;
  receipt?: Receipt;
  opponentOwner?: string;
  cancelled?: boolean;
  rejection?: string;
  progress?: number[];
};
interface State {
  schema: number;
  accounts: Record<string, Account>;
  runs: Record<string, Run>;
  outbox: ChainOperation[];
  marketIntents?: Record<string, MarketIntent & { owner: string }>;
}
export class RefereeError extends Error {
  status: number;
  constructor(message: string, status = 400) {
    super(message);
    this.status = status;
  }
}
function demand(test: unknown, message: string, status = 400): asserts test {
  if (!test) throw new RefereeError(message, status);
}

export class Referee {
  private state: State;
  private key: KeyObject;
  readonly publicKey: string;
  readonly publicKeyHex: string;
  private file: string | null;
  private now: () => number;
  private nextSeed: () => number;
  /** 0..99, drawn for each "+" attempt and signed into its receipt. */
  private roll: () => number;
  private persisted = "";

  constructor(
    options: {
      directory?: string;
      now?: () => number;
      key?: KeyObject;
      seed?: () => number;
      roll?: () => number;
    } = {},
  ) {
    this.now = options.now ?? Date.now;
    this.nextSeed = options.seed ?? (() => randomBytes(4).readUInt32LE());
    this.roll = options.roll ?? (() => randomInt(100));
    this.file = options.directory
      ? join(options.directory, "state.json")
      : null;
    this.key = options.key ?? generateKeyPairSync("ed25519").privateKey;
    const publicKey = createPublicKey(this.key);
    this.publicKey = publicKey
      .export({ type: "spki", format: "pem" })
      .toString();
    this.publicKeyHex = Buffer.from(
      publicKey.export({ format: "jwk" }).x!,
      "base64url",
    ).toString("hex");
    this.state = { schema: 2, accounts: {}, runs: {}, outbox: [] };
    if (this.file) {
      mkdirSync(options.directory!, { recursive: true, mode: 0o700 });
      try {
        const saved = JSON.parse(readFileSync(this.file, "utf8"));
        if (![1, 2].includes(saved.schema) || !saved.accounts || !saved.runs)
          throw new Error("Unsupported referee state");
        this.state = { ...saved, schema: 2, outbox: saved.outbox ?? [] };
      } catch (e) {
        if ((e as NodeJS.ErrnoException).code !== "ENOENT") throw e;
      }
    }
    for (const a of Object.values(this.state.accounts)) {
      a.equipped ??= { weapon: `weapon:${a.id}`, armor: `armor:${a.id}` };
      a.build ??= { skills: {}, weaponLevel: 0, armorLevel: 0 };
      if (!a.bestFloor && a.runs) {
        const best = Object.values(this.state.runs)
          .filter(
            (r) => r.receipt?.result.championId === a.id && r.mode !== "duel",
          )
          .sort((a, b) => b.receipt!.result.floor - a.receipt!.result.floor)[0]
          ?.receipt?.result;
        if (best) {
          a.bestFloor = best.floor;
          a.build.skills = { ...best.powers };
        }
      }
      a.bestFloor ??= 0;
      a.duelWins ??= 0;
      a.duelLosses ??= 0;
      a.defending ??= false;
      a.lockedBy ??= null;
      for (const id of a.skills)
        a.build.skills[id] = Math.max(a.build.skills[id] ?? 0, 1);
      if (
        !a.chainProvisioned &&
        !this.state.outbox.some(
          (e) => e.championId === a.id && e.operation === "register",
        )
      )
        this.register(a);
    }
    this.persisted = JSON.stringify(this.state);
    this.save();
  }
  private save() {
    if (!this.file) return;
    const serialized = JSON.stringify(this.state);
    try {
      writeFileSync(`${this.file}.tmp`, serialized, { mode: 0o600 });
      renameSync(`${this.file}.tmp`, this.file);
      this.persisted = serialized;
    } catch (e) {
      this.state = JSON.parse(this.persisted);
      throw e;
    }
  }
  private enqueue(operation: ChainOperation) {
    this.state.outbox.push(operation);
  }
  private register(a: Account) {
    this.enqueue({
      id: `register:${a.id}`,
      operation: "register",
      championId: a.id,
      data: {
        coins: a.coins,
        skills: [...a.skills],
        runs: a.runs,
        victories: a.victories,
        earnedToday: a.earnedToday,
        day: Math.floor(Date.parse(`${a.day}T00:00:00Z`) / 86400000),
        build: copyBuild(a.build),
        bestFloor: a.bestFloor,
      },
    });
  }
  private account(owner: string, playable = false): Account {
    this.expireDuels();
    const a = this.state.accounts[owner];
    demand(a, "Session expired. Reload and try again.", 401);
    if (playable)
      demand(
        !this.state.outbox.some(
          (e) =>
            e.championId === a.id &&
            (e.operation === "claim" ||
              MARKET_OPERATIONS.includes(e.operation as MarketOperation)),
        ),
        "Your champion has a pending transfer or market action. Confirm it first.",
        409,
      );
    const day = new Date(this.now()).toISOString().slice(0, 10);
    if (a.day !== day) {
      a.day = day;
      a.earnedToday = 0;
    }
    return a;
  }
  private expireDuels() {
    let changed = false;
    for (const run of Object.values(this.state.runs)) {
      if (
        run.mode !== "duel" ||
        run.receipt ||
        run.cancelled ||
        run.expiresAt > this.now()
      )
        continue;
      const a = this.state.accounts[run.owner],
        b = this.state.accounts[run.opponentOwner!];
      if (a?.lockedBy !== run.duelId || b?.lockedBy !== run.duelId) continue;
      // Leaving/refreshing cannot turn a losing stake into a free retry.
      b.coins += 2 * DUEL_STAKE;
      a.duelLosses++;
      b.duelWins++;
      a.lockedBy = b.lockedBy = null;
      run.cancelled = true;
      this.enqueue({
        id: `expire:${run.id}`,
        operation: "duel_expire",
        championId: a.id,
        opponentId: b.id,
        data: { duelId: run.duelId },
      });
      changed = true;
    }
    if (changed) this.save();
  }
  hasSession(owner: string) {
    return !!this.state.accounts[owner];
  }
  createSession(): { token: string; owner: string } {
    demand(
      Object.keys(this.state.accounts).length < 1000,
      "Guest capacity reached.",
      503,
    );
    const token = randomBytes(32).toString("base64url");
    const owner = createHash("sha256").update(token).digest("hex");
    const a = this.freshAccount();
    this.state.accounts[owner] = a;
    this.register(a);
    this.save();
    return { token, owner };
  }
  private freshAccount(): Account {
    const a: Account = {
      id: randomUUID(),
      coins: 0,
      skills: [],
      runs: 0,
      victories: 0,
      earnedToday: 0,
      day: new Date(this.now()).toISOString().slice(0, 10),
      build: { skills: {}, weaponLevel: 0, armorLevel: 0 },
      bestFloor: 0,
      duelWins: 0,
      duelLosses: 0,
      defending: false,
      lockedBy: null,
    };
    a.equipped = { weapon: `weapon:${a.id}`, armor: `armor:${a.id}` };
    return a;
  }
  profile(owner: string): Champion {
    const {
      day: _day,
      chainProvisioned: _provisioned,
      claimedBy: _claimed,
      claimedSession: _session,
      ...profile
    } = this.account(owner);
    return {
      ...profile,
      pendingClaim: this.pendingClaim(profile.id),
      skills: [...profile.skills],
      build: copyBuild(profile.build),
      dailyCap: DAILY_CAP,
      chain: profile.chain
        ? {
            ...profile.chain,
            pending: this.state.outbox.some(
              (e) => e.championId === profile.id || e.opponentId === profile.id,
            ),
          }
        : undefined,
    };
  }
  begin(owner: string, retry?: unknown, abandon?: unknown): RunChallenge {
    const a = this.account(owner, true);
    demand(!a.lockedBy, "Finish your Duel first.");
    const now = this.now();
    if (typeof abandon === "string") {
      const old = this.state.runs[abandon];
      if (old?.owner === owner && !old.receipt && old.mode !== "duel")
        delete this.state.runs[abandon];
    }
    const active = Object.values(this.state.runs).filter(
      (r) =>
        r.owner === owner && !r.receipt && !r.cancelled && r.expiresAt > now,
    );
    demand(
      active.length < 3,
      "Too many unfinished descents. Finish one or wait for it to expire.",
      429,
    );
    let seed = this.nextSeed() >>> 0,
      skills = [...a.skills];
    let equipment: RunChallenge["equipment"] = {
      weaponLevel: a.build.weaponLevel,
      weaponId: a.build.weaponId,
      core: a.build.core,
      spell: a.build.spell,
      armorLevel: a.build.armorLevel,
    };
    if (retry !== undefined) {
      demand(typeof retry === "string", "Invalid descent.");
      const old = this.state.runs[retry];
      demand(
        old?.owner === owner && old.receipt && old.mode === "solo",
        "That descent is unavailable.",
        404,
      );
      seed = old.seed;
      skills = [...old.skills];
      equipment = { ...old.equipment };
    }
    const run: Run = {
      id: randomUUID(),
      mode: "solo",
      version: SIM_VERSION,
      seed,
      skills,
      equipment,
      expiresAt: now + 30 * 60000,
      owner,
      createdAt: now,
    };
    this.storeRun(run);
    return this.challenge(run);
  }
  private storeRun(run: Run) {
    this.state.runs[run.id] = run;
    const old = Object.values(this.state.runs)
      .filter(
        (r) =>
          r.receipt ||
          r.cancelled ||
          (r.mode !== "duel" && r.expiresAt < this.now()),
      )
      .sort((a, b) => a.createdAt - b.createdAt);
    const excess = Math.max(0, Object.keys(this.state.runs).length - 1000);
    for (const item of old.slice(0, excess)) delete this.state.runs[item.id];
    this.save();
  }
  private challenge(run: Run): RunChallenge {
    const {
      owner: _owner,
      createdAt: _at,
      inputHash: _hash,
      receipt: _receipt,
      opponentOwner: _opponent,
      cancelled: _cancelled,
      rejection: _rejection,
      progress,
      ...challenge
    } = run;
    return structuredClone({
      ...challenge,
      resumeInputs: run.mode === "duel" ? (progress ?? []) : undefined,
    });
  }
  attune(owner: string, value: unknown, slot: unknown = "core"): Champion {
    const a = this.account(owner, true);
    demand(!a.lockedBy, "Finish your Duel first.");
    demand(slot === "core" || slot === "spell", "Unknown ability slot.");
    const core = coreId(value), spell = spellId(value);
    if (slot === "spell") {
      demand(SPELL_IDS.includes(value as any) && a.skills.includes(SPELLS[spell].skill), "Learn this spell first.");
      a.build.spell = spell;
    } else {
      demand(core && a.skills.includes(core), "Unlock this core skill first.");
      a.build.core = core;
    }
    this.enqueue({
      id: `attune:${randomUUID()}`,
      operation: "attune",
      championId: a.id,
      data: slot === "spell" ? { spell, slot } : { core },
    });
    this.save();
    return this.profile(owner);
  }
  train(owner: string, id: unknown): Champion {
    const a = this.account(owner, true);
    demand(!a.lockedBy, "Finish your Duel first.");
    demand(
      typeof id === "string" && SKILL_IDS.includes(id as SkillId),
      "Unknown power.",
    );
    const skill = id as SkillId;
    demand(!a.skills.includes(skill), "You already know this power.", 409);
    demand(canLearn(a.skills, skill), "Unlock the preceding skill first.", 409);
    demand(a.coins >= SKILLS[skill].cost, "Earn more coin in Solo first.");
    a.coins -= SKILLS[skill].cost;
    a.skills.push(skill);
    a.build.skills[skill] = Math.max(a.build.skills[skill] ?? 0, 1);
    this.enqueue({
      id: `train:${randomUUID()}`,
      operation: "train",
      championId: a.id,
      data: { skill },
    });
    this.save();
    return this.profile(owner);
  }
  /**
   * Hand the champion NFT (with equipped gear and vault) to the player's own wallet.
   * The guest session cannot play a champion it no longer owns, so it starts a new one.
   */
  pendingClaim(id: string) {
    const event = this.state.outbox.find(
      (e) => e.championId === id && e.operation === "claim",
    );
    return event
      ? { receiver: String(event.data.receiver), operationId: event.id }
      : undefined;
  }
  claim(
    owner: string,
    receiver: unknown,
    championId: unknown,
  ): { championId: string; receiver: string; pending: boolean } {
    demand(typeof championId === "string", "Choose the champion to transfer.");
    const completed = this.state.accounts[`claimed:${championId}`];
    if (completed) {
      demand(
        completed.claimedSession === owner && completed.claimedBy === receiver,
        "That champion has already moved.",
        409,
      );
      return { championId, receiver: String(receiver), pending: false };
    }
    const a = this.account(owner);
    demand(
      a.id === championId,
      "Your champion changed. Review the NFT page again.",
      409,
    );
    demand(!a.lockedBy, "Finish your Duel first.");
    demand(
      typeof receiver === "string" &&
        receiver.length <= 64 &&
        (/^(?:[a-z0-9]+(?:[-_][a-z0-9]+)*\.)+testnet$/.test(receiver) ||
          /^[a-f0-9]{64}$/.test(receiver)),
      "Enter a NEAR testnet account, like yourname.testnet.",
    );
    demand(a.chainProvisioned, "Your champion is not on testnet yet.", 409);
    demand(
      receiver !== a.chain?.accountId,
      "This champion already belongs to that account.",
    );
    const pending = this.pendingClaim(a.id);
    if (pending)
      demand(
        pending.receiver === receiver,
        "Another wallet transfer is pending.",
        409,
      );
    else {
      this.enqueue({
        id: `claim:${randomUUID()}`,
        operation: "claim",
        championId: a.id,
        data: { receiver },
      });
      this.save();
    }
    return { championId: a.id, receiver, pending: true };
  }
  /** Transaction that carried a claimed champion out, once the chain confirmed it. */
  claimTransaction(championId: string): string | undefined {
    return this.state.accounts[`claimed:${championId}`]?.chain?.lastTransaction;
  }
  /** One "+" attempt on equipped gear: burns coin, may raise the level. */
  upgrade(owner: string, slot: unknown): UpgradeOutcome {
    const a = this.account(owner, true);
    demand(!a.lockedBy, "Finish your Duel first.");
    demand(slot === "weapon" || slot === "armor", "Unknown gear.");
    const key = slot === "weapon" ? "weaponLevel" : "armorLevel";
    const level = a.build[key];
    demand(level < MAX_GEAR_LEVEL, "This gear is already +9.", 409);
    demand(a.equipped?.[slot], "Nothing is equipped in that slot.");
    const cost = upgradeCost(level);
    demand(a.coins >= cost, "Earn more coin in Solo first.");
    const roll = this.roll();
    const success = roll < upgradeChance(level);
    a.coins -= cost;
    if (success) a.build[key] = level + 1;
    this.enqueue({
      id: `upgrade:${randomUUID()}`,
      operation: "upgrade",
      championId: a.id,
      data: { slot, roll, fromLevel: level, gearId: a.equipped![slot] },
    });
    this.save();
    return { slot, success, level: a.build[key], cost };
  }
  defense(owner: string, enabled: unknown): Champion {
    const a = this.account(owner, true);
    demand(typeof enabled === "boolean", "Invalid defense setting.");
    demand(!a.lockedBy, "Finish your Duel first.");
    if (enabled)
      demand(
        a.coins >= DUEL_STAKE && a.runs > 0,
        "Play Solo and earn at least 10 coin first.",
      );
    a.defending = enabled;
    this.enqueue({
      id: `defense:${randomUUID()}`,
      operation: "defense",
      championId: a.id,
      data: { enabled },
    });
    this.save();
    return this.profile(owner);
  }
  opponents(owner: string): DuelOpponent[] {
    const a = this.account(owner);
    return Object.values(this.state.accounts)
      .filter(
        (b) =>
          b.id !== a.id &&
          b.defending &&
          !b.lockedBy &&
          b.coins >= DUEL_STAKE &&
          fairMatch(a.build, b.build),
      )
      .map((b) => ({
        id: b.id,
        name: `Sinner / ${b.id.slice(0, 8)}`,
        build: copyBuild(b.build),
        wins: b.duelWins,
        losses: b.duelLosses,
        coins: b.coins,
      }));
  }
  beginDuel(owner: string, opponentId: unknown): RunChallenge {
    const a = this.account(owner, true);
    if (a.lockedBy) {
      const active = this.state.runs[a.lockedBy];
      if (
        active?.owner === owner &&
        !active.receipt &&
        !active.cancelled &&
        active.opponent?.id === opponentId
      )
        return this.challenge(active);
    }
    demand(!a.lockedBy, "Finish your current Duel first.");
    demand(a.coins >= DUEL_STAKE, "Earn at least 10 coin in Solo first.");
    demand(typeof opponentId === "string", "Choose an opponent.");
    const targetEntry = Object.entries(this.state.accounts).find(
      ([_key, b]) => b.id === opponentId,
    );
    demand(targetEntry, "Opponent unavailable.", 404);
    const [opponentOwner, b] = targetEntry;
    demand(
      this.opponents(owner).some((o) => o.id === b.id),
      "Opponent is no longer available. Refresh the list.",
      409,
    );
    const id = randomUUID(),
      now = this.now();
    const opponent = this.opponents(owner).find((o) => o.id === b.id)!;
    const run: Run = {
      id,
      mode: "duel",
      version: SIM_VERSION,
      seed: this.nextSeed() >>> 0,
      skills: [...a.skills],
      equipment: {
        weaponLevel: a.build.weaponLevel,
        weaponId: a.build.weaponId,
        core: a.build.core,
      spell: a.build.spell,
        armorLevel: a.build.armorLevel,
      },
      challengerBuild: copyBuild(a.build),
      opponent,
      duelId: id,
      expiresAt: now + 10 * 60000,
      createdAt: now,
      owner,
      opponentOwner,
    };
    a.coins -= DUEL_STAKE;
    b.coins -= DUEL_STAKE;
    a.lockedBy = b.lockedBy = id;
    this.enqueue({
      id: `open:${id}`,
      operation: "duel_open",
      championId: a.id,
      opponentId: b.id,
      data: { duelId: id, opponentId: b.id, expiresAt: run.expiresAt },
    });
    this.storeRun(run);
    return this.challenge(run);
  }
  currentDuel(owner: string): RunChallenge | null {
    const a = this.account(owner);
    if (!a.lockedBy) return null;
    const run = this.state.runs[a.lockedBy];
    return run?.owner === owner && !run.cancelled && !run.receipt
      ? this.challenge(run)
      : null;
  }
  checkpoint(owner: string, id: unknown, inputs: unknown) {
    this.expireDuels();
    demand(typeof id === "string", "Invalid duel.");
    const run = this.state.runs[id];
    demand(
      run?.owner === owner &&
        run.mode === "duel" &&
        !run.receipt &&
        !run.cancelled &&
        run.expiresAt > this.now(),
      "Duel is no longer active.",
      409,
    );
    demand(
      Array.isArray(inputs) && inputs.length > 0 && inputs.length <= 90 * 60,
      "Invalid progress.",
    );
    demand(
      (run.progress ?? []).every((n, i) => inputs[i] === n),
      "Duel cannot rewind.",
    );
    demand(
      inputs.length <=
        Math.ceil(((this.now() - run.createdAt + 3000) * 60) / 1000),
      "Progress arrived too fast.",
    );
    const world = createDuelWorld(
      run.seed,
      run.challengerBuild!,
      run.opponent!.build,
    );
    for (const packed of inputs) {
      let input;
      try {
        input = unpackInput(packed);
      } catch {
        throw new RefereeError("Invalid progress.");
      }
      demand(
        !input.choice && world.phase !== "dead" && world.phase !== "won",
        "Invalid progress.",
      );
      step(world, input);
      world.events.length = 0;
    }
    run.progress = [...inputs];
    this.save();
    return { ticks: inputs.length };
  }
  submit(
    owner: string,
    id: unknown,
    inputs: unknown,
  ): { receipt: Receipt; champion: Champion } {
    this.expireDuels();
    demand(typeof id === "string", "Invalid descent.");
    const run = this.state.runs[id];
    demand(run?.owner === owner, "Descent not found.", 404);
    demand(
      !run.rejection,
      run.rejection ?? "Testnet rejected this descent.",
      409,
    );
    demand(
      Array.isArray(inputs) && inputs.length > 0 && inputs.length <= MAX_TICKS,
      "Invalid replay length.",
    );
    demand(
      (run.progress ?? []).every((n, i) => inputs[i] === n),
      "Duel cannot rewind.",
    );
    const inputHash = createHash("sha256")
      .update(JSON.stringify(inputs))
      .digest("hex");
    if (run.receipt) {
      demand(
        run.inputHash === inputHash,
        "This descent already has a different result.",
        409,
      );
      return { receipt: run.receipt, champion: this.profile(owner) };
    }
    demand(
      !run.cancelled && run.expiresAt > this.now(),
      "This descent has expired.",
      410,
    );
    demand(
      run.version === SIM_VERSION,
      "The game has updated. Start a new descent.",
      409,
    );
    const world =
      run.mode === "duel"
        ? createDuelWorld(run.seed, run.challengerBuild!, run.opponent!.build)
        : createWorld(run.seed, run.skills, run.equipment);
    for (const packed of inputs) {
      let input;
      try {
        input = unpackInput(packed);
      } catch {
        throw new RefereeError("Invalid replay input.");
      }
      demand(
        world.phase !== "dead" && world.phase !== "won",
        "Replay continues after the end.",
      );
      demand(
        world.phase === "reward" ? !!input.choice : !input.choice,
        "Invalid power selection.",
      );
      const tick = world.tick;
      step(world, input);
      demand(world.tick === tick + 1, "Invalid power selection.");
      world.events.length = 0;
    }
    demand(
      world.phase === "dead" || world.phase === "won",
      "Finish the descent before submitting.",
    );
    demand(
      this.now() - run.createdAt + 3000 >= (world.tick * 1000) / 60,
      "Replay arrived faster than it can be played.",
    );
    const a = this.account(owner);
    let awardedCoins = 0,
      coinDelta = 0;
    if (run.mode === "duel") {
      this.settleDuel(run, world.phase === "won");
      coinDelta = world.phase === "won" ? DUEL_STAKE : -DUEL_STAKE;
    } else {
      demand(!a.lockedBy, "Finish your Duel before saving Solo.");
      awardedCoins = Math.min(
        world.player.coins,
        Math.max(0, DAILY_CAP - a.earnedToday),
      );
      coinDelta = awardedCoins;
      a.coins += awardedCoins;
      a.earnedToday += awardedCoins;
      a.runs++;
      if (world.phase === "won") a.victories++;
      if (world.floor >= a.bestFloor) {
        a.bestFloor = world.floor;
        a.build.skills = { ...world.player.skills };
      }
      for (const skill of a.skills)
        a.build.skills[skill] = Math.max(a.build.skills[skill] ?? 0, 1);
      this.enqueue({
        id: `solo:${run.id}`,
        operation: "solo",
        championId: a.id,
        data: {
          earnedCoins: world.player.coins,
          floor: world.floor,
          kills: world.player.kills,
          won: world.phase === "won",
          powers: { ...world.player.skills },
        },
      });
    }
    const result: RunResult = {
      version: SIM_VERSION,
      runId: run.id,
      championId: a.id,
      seed: run.seed,
      outcome: world.phase,
      floor: world.floor,
      ticks: world.tick,
      kills: world.player.kills,
      earnedCoins: world.player.coins,
      awardedCoins,
      powers: { ...world.player.skills },
      mode: run.mode,
      coinDelta,
      opponentId: run.opponent?.id,
      duelId: run.duelId,
    };
    const receipt: Receipt = {
      result,
      signature: sign(
        null,
        Buffer.from(JSON.stringify(result)),
        this.key,
      ).toString("base64"),
    };
    run.inputHash = inputHash;
    run.receipt = receipt;
    this.save();
    return { receipt, champion: this.profile(owner) };
  }
  private settleDuel(run: Run, won: boolean) {
    const a = this.state.accounts[run.owner],
      b = this.state.accounts[run.opponentOwner!];
    demand(
      a.lockedBy === run.duelId && b.lockedBy === run.duelId,
      "Duel is no longer active.",
    );
    if (won) {
      a.coins += 2 * DUEL_STAKE;
      a.duelWins++;
      b.duelLosses++;
    } else {
      b.coins += 2 * DUEL_STAKE;
      a.duelLosses++;
      b.duelWins++;
    }
    a.lockedBy = b.lockedBy = null;
    this.enqueue({
      id: `settle:${run.id}`,
      operation: "duel_settle",
      championId: a.id,
      opponentId: b.id,
      data: { duelId: run.duelId, won },
    });
  }
  forfeit(owner: string, id: unknown): Champion {
    this.expireDuels();
    demand(typeof id === "string", "Invalid duel.");
    const run = this.state.runs[id];
    demand(run?.owner === owner && run.mode === "duel", "Duel not found.", 404);
    if (run.receipt || run.cancelled) return this.profile(owner);
    this.settleDuel(run, false);
    run.cancelled = true;
    this.save();
    return this.profile(owner);
  }
  marketIntent(owner: string, id: unknown): MarketIntent | null {
    if (typeof id !== "string") return null;
    const saved = this.state.marketIntents?.[id];
    if (!saved) return null;
    demand(
      saved.owner === owner,
      "This action belongs to another session.",
      403,
    );
    const { owner: _owner, ...publicIntent } = saved;
    return structuredClone(publicIntent);
  }
  queueMarket(
    owner: string,
    id: unknown,
    operation: unknown,
    raw: unknown,
  ): MarketIntent {
    demand(
      typeof id === "string" && /^[a-f0-9-]{36}$/.test(id),
      "Invalid action id.",
    );
    demand(
      typeof operation === "string" &&
        MARKET_OPERATIONS.includes(operation as MarketOperation),
      "Unknown market action.",
    );
    demand(
      raw && typeof raw === "object" && !Array.isArray(raw),
      "Invalid market data.",
    );
    const body = raw as Record<string, unknown>,
      data: Record<string, unknown> = {};
    if (
      ["reserve_mint", "cancel_mint", "mint", "tickets", "draw_round"].includes(
        operation,
      )
    ) {
      demand(
        typeof body.roundId === "string" &&
          /^[a-z0-9-]{1,40}$/.test(body.roundId),
        "Choose a mint round.",
      );
      data.roundId = body.roundId;
    }
    if (operation === "tickets") {
      demand(
        Number.isSafeInteger(body.count) &&
          Number(body.count) > 0 &&
          Number(body.count) <= 10,
        "Choose 1 to 10 tickets.",
      );
      data.count = body.count;
    }
    if (operation === "reserve_mint" && body.weaponId !== undefined) {
      demand(
        WEAPON_IDS.some((id) => id !== "starter" && id === body.weaponId),
        "Unknown relic.",
      );
      data.weaponId = body.weaponId;
    }
    if (["list_gear", "cancel_sale", "buy_gear"].includes(operation)) {
      demand(
        typeof body.tokenId === "string" &&
          /^relic:[a-z0-9-]+:[0-9]+$/.test(body.tokenId) &&
          body.tokenId.length <= 160,
        "Choose a tradable gear NFT.",
      );
      data.tokenId = body.tokenId;
      if (operation !== "list_gear") {
        demand(
          typeof body.listingId === "string" && body.listingId.length <= 190,
          "Choose a listing.",
        );
        data.listingId = body.listingId;
      }
      if (operation !== "cancel_sale") {
        demand(
          typeof body.priceYocto === "string" &&
            /^[0-9]{1,25}$/.test(body.priceYocto) &&
            BigInt(body.priceYocto) >= 10n ** 21n &&
            BigInt(body.priceYocto) <= 10n ** 24n,
          "Price must be 0.001 to 1 test NEAR.",
        );
        data.priceYocto = BigInt(body.priceYocto).toString();
      }
    }
    if (operation === "equip_gear" || operation === "unequip_gear") {
      demand(
        body.slot === "weapon" || body.slot === "armor",
        "Invalid gear slot.",
      );
      data.slot = body.slot;
      if (operation === "equip_gear") {
        demand(
          typeof body.gearId === "string" && body.gearId.length <= 160,
          "Choose a gear NFT.",
        );
        data.gearId = body.gearId;
      }
    }
    const existing = this.marketIntent(owner, id);
    if (existing) {
      demand(
        existing.operation === operation &&
          JSON.stringify(existing.data) === JSON.stringify(data),
        "Action id was used for different choices.",
        409,
      );
      return existing;
    }
    const a = this.account(owner, true);
    demand(
      a.chainProvisioned && !a.lockedBy,
      "Save your testnet champion and finish the Duel first.",
      409,
    );
    const intent = {
      id,
      owner,
      championId: a.id,
      operation: operation as MarketOperation,
      data,
      complete: false,
    };
    (this.state.marketIntents ??= {})[id] = intent;
    this.enqueue({
      id: `market:${id}`,
      operation: intent.operation,
      championId: a.id,
      data,
    });
    this.save();
    return this.marketIntent(owner, id)!;
  }
  pendingChainOperations(): ChainOperation[] {
    this.expireDuels();
    return structuredClone(this.state.outbox);
  }
  signChainPayload(payload: string): string {
    return sign(null, Buffer.from(payload), this.key).toString("hex");
  }
  chainProfile(id: string): Champion | null {
    const entry = Object.entries(this.state.accounts).find(
      ([_owner, a]) => a.id === id,
    );
    return entry ? this.profile(entry[0]) : null;
  }
  noteChainTransaction(id: string, transactionHash: string) {
    const event = this.state.outbox.find((e) => e.id === id);
    if (event) {
      event.transactionHash = transactionHash;
      this.save();
    }
  }
  acknowledgeChain(
    id: string,
    statuses: Record<string, ChainStatus>,
    states: Record<string, any> = {},
  ) {
    const event = this.state.outbox.find((e) => e.id === id);
    if (!event) return;
    for (const a of Object.values(this.state.accounts))
      if (statuses[a.id]) {
        a.chain = statuses[a.id];
        if (event.operation === "register" && event.championId === a.id)
          a.chainProvisioned = true;
      }
    if (event.operation === "claim") {
      const entry = Object.entries(this.state.accounts).find(
        ([owner, a]) =>
          !owner.startsWith("claimed:") && a.id === event.championId,
      );
      if (entry) {
        const [owner, a] = entry;
        a.defending = false;
        a.claimedBy = String(event.data.receiver);
        a.claimedSession = owner;
        this.state.accounts[`claimed:${a.id}`] = a;
        for (const run of Object.values(this.state.runs))
          if (run.owner === owner && !run.receipt) run.cancelled = true;
        const fresh = this.freshAccount();
        this.state.accounts[owner] = fresh;
        this.register(fresh);
      }
    }
    this.state.outbox = this.state.outbox.filter((e) => e.id !== id);
    const intent = this.state.marketIntents?.[id.replace(/^market:/, "")];
    if (intent) {
      intent.complete = true;
      intent.transaction = event.transactionHash;
      for (const [championId, state] of Object.entries(states))
        this.applyChainState(championId, state);
    }
    this.save();
  }
  /** Only called after chain views prove the operation cannot apply. No uncertain transaction is rolled back. */
  rejectChainOperation(
    id: string,
    states: Record<string, any>,
    reason: string,
  ) {
    const event = this.state.outbox.find((e) => e.id === id);
    if (!event) return;
    const intent = this.state.marketIntents?.[id.replace(/^market:/, "")];
    if (intent) {
      intent.complete = true;
      intent.error = reason;
      intent.transaction = event.transactionHash;
    }
    const runId =
      event.operation === "duel_open" ? event.data.duelId : undefined;
    this.state.outbox = this.state.outbox.filter(
      (e) => e.id !== id && (!runId || e.data.duelId !== runId),
    );
    if (runId && this.state.runs[String(runId)]) {
      const run = this.state.runs[String(runId)];
      run.cancelled = true;
      run.rejection = reason;
    }
    for (const [championId, state] of Object.entries(states))
      if (
        state &&
        !this.state.outbox.some(
          (e) => e.championId === championId || e.opponentId === championId,
        )
      )
        this.applyChainState(championId, state);
    this.save();
  }
  adoptChain(id: string, state: any) {
    demand(
      !this.state.outbox.some(
        (e) => e.championId === id || e.opponentId === id,
      ),
      "Champion save is pending.",
    );
    this.applyChainState(id, state);
    this.save();
  }
  private applyChainState(id: string, state: any) {
    const a = Object.values(this.state.accounts).find((a) => a.id === id);
    if (!a) return;
    for (const key of [
      "coins",
      "skills",
      "runs",
      "victories",
      "bestFloor",
      "duelWins",
      "duelLosses",
      "defending",
      "lockedBy",
      "build",
      "equipped",
      "prizeYocto",
    ] as const)
      (a as any)[key] = structuredClone(state[key]);
    a.earnedToday = state.earnedToday;
    a.day = new Date(this.now()).toISOString().slice(0, 10);
    if (a.chain) a.chain.revision = state.revision;
  }
}
