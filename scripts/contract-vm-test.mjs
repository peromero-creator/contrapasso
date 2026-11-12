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
  await game.deploy("build/contrapasso.wasm");
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
  const apply = async (championId, owner, operation, data, extra = {}) => {
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
      expiresAt: now + 60000,
      operation,
      data,
      ...extra,
    };
    const payload = JSON.stringify(a),
      signature = sign(null, Buffer.from(payload), privateKey).toString("hex");
    return root.call(
      game,
      "apply_receipt",
      { payload, signature },
      { gas: GAS },
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
  await apply("alice", alice, "train", { skill: "ash" });
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
  assert.equal(a.coins + b.coins, 140);
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
  await assert.rejects(apply("alice", alice, "train", { skill: "reach" }));
  await apply("alice", bob, "train", { skill: "reach" });
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
  console.log(
    "NEAR WASM: PASS (actual local VM, Ed25519 receipts, NFT mint/transfer/approval/callback rollback, equipped gear, vault, Duel locks and settlement)",
  );
} finally {
  await worker.tearDown();
}
