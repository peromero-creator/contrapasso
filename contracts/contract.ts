import { WEAPONS, weaponId } from "../src/sim/weapons.ts";
import {
  NearBindgen,
  near,
  call,
  view,
  initialize,
  LookupMap,
  NearPromise,
  assert,
  encode,
  validateAccountId,
} from "near-sdk-js";
import {
  NonFungibleToken,
  TokenMetadata,
  NftMint,
} from "near-contract-standards/lib/index.js";
import { applyAction, readChampion } from "./engine.js";
import {
  economy,
  prize,
  pendingNative,
  marketAction,
  marketView,
  openRound,
  resolveNative,
  retireRaffles,
  beginTreasuryTransfer,
  resolveTreasuryTransfer,
} from "./market.js";
import { SPONSOR_YOCTO } from "../src/shared/market.ts";
declare const env: {
  ed25519_verify(
    signature: Uint8Array,
    message: Uint8Array,
    publicKey: Uint8Array,
  ): boolean;
};

const hex = (text: string): Uint8Array => {
  assert(
    typeof text === "string" &&
      /^[a-f0-9]+$/.test(text) &&
      text.length % 2 === 0,
    "Invalid signature encoding",
  );
  return Uint8Array.from(text.match(/../g)!.map((v) => parseInt(v, 16)));
};
const json = (value: unknown) =>
  JSON.stringify(value, (_key, item) =>
    typeof item === "bigint" ? item.toString() : item,
  );
const prefix = (name: string) => ({ into_storage_key: () => name });

@NearBindgen({ requireInit: true })
class Contrapasso {
  ownerId: string = "";
  refereeKey: string = "";
  tokens: NonFungibleToken = new NonFungibleToken();
  champions: LookupMap<any> = new LookupMap("c");
  duels: LookupMap<any> = new LookupMap("d");
  used: LookupMap<any> = new LookupMap("u");
  gear: LookupMap<any> = new LookupMap("g");
  pending: LookupMap<boolean> = new LookupMap("p");

