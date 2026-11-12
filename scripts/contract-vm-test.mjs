import assert from "node:assert/strict";
import { resolve } from "node:path";
import { generateKeyPairSync, createPublicKey, sign } from "node:crypto";
process.env.NEAR_WORKSPACES_NO_LOGS = "1";
process.env.NEAR_SANDBOX_BIN_PATH = resolve(".data/tools/near-sandbox");
process.env.NEAR_SANDBOX_BINARY_PATH = resolve(".data/tools");
const { Worker } = await import("near-workspaces");
const worker = await Worker.init();
const GAS = 300000000000000n;
try {
  const root = worker.rootAccount;
  const game = await root.createSubAccount("game");
  const upgradeIndex = process.argv.indexOf("--upgrade-from");
  await game.deploy(
    upgradeIndex < 0
      ? "build/contrapasso.wasm"
      : process.argv[upgradeIndex + 1],
  );
  const alice = await root.createSubAccount("alice"),
    bob = await root.createSubAccount("bob"),
    charlie = await root.createSubAccount("charlie"),
    receiver = await root.createSubAccount("receiver");
  await receiver.deploy("build/test-receiver.wasm");
  const { privateKey } = generateKeyPairSync("ed25519");
  const publicKey = Buffer.from(
    createPublicKey(privateKey).export({ format: "jwk" }).x,
    "base64url",
  ).toString("hex");
  await root.call(
    game,
    "init",
    { referee_public_key: publicKey, owner_id: root.accountId },
    { gas: GAS },
  );
  let seq = 0;
  const apply = async (
    championId,
    owner,
    operation,
    data,
    extra = {},
    send = {},
  ) => {
    const current = await game.view("get_champion", {
      champion_id: championId,
    });
    const block = await worker.provider.block({ finality: "final" });
    const now = Number(
      BigInt(block.header.timestamp_nanosec ?? block.header.timestamp) /
        1000000n,
    );
    const a = {
      domain: "contrapasso:testnet:v1",
      contractId: game.accountId,
      id: `vm-action-${++seq}`,
      championId,
      ownerId: owner.accountId,
      revision: current?.revision ?? 0,
      expiresAt: now + 3600000,
      operation,
      data,
      ...extra,
    };
    const payload = JSON.stringify(a),
      signature = sign(null, Buffer.from(payload), privateKey).toString("hex");
    return (send.sender ?? root).call(
      game,
      "apply_receipt",
      { payload, signature },
      { gas: GAS, attachedDeposit: send.deposit ?? 0n },
    );
  };
  const checkpoint = {
    coins: 100,
    skills: [],
    runs: 1,
    victories: 0,
    earnedToday: 100,
    day: Math.floor(Date.now() / 86400000),
  };
  await apply("alice", alice, "register", checkpoint);
  await apply("bob", bob, "register", checkpoint);
  if (upgradeIndex >= 0) {
    await root.call(
      game,
      "open_round",
      { id: "before-upgrade", duration_seconds: 30 },
      { gas: GAS },
    );
    await worker.provider.fastForward(40);
    const before = await game.view("get_champion", { champion_id: "alice" });
    await game.deploy("build/contrapasso.wasm");
    assert.deepEqual(
      await game.view("get_champion", { champion_id: "alice" }),
      {
        ...before,
        build: { ...before.build, weaponId: "starter" },
        prizeYocto: before.prizeYocto ?? "0",
      },
      "upgrading code must preserve the existing vault and build",
    );
    assert.ok((await game.view("game_config", {})).features.includes("claim"));
    await assert.rejects(
      root.call(
        game,
        "init",
        { referee_public_key: publicKey, owner_id: root.accountId },
        { gas: GAS },
      ),
    );
  }
  for (const slot of ["weapon", "armor"])
    await apply("bob", bob, "upgrade", {
      slot,
      fromLevel: 0,
      gearId: `${slot}:bob`,
      roll: 99,
    });
  assert.equal(
    JSON.parse(
      (await game.view("nft_token", { token_id: "weapon:bob" })).metadata.extra,
    ).level,
    1,
  );
  await assert.rejects(
    apply("bob", bob, "upgrade", {
      slot: "weapon",
      fromLevel: 0,
      gearId: "weapon:bob",
      roll: 0,
    }),
  );
  assert.equal(await game.view("nft_total_supply", {}), "6");
  const token = await game.view("nft_token", { token_id: "champion:alice" });
  assert.equal(token.owner_id, alice.accountId);
  assert.equal(JSON.parse(token.metadata.extra).coins, 100);
  await assert.rejects(
    root.call(
      game,
      "apply_receipt",
      { payload: "{}", signature: "00".repeat(64) },
      { gas: GAS },
    ),
  );
  await apply("alice", alice, "train", { skill: "haste" });
  await apply("bob", bob, "defense", { enabled: true });
  const target = await game.view("get_champion", { champion_id: "bob" });
  await apply("alice", alice, "duel_open", {
    duelId: "vm-duel-1",
    opponentId: "bob",
    opponentRevision: target.revision,
    expiresAt: Date.now() + 120000,
  });
  await assert.rejects(
    alice.call(
      game,
      "nft_transfer",
      { receiver_id: charlie.accountId, token_id: "champion:alice" },
      { gas: GAS, attachedDeposit: 1n },
    ),
  );
  await apply("alice", alice, "duel_settle", {
    duelId: "vm-duel-1",
    won: true,
  });
  const a = await game.view("get_champion", { champion_id: "alice" }),
    b = await game.view("get_champion", { champion_id: "bob" });
  assert.equal(a.coins + b.coins, 110);
  assert.equal(a.duelWins, 1);
  await alice.call(
    game,
    "nft_transfer",
    { receiver_id: bob.accountId, token_id: "champion:alice" },
    { gas: GAS, attachedDeposit: 1n },
  );
  for (const id of ["champion:alice", "weapon:alice", "armor:alice"])
    assert.equal(
      (await game.view("nft_token", { token_id: id })).owner_id,
      bob.accountId,
    );
  assert.equal(
    (await game.view("get_champion", { champion_id: "alice" })).coins,
    50,
  );
  await assert.rejects(apply("alice", alice, "train", { skill: "ember" }));
  await apply("alice", bob, "train", { skill: "ember" });
  await bob.call(
    game,
    "nft_approve",
    { token_id: "champion:alice", account_id: root.accountId, msg: "" },
    { gas: GAS, attachedDeposit: 10000000000000000000000n },
  );
  await root.call(
    game,
    "nft_transfer",
    { receiver_id: charlie.accountId, token_id: "champion:alice" },
    { gas: GAS, attachedDeposit: 1n },
  );
  const kept = await charlie.call(
    game,
    "nft_transfer_call",
    {
      receiver_id: receiver.accountId,
      token_id: "champion:alice",
      msg: "return",
    },
    { gas: GAS, attachedDeposit: 1n },
  );
  assert.equal(kept, false);
  for (const id of ["champion:alice", "weapon:alice", "armor:alice"])
    assert.equal(
      (await game.view("nft_token", { token_id: id })).owner_id,
      charlie.accountId,
    );
  const accepted = await charlie.call(
    game,
    "nft_transfer_call",
    {
      receiver_id: receiver.accountId,
      token_id: "champion:alice",
      msg: "keep",
    },
    { gas: GAS, attachedDeposit: 1n },
  );
  assert.equal(accepted, true);
  for (const id of ["champion:alice", "weapon:alice", "armor:alice"])
    assert.equal(
      (await game.view("nft_token", { token_id: id })).owner_id,
      receiver.accountId,
    );
  assert.equal(
    await game.view("nft_supply_for_owner", { account_id: receiver.accountId }),
    "3",
  );
  const claimVault = (await game.view("get_champion", { champion_id: "alice" }))
    .coins;
  await apply("alice", receiver, "claim", { receiver: charlie.accountId });
  for (const id of ["champion:alice", "weapon:alice", "armor:alice"])
    assert.equal(
      (await game.view("nft_token", { token_id: id })).owner_id,
      charlie.accountId,
    );
  assert.equal(
    (await game.view("get_champion", { champion_id: "alice" })).coins,
    claimVault,
  );
  await assert.rejects(apply("alice", receiver, "train", { skill: "ember" }));
  await apply("alice", charlie, "solo", {
    earnedCoins: 30,
    floor: 1,
    kills: 1,
    won: false,
    powers: { ash: 1, reach: 1 },
  });
  if (upgradeIndex >= 0)
    await apply("alice", charlie, "draw_round", { roundId: "before-upgrade" });
  if (
    (await game.view("market_view", { champion_id: "alice" })).revenueMode ===
    "raffle"
  ) {
    // Full native testnet economy in the actual WASM, including asynchronous callbacks.
    const price = 10000000000000000000000n;
    await root.call(
      game,
      "open_round",
      { id: "vm-market", duration_seconds: 120 },
      { gas: GAS },
    );
    await apply("bob", bob, "reserve_mint", { roundId: "vm-market" });
    await apply("alice", charlie, "reserve_mint", { roundId: "vm-market" });
    await assert.rejects(apply("bob", bob, "mint", { roundId: "vm-market" }));
    const paidId = "vm-paid-idempotency";
    await apply(
      "bob",
      bob,
      "mint",
      { roundId: "vm-market" },
      { id: paidId },
      { sender: bob, deposit: price },
    );
    await assert.rejects(
      apply(
        "bob",
        bob,
        "mint",
        { roundId: "vm-market" },
        { id: paidId },
        { sender: bob, deposit: price },
      ),
    );
    const relic = "relic:vm-market:1";
    assert.equal(
      (await game.view("market_view", { champion_id: "bob" })).round.poolYocto,
      String(price),
    );
    await apply("bob", bob, "equip_gear", { slot: "weapon", gearId: relic });
    await assert.rejects(
      bob.call(
        game,
        "nft_transfer",
        { receiver_id: alice.accountId, token_id: relic },
        { gas: GAS, attachedDeposit: 1n },
      ),
    );
    await apply("bob", bob, "tickets", { roundId: "vm-market", count: 1 });
    await worker.provider.fastForward(150);
    const beforeRefund = (
      await game.view("get_champion", { champion_id: "alice" })
    ).coins;
    await apply("alice", charlie, "draw_round", { roundId: "vm-market" });
    assert.equal(
      (await game.view("get_champion", { champion_id: "alice" })).coins,
      beforeRefund + 10,
    );
    let market = await game.view("market_view", { champion_id: "bob" });
    assert.equal(market.prizeYocto, String(price));
    assert.equal(market.round.winners.length, 1);
    await bob.call(
      game,
      "nft_transfer",
      { receiver_id: charlie.accountId, token_id: "champion:bob" },
      { gas: GAS, attachedDeposit: 1n },
    );
    assert.equal(
      (await game.view("nft_token", { token_id: relic })).owner_id,
      charlie.accountId,
    );
    assert.equal(
      (await game.view("get_champion", { champion_id: "bob" })).prizeYocto,
      String(price),
    );
    const missing = { accountId: "missing." + root.accountId };
    await apply("bob", charlie, "claim", { receiver: missing.accountId });
    const failedPayoutId = "vm-failed-prize-payout";
    await apply("bob", missing, "withdraw_prize", {}, { id: failedPayoutId });
    market = await game.view("market_view", { champion_id: "bob" });
    assert.equal(market.pendingNative, false);
    assert.equal(
      market.prizeYocto,
      String(price),
      "failed callback restores the native prize",
    );
    assert.equal(
      (await game.view("receipt_applied", { receipt_id: failedPayoutId }))
        .nativeSuccess,
      false,
    );
    await apply("bob", missing, "claim", { receiver: charlie.accountId });
    await assert.rejects(
      alice.call(
        game,
        "withdraw_prize",
        { champion_id: "bob" },
        { gas: GAS, attachedDeposit: 1n },
      ),
    );
    await charlie.call(
      game,
      "withdraw_prize",
      { champion_id: "bob" },
      { gas: GAS, attachedDeposit: 1n },
    );
    assert.equal(
      (await game.view("market_view", { champion_id: "bob" })).prizeYocto,
      "0",
    );
    await apply("bob", charlie, "unequip_gear", { slot: "weapon" });
    const quote = await game.view("nft_payout", {
      token_id: relic,
      balance: "101",
      max_len_payout: 2,
    });
    assert.equal(quote.payout[game.accountId], "10");
    assert.equal(quote.payout[charlie.accountId], "91");
    await assert.rejects(
      game.view("nft_payout", {
        token_id: relic,
        balance: "101",
        max_len_payout: 1,
      }),
    );
    await charlie.call(
      game,
      "nft_transfer_payout",
      {
        token_id: relic,
        receiver_id: alice.accountId,
        balance: "101",
        max_len_payout: 2,
      },
      { gas: GAS, attachedDeposit: 1n },
    );
    assert.equal(
      (await game.view("nft_token", { token_id: relic })).owner_id,
      alice.accountId,
    );
    await root.call(
      game,
      "collect_royalty",
      {},
      { gas: GAS, attachedDeposit: 11n },
    );
    await root.call(
      game,
      "open_round",
      { id: "royalty-carry", duration_seconds: 120 },
      { gas: GAS },
    );
    assert.equal(
      (await game.view("market_view", { champion_id: "bob" })).round.poolYocto,
      "11",
    );
  }

  // Retire legacy rounds, then exercise the new owner-controlled treasury and arsenal.
  await assert.rejects(alice.call(game, "retire_raffles", {}, { gas: GAS }));
  await root.call(game, "retire_raffles", {}, { gas: GAS });
  await root.call(
    game,
    "open_round",
    { id: "arsenal", duration_seconds: 120 },
    { gas: GAS },
  );
  await apply("smith", alice, "register", { ...checkpoint, coins: 2000 });
  await assert.rejects(apply("smith", alice, "train", { skill: "pyre" }));
  for (const skill of ["ember", "reach", "verdict", "pyre"])
    await apply("smith", alice, "train", { skill });
  await assert.rejects(
    apply("smith", alice, "tickets", { roundId: "arsenal", count: 1 }),
  );
  await apply("smith", alice, "reserve_mint", {
    roundId: "arsenal",
    weaponId: "tollkeeper",
  });
  await apply(
    "smith",
    alice,
    "mint",
    { roundId: "arsenal" },
    {},
    { sender: alice, deposit: 10000000000000000000000n },
  );
  const hammer = "relic:arsenal:1";
  assert.equal(
    JSON.parse(
      (await game.view("nft_token", { token_id: hammer })).metadata.extra,
    ).weaponId,
    "tollkeeper",
  );
  await apply("smith", alice, "equip_gear", { slot: "weapon", gearId: hammer });
  await apply("smith", alice, "upgrade", {
    slot: "weapon",
    gearId: hammer,
    fromLevel: 0,
    roll: 0,
  });
  assert.equal(
    (await game.view("get_champion", { champion_id: "smith" })).build.weaponId,
    "tollkeeper",
  );
  assert.equal(
    JSON.parse(
      (await game.view("nft_token", { token_id: hammer })).metadata.extra,
    ).level,
    1,
  );
  await apply("smith", alice, "claim", { receiver: bob.accountId });
  assert.equal(
    (await game.view("nft_token", { token_id: hammer })).owner_id,
    bob.accountId,
  );
  assert.deepEqual(
    (await game.view("get_champion", { champion_id: "smith" })).skills,
    ["ember", "reach", "verdict", "pyre"],
  );
  // An upgraded, battle-used NFT must retain identity and history through a paid sale.
  await apply("smith", bob, "solo", {
    earnedCoins: 0,
    floor: 1,
    kills: 7,
    won: false,
    powers: {},
  });
  const offer = { tokenId: hammer, priceYocto: "15000000000000000000000" };
  await assert.rejects(apply("smith", bob, "list_gear", offer));
  await apply("smith", bob, "unequip_gear", { slot: "weapon" });
  await apply("smith", bob, "list_gear", offer);
  let listing = (await game.view("exchange_view", {})).listings[0];
  const stale = { ...offer, listingId: listing.id };
  await assert.rejects(
    bob.call(
      game,
      "nft_transfer",
      { token_id: hammer, receiver_id: alice.accountId },
      { gas: GAS, attachedDeposit: 1n },
    ),
  );
  await assert.rejects(
    bob.call(
      game,
      "nft_approve",
      { token_id: hammer, account_id: alice.accountId },
      { gas: GAS, attachedDeposit: 10000000000000000000000n },
    ),
  );
  await assert.rejects(
    apply("smith", bob, "equip_gear", { slot: "weapon", gearId: hammer }),
  );
  await apply("smith", bob, "cancel_sale", stale);
  await apply("smith", bob, "list_gear", offer);
  listing = (await game.view("exchange_view", {})).listings[0];
  await apply("buyer", alice, "register", checkpoint);
  await assert.rejects(
    apply(
      "buyer",
      alice,
      "buy_gear",
      stale,
      {},
      { sender: alice, deposit: BigInt(offer.priceYocto) },
    ),
  );
  const quote = { ...offer, listingId: listing.id };
  await assert.rejects(apply("buyer", alice, "buy_gear", quote));
  const beforeSale = JSON.parse(
    (await game.view("nft_token", { token_id: hammer })).metadata.extra,
  );
  const paidSale = "vm-paid-sale";
  await apply(
    "buyer",
    alice,
    "buy_gear",
    quote,
    { id: paidSale },
    { sender: alice, deposit: BigInt(offer.priceYocto) },
  );
  await assert.rejects(
    apply(
      "buyer",
      alice,
      "buy_gear",
      quote,
      { id: paidSale },
      { sender: alice, deposit: BigInt(offer.priceYocto) },
    ),
  );
  const bought = await game.view("nft_token", { token_id: hammer });
  const traits = JSON.parse(bought.metadata.extra);
  assert.equal(bought.owner_id, alice.accountId);
  for (const key of ["weaponId", "level", "kills", "damage", "reach"])
    assert.equal(traits[key], beforeSale[key]);
  assert.deepEqual(
    traits.pastOwners,
    [...beforeSale.pastOwners, bob.accountId].slice(-10),
  );
  assert.equal(traits.listing, null);
  assert.equal(
    (await game.view("exchange_view", { owner_id: bob.accountId }))
      .proceedsYocto,
    "13500000000000000000000",
  );
  await bob.call(
    game,
    "withdraw_sale_proceeds",
    {},
    { gas: GAS, attachedDeposit: 1n },
  );
  assert.equal(
    (await game.view("exchange_view", { owner_id: bob.accountId }))
      .proceedsYocto,
    "0",
  );
  await assert.rejects(
    bob.call(
      game,
      "withdraw_sale_proceeds",
      {},
      { gas: GAS, attachedDeposit: 1n },
    ),
  );
  await assert.rejects(alice.call(game, "close_edition", {}, { gas: GAS }));
  await root.call(game, "close_edition", {}, { gas: GAS });
  await root.call(
    game,
    "open_round",
    { id: "ranged", duration_seconds: 120 },
    { gas: GAS },
  );
  for (const [championId, identity] of [
    ["smith", "gravewhisper"],
    ["buyer", "vesper-reed"],
  ]) {
    const who = championId === "smith" ? bob : alice;
    await apply(championId, who, "reserve_mint", {
      roundId: "ranged",
      weaponId: identity,
    });
    await apply(
      championId,
      who,
      "mint",
      { roundId: "ranged" },
      {},
      { sender: who, deposit: 10000000000000000000000n },
    );
    const tokenId = `relic:ranged:${championId === "smith" ? 1 : 2}`;
    await apply(championId, who, "equip_gear", {
      slot: "weapon",
      gearId: tokenId,
    });
    assert.equal(
      (await game.view("get_champion", { champion_id: championId })).build
        .weaponId,
      identity,
    );
  }
  // Repeat mint on the same champion: distinct NFTs and a new paid entry each time.
  for (const [index, identity] of [
    "guillotine-hymn",
    "acheron-needle",
  ].entries()) {
    const before = await game.view("get_champion", { champion_id: "smith" });
    await apply("smith", bob, "reserve_mint", {
      roundId: "ranged",
      weaponId: identity,
    });
    await apply(
      "smith",
      bob,
      "mint",
      { roundId: "ranged" },
      {},
      { sender: bob, deposit: 10000000000000000000000n },
    );
    const tokenId = `relic:ranged:${3 + index}`;
    const token = await game.view("nft_token", { token_id: tokenId });
    assert.equal(JSON.parse(token.metadata.extra).weaponId, identity);
    const after = await game.view("get_champion", { champion_id: "smith" });
    assert.equal(after.coins, before.coins - 10);
    await apply("smith", bob, "equip_gear", {
      slot: "weapon",
      gearId: tokenId,
    });
    assert.equal(
      (await game.view("get_champion", { champion_id: "smith" })).build
        .weaponId,
      identity,
    );
  }
  const funds = (await game.view("market_view", { champion_id: "smith" }))
    .treasuryYocto;
  await assert.rejects(
    alice.call(
      game,
      "withdraw_treasury",
      { receiver_id: alice.accountId, amount: "7" },
      { gas: GAS, attachedDeposit: 1n },
    ),
  );
  await root.call(
    game,
    "withdraw_treasury",
    { receiver_id: "missing." + root.accountId, amount: "7" },
    { gas: GAS, attachedDeposit: 1n },
  );
  assert.equal(
    (await game.view("market_view", { champion_id: "smith" })).treasuryYocto,
    funds,
  );
  await root.call(
    game,
    "withdraw_treasury",
    { receiver_id: root.accountId, amount: "7" },
    { gas: GAS, attachedDeposit: 1n },
  );
  assert.equal(
    BigInt(
      (await game.view("market_view", { champion_id: "smith" })).treasuryYocto,
    ),
    BigInt(funds) - 7n,
  );
  const guest = { accountId: "f".repeat(64) };
  await apply("funded-guest", guest, "register", checkpoint);
  const fundId = "vm-guest-funding";
  await apply("funded-guest", guest, "fund_guest", {}, { id: fundId });
  assert.equal(
    (await game.view("receipt_applied", { receipt_id: fundId })).nativeSuccess,
    true,
  );
  assert.equal(
    (await game.view("market_view", { champion_id: "funded-guest" })).sponsored,
    true,
  );
  await apply("funded-guest", guest, "fund_guest", {}, { id: fundId });
  await assert.rejects(apply("funded-guest", guest, "fund_guest", {}));
  console.log(
    "NEAR WASM: PASS (actual local VM, Ed25519 receipts, NFT mint/transfer/approval/callback rollback, equipped gear, vault, Duel locks, native mint, raffle, refunds, prize callbacks, funding and royalties)",
  );
  // Core attunement is authenticated NFT state, survives ownership changes and locks in Duel.
  await apply("core-a", alice, "register", {...checkpoint, coins:300});
  await apply("core-b", bob, "register", {...checkpoint, coins:300});
  await assert.rejects(apply("core-a", alice, "attune", {core:"ember"}));
  await assert.rejects(apply("core-a", alice, "attune", {core:"invented"}));
  await apply("core-a", alice, "train", {skill:"ember"});
  await apply("core-a", alice, "attune", {core:"ember"});
  const coreA = await game.view("get_champion", {champion_id:"core-a"});
  assert.equal(coreA.build.core,"ember"); assert.equal(coreA.coins,255);
  await apply("core-b", bob, "defense", {enabled:true});
  const coreB = await game.view("get_champion", {champion_id:"core-b"});
  await apply("core-a", alice, "duel_open", {duelId:"core-lock-duel",opponentId:"core-b",opponentRevision:coreB.revision,expiresAt:Date.now()+120000});
  await assert.rejects(apply("core-a", alice, "attune", {core:"ember"}));
  await apply("core-a", alice, "duel_settle", {duelId:"core-lock-duel",won:true});
  await alice.call(game,"nft_transfer",{receiver_id:charlie.accountId,token_id:"champion:core-a"},{gas:GAS,attachedDeposit:1n});
  assert.equal((await game.view("get_champion",{champion_id:"core-a"})).build.core,"ember");
  await assert.rejects(apply("core-a",alice,"attune",{core:"ember"}));
  // New skills are ordinary paid progression, with converging prerequisites and a selected Q slot.
  await apply("weapon-scholar", alice, "register", { ...checkpoint, coins: 300 });
  await assert.rejects(apply("weapon-scholar", alice, "train", {skill:"staff-4"}));
  await assert.rejects(apply("weapon-scholar", alice, "attune", {slot:"spell",spell:"nova-spell"}));
  for (const skill of ["staff-1", "staff-2"]) await apply("weapon-scholar", alice, "train", {skill});
  await assert.rejects(apply("weapon-scholar", alice, "train", {skill:"staff-4"}));
  for (const skill of ["staff-3", "staff-4", "nova-spell"]) await apply("weapon-scholar", alice, "train", {skill});
  await apply("weapon-scholar", alice, "attune", {slot:"spell",spell:"nova-spell"});
  const scholar = await game.view("get_champion", {champion_id:"weapon-scholar"});
  assert.equal(scholar.coins, 115);
  assert.equal(scholar.build.spell,"nova-spell");
  await assert.rejects(apply("weapon-scholar",alice,"train",{skill:"staff-1"}));
  await alice.call(game,"nft_transfer",{receiver_id:charlie.accountId,token_id:"champion:weapon-scholar"},{gas:GAS,attachedDeposit:1n});
  const transferredScholar = await game.view("get_champion", {champion_id:"weapon-scholar"});
  assert.equal(transferredScholar.build.spell,"nova-spell");
  assert.ok(transferredScholar.skills.includes("staff-4"));
  await assert.rejects(apply("weapon-scholar",alice,"attune",{slot:"spell",spell:"nova-spell"}));
  console.log("Weapon tree VM: PASS (converging prerequisites, exact coin, spell ownership, transfer retention)");
  console.log("Soul core VM: PASS (paid unlock, attunement, Duel lock, transfer and stale owner)");
} finally {
  await worker.tearDown();
}
