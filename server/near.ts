import {
  Account,
  type Provider,
  KeyPair,
  KeyPairSigner,
  keyToImplicitAddress,
  type KeyPairString,
} from "near-api-js";
import { readFileSync, writeFileSync, renameSync } from "node:fs";
import { join } from "node:path";
import type { Referee } from "./referee.ts";
import { RefereeError } from "./referee.ts";
import type {
  Champion,
  ChainOperation,
  ChainStatus,
} from "../src/shared/protocol.ts";
import { testnetProvider, TESTNET_RPC_URLS } from "./rpc.ts";
import { sameBuild } from "../src/sim/build.ts";

export interface NearConfig {
  network: "testnet";
  rpcUrl: string;
  accountId: string;
  contractId: string;
  secretKey: KeyPairString;
  deploymentTransaction?: string;
}
export function loadNearConfig(directory: string): NearConfig | null {
  try {
    const config = JSON.parse(
      readFileSync(join(directory, "near.json"), "utf8"),
    );
    if (
      config.network !== "testnet" ||
      !config.accountId?.endsWith(".testnet") ||
      !config.contractId?.endsWith(".testnet")
    )
      throw new Error("NEAR configuration must use testnet accounts");
    if (!TESTNET_RPC_URLS.includes(config.rpcUrl))
      throw new Error("Unsupported testnet RPC");
    return config;
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw e;
  }
}
export class NearBridge {
  readonly config: NearConfig | null;
  private provider: Provider | null = null;
  private account: Account | null = null;
  private checked = false;
  private guests: Record<
    string,
    { accountId: string; secretKey: KeyPairString }
  >;
  private file: string;
  private referee: Referee;
  constructor(directory: string, referee: Referee) {
    this.referee = referee;
    this.file = join(directory, "near-guests.json");
    this.config = loadNearConfig(directory);
    try {
      this.guests = JSON.parse(readFileSync(this.file, "utf8"));
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code !== "ENOENT") throw e;
      this.guests = {};
    }
    if (this.config) {
      this.provider = testnetProvider(this.config.rpcUrl);
      this.account = new Account(
        this.config.accountId,
        this.provider,
        KeyPairSigner.fromSecretKey(this.config.secretKey),
      );
    }
  }
  private guest(id: string) {
    if (!this.guests[id]) {
      const key = KeyPair.fromRandom("ed25519");
      this.guests[id] = {
        accountId: keyToImplicitAddress(key.getPublicKey()),
        secretKey: key.toString() as KeyPairString,
      };
      writeFileSync(`${this.file}.tmp`, JSON.stringify(this.guests), {
        mode: 0o600,
      });
      renameSync(`${this.file}.tmp`, this.file);
    }
    return this.guests[id];
  }
  private async ready() {
    if (!this.provider || !this.config)
      throw new RefereeError("Testnet is not connected yet.", 503);
    if (this.checked) return;
    const status = await this.provider.viewNodeStatus();
    if (status.chain_id !== "testnet")
      throw new Error("Refusing to sign on a non-testnet network");
    const config = await this.view("game_config", {});
    if (config.referee_public_key !== this.referee.publicKeyHex)
      throw new Error("Referee key does not match the testnet contract");
    this.checked = true;
  }
  private async view(
    method: string,
    args: Record<string, unknown>,
  ): Promise<any> {
    return this.provider!.callFunction<any>({
      contractId: this.config!.contractId,
      method,
      args,
    });
  }
  status(profile: Champion): Champion {
    if (!this.config) return profile;
    const guest = this.guest(profile.id);
    return {
      ...profile,
      chain: {
        network: "testnet",
        contractId: this.config.contractId,
        accountId: guest.accountId,
        tokenId: `champion:${profile.id}`,
        revision: profile.chain?.revision ?? 0,
        lastTransaction: profile.chain?.lastTransaction,
        pending: !profile.chain || profile.chain.pending,
      },
    };
  }
  async flush(): Promise<void> {
    if (!this.config) return;
    await this.ready();
    let failure: unknown;
    const blocked = new Set<string>();
    for (const event of this.referee.pendingChainOperations()) {
      if (
        !this.referee.pendingChainOperations().some((e) => e.id === event.id) ||
        blocked.has(event.championId) ||
        (event.opponentId && blocked.has(event.opponentId))
      )
        continue;
      try {
        await this.apply(event);
      } catch (e) {
        failure ??= e;
        blocked.add(event.championId);
        if (event.opponentId) blocked.add(event.opponentId);
      }
    }
    if (failure) throw failure;
  }
  private async apply(event: ChainOperation) {
    const accountId = this.guest(event.championId).accountId;
    let applied = await this.view("receipt_applied", { receipt_id: event.id });
    let transaction: string | undefined;
    if (!applied) {
      const current = await this.view("get_champion", {
        champion_id: event.championId,
      });
      if (
        event.operation !== "register" &&
        (!current || current.ownerId !== accountId)
      ) {
        if (event.operation !== "duel_open")
          this.referee.rejectChainOperation(
            event.id,
            { [event.championId]: current },
            "The champion changed owners before its save.",
          );
        else
          await this.rejectOpen(
            event,
            current,
            "The champion changed owners before this Duel.",
          );
        throw new RefereeError(
          "This champion has moved to another owner. Its vault stays with the NFT.",
          409,
        );
      }
      const data = { ...event.data };
      if (event.operation === "duel_open") {
        const opponent = await this.view("get_champion", {
          champion_id: event.opponentId,
        });
        const local = this.referee.chainProfile(event.championId),
          defender = this.referee.chainProfile(event.opponentId!);
        if (
          !opponent ||
          opponent.ownerId !== this.guest(event.opponentId!).accountId ||
          !opponent.defending ||
          opponent.lockedBy ||
          current.lockedBy ||
          Number(event.data.expiresAt) <= Date.now() ||
          !local ||
          !defender ||
          !sameBuild(current.build, local.build) ||
          !sameBuild(opponent.build, defender.build)
        ) {
          await this.rejectOpen(
            event,
            current,
            "This Duel could not open. The champions were refreshed; no stake was taken.",
          );
          throw new RefereeError(
            "Opponent or Duel deadline changed. Refresh the lobby.",
            409,
          );
        }
        data.opponentRevision = opponent.revision;
      }
      const payload = JSON.stringify({
        domain: "contrapasso:testnet:v1",
        contractId: this.config!.contractId,
        id: event.id,
        operation: event.operation,
        championId: event.championId,
        ownerId: accountId,
        revision: current?.revision ?? 0,
        expiresAt: Date.now() + 60 * 60000,
        data,
      });
      const signature = this.referee.signChainPayload(payload);
      const outcome = await this.account!.callFunctionRaw({
        contractId: this.config!.contractId,
        methodName: "apply_receipt",
        args: { payload, signature },
        gas: 300000000000000n,
        deposit: 0n,
        waitUntil: "FINAL",
      });
      transaction = outcome.transaction.hash;
      applied = await this.view("receipt_applied", { receipt_id: event.id });
      if (!applied) throw new Error("Receipt confirmation unavailable");
    }
    const statuses: Record<string, ChainStatus> = {};
    for (const id of [event.championId, event.opponentId].filter(
      Boolean,
    ) as string[]) {
      const state = await this.view("get_champion", { champion_id: id });
      if (!state) throw new Error("Champion confirmation unavailable");
      statuses[id] = {
        network: "testnet",
        contractId: this.config!.contractId,
        accountId: this.guest(id).accountId,
        tokenId: `champion:${id}`,
        pending: false,
        lastTransaction:
          transaction ?? this.referee.chainProfile(id)?.chain?.lastTransaction,
        revision: state.revision,
      };
    }
    this.referee.acknowledgeChain(event.id, statuses);
  }
  private async rejectOpen(
    event: ChainOperation,
    current: any,
    reason: string,
  ) {
    // A lost RPC response may hide a successful open. Never refund until its absence is confirmed.
    if (await this.view("get_duel", { duel_id: event.data.duelId }))
      throw new Error(
        "Duel already exists; waiting for its receipt confirmation",
      );
    const opponent = await this.view("get_champion", {
      champion_id: event.opponentId,
    });
    this.referee.rejectChainOperation(
      event.id,
      { [event.championId]: current, [event.opponentId!]: opponent },
      reason,
    );
  }
  async checkOwner(owner: string) {
    if (!this.config) return;
    try {
      await this.flush();
    } catch (e) {
      if (this.referee.profile(owner).chain?.pending !== false) throw e;
    }
    const profile = this.referee.profile(owner),
      state = await this.view("get_champion", { champion_id: profile.id });
    if (!state || state.ownerId !== this.guest(profile.id).accountId)
      throw new RefereeError("This champion belongs to another owner.", 409);
    this.referee.adoptChain(profile.id, state);
  }
  async checkOpponent(id: unknown) {
    if (!this.config || typeof id !== "string")
      throw new RefereeError("Choose a testnet opponent.");
    if (!this.referee.chainProfile(id))
      throw new RefereeError("Opponent unavailable.", 404);
    const state = await this.view("get_champion", { champion_id: id });
    if (!state || state.ownerId !== this.guest(id).accountId)
      throw new RefereeError("Opponent changed owners. Refresh the list.", 409);
    this.referee.adoptChain(id, state);
  }
  info() {
    return this.config
      ? {
          network: "testnet",
          contractId: this.config.contractId,
          deploymentTransaction: this.config.deploymentTransaction,
        }
      : { network: "local", contractId: null };
  }
}