  @initialize({})
  init({
    referee_public_key,
    owner_id,
  }: {
    referee_public_key: string;
    owner_id: string;
  }) {
    assert(
      near.currentAccountId().endsWith(".testnet") ||
        near.currentAccountId().endsWith(".test.near"),
      "Testnet or local test accounts only",
    );
    assert(
      validateAccountId(owner_id) && /^[a-f0-9]{64}$/.test(referee_public_key),
      "Invalid initialization",
    );
    this.ownerId = owner_id;
    this.refereeKey = referee_public_key;
    this.tokens.init(
      prefix("n"),
      owner_id,
      prefix("m"),
      prefix("e"),
      prefix("a"),
    );
  }
  private storage() {
    return {
      champions: this.champions,
      duels: this.duels,
      used: this.used,
      owner: (id: string) => this.tokens.owner_by_id.get(`champion:${id}`),
      pendingTransfer: (id: string) =>
        this.pending.get(`champion:${id}`) === true ||
        !!pendingNative(this.marketStorage(), id),
      prize: (id: string) => prize(this.marketStorage(), id),
      weapon: (c: any) => { const g = c.equipped?.weapon ? this.gear.get(c.equipped.weapon) : null; return weaponId(g?.weaponId ?? g?.collection); },
      marketAction: (c: any, ctx: any, action: any) =>
        marketAction(this.marketStorage(), ctx, c, action),
      mint: (champion: any, owner: string) => this.mint(champion, owner),
      transfer: (c: any, receiver: string) => {
        const id = `champion:${c.id}`;
        const previous = this.tokens.owner_by_id.get(id)!;
        this.tokens.internal_transfer_unguarded(id, previous, receiver);
        this.tokens.approvals_by_id?.remove(id);
        NonFungibleToken.emit_transfer(
          previous,
          receiver,
          id,
          undefined,
          "Claimed to wallet",
        );
        for (const gearId of Object.values(c.equipped) as string[]) {
          if (!gearId) continue;
          const old = this.tokens.owner_by_id.get(gearId)!;
          this.tokens.internal_transfer_unguarded(gearId, old, receiver);
          this.tokens.approvals_by_id?.remove(gearId);
          NonFungibleToken.emit_transfer(
            old,
            receiver,
            gearId,
            undefined,
            "Equipped to champion",
          );
          const gear = this.gear.get(gearId);
          gear.pastOwners = [...gear.pastOwners, previous].slice(-10);
          this.gear.set(gearId, gear);
        }
      },
      upgradeGear: (c: any, slot: string, level: number) => {
        const id = c.equipped[slot];
        const gear = this.gear.get(id);
        gear.level = level;
        this.gear.set(id, gear);
      },
      recordKills: (c: any, kills: number) => {
        for (const id of Object.values(c.equipped) as string[])
          if (id) {
            const gear = this.gear.get(id);
            gear.kills += kills;
            this.gear.set(id, gear);
          }
      },
    };
  }
  // New prefixes are independent of the serialized 0.3/0.4 root, so code upgrades need no re-init.
  private marketStorage() {
    return {
      market: new LookupMap<any>("q"),
      reservations: new LookupMap<any>("r"),
      rounds: new LookupMap<any>("R"),
      champions: this.champions,
      used: this.used,
      mintGear: (c: any, id: string, owner: string, identity = "cinder-requiem") => {
        const spec = WEAPONS[weaponId(identity)];
        const metadata = new TokenMetadata(
          spec.name + " / " + id.split(":").slice(1).join(" #"),
          spec.description + " Coin-funded upgrades and combat history stay on this NFT.",
          null,
          null,
          1n,
          String(Number(near.blockTimestamp() / 1000000n)),
          null,
          null,
          null,
          null,
          null,
          null,
        );
        this.tokens.internal_mint_with_refund(id, owner, metadata);
        this.gear.set(id, {
          kind: "weapon",
          championId: c.id,
          equippedTo: null,
          level: 0,
          bound: false,
          kills: 0,
          pastOwners: [],
          collection: identity,
          weaponId: identity,
          archetype: spec.className,
        });
        new NftMint(owner, [id]).emit();
      },
      equipGear: (c: any, data: any, owner: string, remove: boolean) =>
        this.changeEquipment(c, data, owner, remove),
    };
  }
  private changeEquipment(c: any, data: any, owner: string, remove: boolean) {
    assert(
      data.slot === "weapon" || data.slot === "armor",
      "Invalid gear slot",
    );
    const gear = remove ? null : this.gear.get(data.gearId);
    if (!remove)
      assert(
        gear &&
          gear.kind === data.slot &&
          this.tokens.owner_by_id.get(data.gearId) === owner &&
          !this.pending.get(data.gearId) &&
          (!gear.bound || gear.championId === c.id) &&
          (!gear.equippedTo || gear.equippedTo === c.id),
        "Gear unavailable or already equipped",
      );
    const previous = c.equipped[data.slot];
    if (previous) {
      const old = this.gear.get(previous);
      old.equippedTo = null;
      this.gear.set(previous, old);
    }
    c.equipped[data.slot] = remove ? null : data.gearId;
    c.build[data.slot === "weapon" ? "weaponLevel" : "armorLevel"] = remove
      ? 0
      : gear.level;
    if (data.slot === "weapon") c.build.weaponId = remove ? "starter" : weaponId(gear.weaponId ?? gear.collection);
    c.defending = false;
    if (gear) {
      gear.equippedTo = c.id;
      this.gear.set(data.gearId, gear);
    }
  }
  private mint(c: any, owner: string) {
    const ids = [`champion:${c.id}`, c.equipped.weapon, c.equipped.armor];
    for (const [i, id] of ids.entries()) {
      const title =
        i === 0
          ? `The Unforgiven / ${c.id.slice(0, 8)}`
          : i === 1
            ? "Cinder / Starter Blade"
            : "Ash / Starter Armor";
      const metadata = new TokenMetadata(
        title,
        "Contrapasso testnet / dynamic game asset",
        null,
        null,
        1n,
        String(Number(near.blockTimestamp() / 1000000n)),
        null,
        null,
        null,
        null,
        null,
        null,
      );
      this.tokens.internal_mint_with_refund(id, owner, metadata);
      if (i)
        this.gear.set(id, {
          kind: i === 1 ? "weapon" : "armor",
          championId: c.id,
          equippedTo: c.id,
          level: 0,
          bound: true,
          kills: 0,
          pastOwners: [],
        });
    }
    new NftMint(owner, ids).emit();
  }
  @call({ payableFunction: true })
  apply_receipt({
    payload,
    signature,
  }: {
    payload: string;
    signature: string;
  }) {
    assert(
      typeof payload === "string" &&
        payload.length < 16000 &&
        typeof signature === "string" &&
        signature.length === 128,
      "Invalid receipt",
    );
    assert(
      env.ed25519_verify(hex(signature), encode(payload), hex(this.refereeKey)),
      "Invalid referee signature",
    );
    const action = JSON.parse(payload);
    if (action.operation === "fund_guest" && !this.used.get(action.id)) {
      const liability = BigInt(economy(this.marketStorage()).liabilityYocto);
      assert(
        near.accountBalance() -
          near.storageUsage() * near.storageByteCost() -
          liability >=
          BigInt(SPONSOR_YOCTO) + 500000000000000000000000n,
        "Demo fund reserve is exhausted",
      );
    }
    const result = applyAction(
      this.storage(),
      {
        contractId: near.currentAccountId(),
        nowMs: Number(near.blockTimestamp() / 1000000n),
        validAccount: validateAccountId,
        predecessor: near.predecessorAccountId(),
        depositYocto: near.attachedDeposit().toString(),
        entropy: Array.from(near.randomSeed()),
        blockHeight: Number(near.blockHeight()),
      },
      action,
    );
    near.log(
      `EVENT_JSON:${json({ standard: "contrapasso", version: "1.0.0", event: "receipt_applied", data: [result] })}`,
    );
    if (
      !result.duplicate &&
      (action.operation === "fund_guest" ||
        action.operation === "withdraw_prize")
    ) {
      const pending = pendingNative(this.marketStorage(), action.championId);
      NearPromise.new(pending.receiver)
        .transfer(BigInt(pending.amountYocto))
        .then(
          NearPromise.new(near.currentAccountId()).functionCall(
            "resolve_native",
            json({ champion_id: action.championId }),
            0n,
            50000000000000n,
          ),
        )
        .build();
    }
    return result;
  }
  @call({ payableFunction: true })
  withdraw_prize({ champion_id }: { champion_id: string }) {
    assert(near.attachedDeposit() === 1n, "Attach exactly one yoctoNEAR");
    this.guardTransfer(`champion:${champion_id}`);
    const owner = near.predecessorAccountId();
    assert(
      this.tokens.owner_by_id.get(`champion:${champion_id}`) === owner,
      "Owner only",
    );
    const c = this.champions.get(champion_id),
      store = this.marketStorage();
    const id = `wallet-withdraw:${champion_id}:${c.revision}`;
    marketAction(store, {}, c, {
      id,
      operation: "withdraw_prize",
      ownerId: owner,
      data: {},
    });
    c.revision++;
    this.champions.set(c.id, c);
    const result = {
      id,
      championId: c.id,
      revision: c.revision,
      operation: "withdraw_prize",
    };
    this.used.set(id, result);
    const pending = pendingNative(store, c.id);
    NearPromise.new(pending.receiver)
      .transfer(BigInt(pending.amountYocto))
      .then(
        NearPromise.new(near.currentAccountId()).functionCall(
          "resolve_native",
          json({ champion_id: c.id }),
          0n,
          50000000000000n,
        ),
      )
      .build();
    return result;
  }
  @call({ privateFunction: true })
  resolve_native({ champion_id }: { champion_id: string }) {
    assert(near.promiseResultsCount() === 1n, "Expected one transfer result");
    let success = true;
    try {
      near.promiseResult(0);
    } catch {
      success = false;
    }
    return resolveNative(this.marketStorage(), champion_id, success);
  }
  @call({})
  open_round({
    id,
    duration_seconds = 120,
  }: {
    id: string;
    duration_seconds?: number;
  }) {
    assert(near.predecessorAccountId() === this.ownerId, "Owner only");
    return openRound(
      this.marketStorage(),
      { nowMs: Number(near.blockTimestamp() / 1000000n) },
      { id, durationSeconds: duration_seconds },
    );
  }
  @call({})
  retire_raffles() {
    assert(near.predecessorAccountId() === this.ownerId, "Owner only");
    return retireRaffles(this.marketStorage());
  }
  @call({ payableFunction: true })
  withdraw_treasury({ receiver_id, amount }: { receiver_id: string; amount: string }) {
    assert(near.predecessorAccountId() === this.ownerId, "Owner only");
    assert(near.attachedDeposit() === 1n && validateAccountId(receiver_id), "One yoctoNEAR and a valid receiver required");
    beginTreasuryTransfer(this.marketStorage(), receiver_id, amount);
    NearPromise.new(receiver_id).transfer(BigInt(amount)).then(
      NearPromise.new(near.currentAccountId()).functionCall("resolve_treasury", "{}", 0n, 50000000000000n)
    ).build();
  }
  @call({ privateFunction: true })
  resolve_treasury() {
    assert(near.promiseResultsCount() === 1n, "Expected one transfer result");
    let success = true;
    try { near.promiseResult(0); } catch { success = false; }
    return resolveTreasuryTransfer(this.marketStorage(), success);
  }
  @view({})
  market_view({ champion_id }: { champion_id: string }) {
    return marketView(this.marketStorage(), champion_id);
  }
  @view({})
  get_champion({ champion_id }: { champion_id: string }) {
    return readChampion(
      this.storage(),
      champion_id,
      Number(near.blockTimestamp() / 1000000n),
    );
  }
  @view({})
  get_duel({ duel_id }: { duel_id: string }) {
    return this.duels.get(duel_id);
  }
  @view({})
  receipt_applied({ receipt_id }: { receipt_id: string }) {
    return this.used.get(receipt_id);
  }
  @view({})
  game_config() {
    return {
      network: "testnet",
      version: "0.6.0",
      features: ["upgrade", "claim", "market", "royalties", "arsenal", "skill_tree", "treasury"],
      referee_public_key: this.refereeKey,
      coin_daily_cap: 300,
      duel_stake: 10,
    };
  }
  @call({})
  set_referee_key({ public_key }: { public_key: string }) {
    assert(
      near.predecessorAccountId() === this.ownerId &&
        /^[a-f0-9]{64}$/.test(public_key),
      "Unauthorized",
    );
    this.refereeKey = public_key;
  }
  private token(id: string) {
    const token = this.tokens.nft_token({ token_id: id });
    if (!token) return null;
    if (token.metadata) {
      const info = id.startsWith("champion:")
        ? readChampion(
            this.storage(),
            id.slice(9),
            Number(near.blockTimestamp() / 1000000n),
          )
        : this.gear.get(id);
      const blade = info?.kind === "weapon" ? WEAPONS[weaponId(info.weaponId ?? info.collection)] : null;
      token.metadata.extra = json({
        kind: id.startsWith("champion:") ? "champion" : "gear",
        ...info,
        ...(blade ? { archetype: blade.className, damage: blade.damage + info.level * 2, reach: blade.reach, attackCooldown: blade.cooldown } : {}),
      });
    }
    return token;
  }
  private guardTransfer(id: string) {
    assert(!this.pending.get(id), "NFT transfer is pending");
    if (id.startsWith("champion:")) {
      const c = this.champions.get(id.slice(9));
      assert(c && !c.lockedBy, "Champion is in a duel");
      assert(
        !pendingNative(this.marketStorage(), c.id),
        "A native payout is pending",
      );
    } else {
      const g = this.gear.get(id);
      assert(g && !g.bound, "Starter gear travels with its champion");
      assert(!g.equippedTo, "Unequip gear before transferring it");
    }
  }
  private syncEquipment(id: string, history?: string) {
    if (!id.startsWith("champion:")) {
      if (history) {
        const g = this.gear.get(id);
        g.pastOwners = [...g.pastOwners, history].slice(-10);
        this.gear.set(id, g);
      }
      return;
    }
    const c = this.champions.get(id.slice(9));
    const owner = this.tokens.owner_by_id.get(id)!;
    for (const gearId of Object.values(c.equipped) as string[]) {
      if (!gearId) continue;
      const old = this.tokens.owner_by_id.get(gearId)!;
      if (old !== owner) {
        this.tokens.internal_transfer_unguarded(gearId, old, owner);
        this.tokens.approvals_by_id?.remove(gearId);
        NonFungibleToken.emit_transfer(
          old,
          owner,
          gearId,
          undefined,
          "Equipped to champion",
        );
      }
      if (history && history !== owner) {
        const gear = this.gear.get(gearId);
        gear.pastOwners = [...gear.pastOwners, history].slice(-10);
        this.gear.set(gearId, gear);
      }
    }
    c.defending = false;
    c.revision++;
    this.champions.set(c.id, c);
  }
  @call({ payableFunction: true })
  nft_transfer(args: {
    receiver_id: string;
    token_id: string;
    approval_id?: bigint;
    memo?: string;
  }) {
    assert(
      near.attachedDeposit() === 1n && validateAccountId(args.receiver_id),
      "Attach exactly one yoctoNEAR",
    );
    this.guardTransfer(args.token_id);
    const previous = this.tokens.owner_by_id.get(args.token_id)!;
    this.tokens.nft_transfer(args);
    this.syncEquipment(args.token_id, previous);
  }
  @call({ payableFunction: true })
  nft_transfer_call(args: {
    receiver_id: string;
    token_id: string;
    approval_id?: bigint;
    memo?: string;
    msg: string;
  }) {
    assert(
      near.attachedDeposit() === 1n &&
        validateAccountId(args.receiver_id) &&
        near.prepaidGas() >= 200000000000000n,
      "Transfer call requires one yocto and 200 Tgas",
    );
    this.guardTransfer(args.token_id);
    const sender = near.predecessorAccountId();
    const [previous, approvals] = this.tokens.internal_transfer(
      sender,
      args.receiver_id,
      args.token_id,
      args.approval_id,
      args.memo,
    );
    this.pending.set(args.token_id, true);
    this.syncEquipment(args.token_id);
    return NearPromise.new(args.receiver_id)
      .functionCall(
        "nft_on_transfer",
        json({
          sender_id: sender,
          previous_owner_id: previous,
          token_id: args.token_id,
          msg: args.msg,
        }),
        0n,
        near.prepaidGas() - 180000000000000n,
      )
      .then(
        NearPromise.new(near.currentAccountId()).functionCall(
          "nft_resolve_transfer",
          json({
            previous_owner_id: previous,
            receiver_id: args.receiver_id,
            token_id: args.token_id,
            approved_account_ids: approvals,
          }),
          0n,
          80000000000000n,
        ),
      );
  }
  @call({ privateFunction: true })
  nft_resolve_transfer(args: {
    previous_owner_id: string;
    receiver_id: string;
    token_id: string;
    approved_account_ids?: Record<string, bigint>;
  }) {
    assert(this.pending.get(args.token_id), "No pending transfer");
    const kept = this.tokens.nft_resolve_transfer(args);
    this.pending.remove(args.token_id);
    this.syncEquipment(
      args.token_id,
      kept ? args.previous_owner_id : undefined,
    );
    return kept;
  }
  @call({ payableFunction: true })
  unequip({ champion_id, slot }: { champion_id: string; slot: string }) {
    assert(
      near.attachedDeposit() === 1n && (slot === "weapon" || slot === "armor"),
      "Invalid slot or deposit",
    );
    const id = `champion:${champion_id}`;
    this.guardTransfer(id);
    assert(
      this.tokens.owner_by_id.get(id) === near.predecessorAccountId(),
      "Owner only",
    );
    const c = this.champions.get(champion_id);
    this.changeEquipment(c, { slot }, near.predecessorAccountId(), true);
    c.revision++;
    this.champions.set(c.id, c);
  }
  @call({ payableFunction: true })
  equip({
    champion_id,
    gear_id,
    slot,
  }: {
    champion_id: string;
    gear_id: string;
    slot: string;
  }) {
    assert(
      near.attachedDeposit() === 1n && (slot === "weapon" || slot === "armor"),
      "Invalid slot or deposit",
    );
    const id = `champion:${champion_id}`;
    this.guardTransfer(id);
    const owner = near.predecessorAccountId();
    assert(this.tokens.owner_by_id.get(id) === owner, "Owner only");
    const c = this.champions.get(champion_id);
    this.changeEquipment(c, { slot, gearId: gear_id }, owner, false);
    c.revision++;
    this.champions.set(c.id, c);
  }
  @view({})
  nft_payout({
    token_id,
    balance,
    max_len_payout,
  }: {
    token_id: string;
    balance: string;
    max_len_payout: number;
  }) {
    const owner = this.tokens.owner_by_id.get(token_id);
    assert(
      owner && typeof balance === "string" && /^[0-9]{1,39}$/.test(balance),
      "Invalid payout",
    );
    const total = BigInt(balance);
    assert(total < 1n << 128n, "Balance exceeds u128");
    const royalty = total / 10n,
      payout: Record<string, string> = {};
    payout[owner] = (total - royalty).toString();
    payout[near.currentAccountId()] = (
      BigInt(payout[near.currentAccountId()] ?? "0") + royalty
    ).toString();
    assert(
      Number.isSafeInteger(max_len_payout) &&
        Object.keys(payout).length <= max_len_payout,
      "Payout recipient limit",
    );
    return { payout };
  }
  @call({ payableFunction: true })
  nft_transfer_payout(args: {
    receiver_id: string;
    token_id: string;
    approval_id?: bigint;
    memo?: string;
    balance: string;
    max_len_payout: number;
  }) {
    const result = this.nft_payout(args);
    this.nft_transfer(args);
    return result;
  }
  // A marketplace must actually pay this method to credit royalties to the recorded pool.
  @call({ payableFunction: true })
  collect_royalty() {
    const amount = near.attachedDeposit();
    assert(amount > 0n, "Attach the royalty payment");
    const store = this.marketStorage(),
      config = economy(store);
    const round = config.currentRound
      ? store.rounds.get(config.currentRound)
      : null;
    if (config.mode === "treasury") config.treasuryYocto = (BigInt(config.treasuryYocto ?? "0") + amount).toString();
    else if (
      round &&
      !round.drawn &&
      Number(near.blockTimestamp() / 1000000n) < round.endsAt
    ) {
      round.poolYocto = (BigInt(round.poolYocto) + amount).toString();
      store.rounds.set(round.id, round);
    } else config.carryYocto = (BigInt(config.carryYocto) + amount).toString();
    config.liabilityYocto = (BigInt(config.liabilityYocto) + amount).toString();
    store.market.set("config", config);
  }
  @view({}) nft_token({ token_id }: { token_id: string }) {
    return this.token(token_id);
  }
  @view({}) nft_metadata() {
    return {
      spec: "nft-1.0.0",
      name: "Contrapasso / Champions and Gear",
      symbol: "CPASS",
    };
  }
  @view({}) nft_total_supply() {
    return String(this.tokens.nft_total_supply());
  }
  @view({}) nft_supply_for_owner(args: { account_id: string }) {
    return String(this.tokens.nft_supply_for_owner(args));
  }
  @view({}) nft_tokens({
    from_index = "0",
    limit = 50,
  }: {
    from_index?: string;
    limit?: number;
  }) {
    assert(
      Number.isSafeInteger(Number(from_index)) &&
        Number(from_index) >= 0 &&
        Number.isSafeInteger(limit) &&
        limit > 0 &&
        limit <= 100,
      "Invalid page",
    );
    return this.tokens
      .nft_tokens({ from_index: Number(from_index), limit })
      .map((t) => this.token(t.token_id));
  }
  @view({}) nft_tokens_for_owner({
    account_id,
    from_index = "0",
    limit = 50,
  }: {
    account_id: string;
    from_index?: string;
    limit?: number;
  }) {
    assert(
      Number.isSafeInteger(Number(from_index)) &&
        Number(from_index) >= 0 &&
        Number.isSafeInteger(limit) &&
        limit > 0 &&
        limit <= 100,
      "Invalid page",
    );
    if (!this.tokens.nft_supply_for_owner({ account_id })) return [];
    return this.tokens
      .nft_tokens_for_owner({
        account_id,
        from_index: Number(from_index),
        limit,
      })
      .map((t) => this.token(t.token_id));
  }
  @call({ payableFunction: true }) nft_approve(args: {
    token_id: string;
    account_id: string;
    msg: string;
  }) {
    this.guardTransfer(args.token_id);
    return this.tokens.nft_approve(args);
  }
  @call({ payableFunction: true }) nft_revoke(args: {
    token_id: string;
    account_id: string;
  }) {
    return this.tokens.nft_revoke(args);
  }
  @call({ payableFunction: true }) nft_revoke_all(args: { token_id: string }) {
    return this.tokens.nft_revoke_all(args);
  }
  @view({}) nft_is_approved(args: {
    token_id: string;
    approved_account_id: string;
    approval_id?: bigint;
  }) {
    return this.tokens.nft_is_approved(args);
  }
}
