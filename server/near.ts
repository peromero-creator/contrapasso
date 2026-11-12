import { NotEnoughBalanceError } from "near-api-js/rpc-errors";
import {
  MARKET_OPERATIONS,
  type MarketOperation,
  type MarketView,
  MINT_PRICE_YOCTO,
} from "../src/shared/market.ts";
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
  NftView,
  NftToken,
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
  /** Receipt operations the deployed contract understands beyond the first release. */
  features?: string[];
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
  private features: string[] = [];
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
    this.features = Array.isArray(config.features)
      ? config.features.filter((f: unknown) => typeof f === "string")
      : [];
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
  supports(feature: string) {
    return this.features.includes(feature);
  }
  /** Whether a NEAR account exists on testnet (so a claim cannot go to a typo). */
  async accountExists(accountId: string): Promise<boolean> {
    if (!this.config) return false;
    await this.ready();
    try {
      await this.provider!.viewAccount({ accountId });
      return true;
    } catch {
      return false;
    }
  }
  /** The champion and gear NFTs exactly as the contract reports them. */
  async tokens(profile: Champion): Promise<NftView> {
    const ids = [
      `champion:${profile.id}`,
      `weapon:${profile.id}`,
      `armor:${profile.id}`,
    ];
    if (!this.config)
      return {
        onChain: false,
        tokens: [
          {
            tokenId: ids[0],
            ownerId: "local preview",
            title: `The Unforgiven / ${profile.id.slice(0, 8)}`,
            extra: {
              kind: "champion",
              coins: profile.coins,
              skills: profile.skills,
              runs: profile.runs,
              victories: profile.victories,
              duelWins: profile.duelWins,
              duelLosses: profile.duelLosses,
              bestFloor: profile.bestFloor,
            },
          },
          {
            tokenId: ids[1],
            ownerId: "local preview",
            title: "Cinder / Starter Blade",
            extra: {
              kind: "weapon",
              level: profile.build.weaponLevel,
              bound: true,
            },
          },
          {
            tokenId: ids[2],
            ownerId: "local preview",
            title: "Ash / Starter Armor",
            extra: {
              kind: "armor",
              level: profile.build.armorLevel,
              bound: true,
            },
          },
        ],
      };
    await this.ready();
    const tokens: NftToken[] = [];
    const inventory: any[] = [];
    for (let offset = 0; offset < 1000; offset += 50) {
      const page = await this.view("nft_tokens_for_owner", {
        account_id: this.guest(profile.id).accountId,
        from_index: String(offset),
        limit: 50,
      });
      inventory.push(...page);
      if (page.length < 50) break;
    }
    for (const token of inventory) {
      const id = token.token_id;
      if (!token) continue;
      let extra: Record<string, unknown> = {};
      try {
        extra = JSON.parse(token.metadata?.extra ?? "{}");
      } catch {
        /* show the token without its details */
      }
      tokens.push({
        tokenId: token.token_id,
        ownerId: token.owner_id,
        title: token.metadata?.title ?? id,
        extra,
      });
    }
    return {
      onChain: true,
      contractId: this.config.contractId,
      features: [...this.features],
      tokens,
    };
  }
  async market(profile: Champion): Promise<MarketView> {
    if (!this.config)
      return {
        onChain: false,
        round: null,
        reservation: null,
        prizeYocto: "0",
        sponsored: false,
        fundingAvailable: false,
        pendingNative: false,
        history: [],
      };
    await this.ready();
    if (!this.supports("market"))
      throw new RefereeError(
        "The Reliquary opens after its testnet update.",
        503,
      );
    const market = await this.view("market_view", { champion_id: profile.id });
    let nativeBalanceYocto: string | undefined;
    try {
      nativeBalanceYocto = String(
        (
          await this.provider!.viewAccount({
            accountId: this.guest(profile.id).accountId,
          })
        ).amount,
      );
    } catch {
      /* An unfunded implicit guest account has no native balance yet. */
    }
    return { ...market, onChain: true, nativeBalanceYocto };
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
        features: [...this.features],
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
    const attempted = new Set<string>();
    for (let count = 0; count < 2000; count++) {
      const event = this.referee
        .pendingChainOperations()
        .find(
          (e) =>
            !attempted.has(e.id) &&
            !blocked.has(e.championId) &&
            (!e.opponentId || !blocked.has(e.opponentId)),
        );
      if (!event) break;
      attempted.add(event.id);
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
    let transaction = event.transactionHash;
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
      if (
        event.operation === "upgrade" &&
        (current.equipped?.[String(event.data.slot)] !== event.data.gearId ||
          current.build[
            String(event.data.slot) === "weapon" ? "weaponLevel" : "armorLevel"
          ] !== event.data.fromLevel)
      ) {
        this.referee.rejectChainOperation(
          event.id,
          { [event.championId]: current },
          "Equipped gear changed.",
        );
        throw new RefereeError(
          "Equipped gear changed; the upgrade was not charged. Refresh your forge.",
          409,
        );
      }
      if (event.operation === "mint") {
        let balance = 0n;
        try {
          balance = BigInt(
            (await this.provider!.viewAccount({ accountId })).amount,
          );
        } catch (error) {
          if (
            !["UnknownAccountError", "AccountDoesNotExistError"].includes(
              (error as Error).name,
            )
          ) throw error;
        }
        if (balance < 150000000000000000000000n) {
          this.referee.rejectChainOperation(
            event.id,
            { [event.championId]: current },
            "Get demo test NEAR before minting. Your coin reservation is safe.",
          );
          return;
        }
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
      const paid = event.operation === "mint";
      const signer = paid
        ? new Account(
            accountId,
            this.provider!,
            KeyPairSigner.fromSecretKey(this.guest(event.championId).secretKey),
          )
        : this.account!;
      try {
        const outcome = await signer.callFunctionRaw({
          contractId: this.config!.contractId,
          methodName: "apply_receipt",
          args: { payload, signature },
          gas: paid ? 120000000000000n : 300000000000000n,
          deposit: paid ? BigInt(MINT_PRICE_YOCTO) : 0n,
          waitUntil: "FINAL",
        });
        transaction = outcome.transaction.hash;
        this.referee.noteChainTransaction(event.id, transaction);
      } catch (error) {
        // Reject only a final, known failed transaction with no applied receipt.
        // Transport timeouts remain in the outbox and retry with the same receipt id.
        const failure = error as {
          txHash?: string;
          transactionResult?: any;
          message?: string;
        };
        if (failure.txHash)
          this.referee.noteChainTransaction(event.id, failure.txHash);
        if (
          MARKET_OPERATIONS.includes(event.operation as MarketOperation) &&
          (failure.transactionResult?.status?.Failure ||
            (error instanceof NotEnoughBalanceError && !failure.txHash)) &&
          !(await this.view("receipt_applied", { receipt_id: event.id }))
        ) {
          const state = await this.view("get_champion", {
            champion_id: event.championId,
          });
          const known = [
            "Not enough coin",
            "This mint round is closed",
            "All editions are reserved",
            "The draw is not ready",
            "Demo fund reserve is exhausted",
            "Ticket limit reached",
          ].find((message) => failure.message?.includes(message));
          this.referee.rejectChainOperation(
            event.id,
            { [event.championId]: state },
            known
              ? `${known}. Refresh the Reliquary.`
              : error instanceof NotEnoughBalanceError
                ? "Not enough test NEAR for mint gas. Your reservation is safe."
                : "The testnet action failed. No coin or mint payment was kept. Refresh and try again.",
          );
        }
        throw error;
      }
      applied = await this.view("receipt_applied", { receipt_id: event.id });
      if (!applied) throw new Error("Receipt confirmation unavailable");
    }
    if (
      (event.operation === "fund_guest" ||
        event.operation === "withdraw_prize") &&
      !applied.nativeComplete
    )
      throw new RefereeError("The testnet transfer is still confirming.", 409);
    if (applied.nativeComplete && !applied.nativeSuccess) {
      const state = await this.view("get_champion", {
        champion_id: event.championId,
      });
      this.referee.rejectChainOperation(
        event.id,
        { [event.championId]: state },
        "The native transfer failed; your prize remains in the champion vault.",
      );
      return;
    }
    const statuses: Record<string, ChainStatus> = {};
    const states: Record<string, any> = {};
    for (const id of [event.championId, event.opponentId].filter(
      Boolean,
    ) as string[]) {
      const state = await this.view("get_champion", { champion_id: id });
      if (!state) throw new Error("Champion confirmation unavailable");
      states[id] = state;
      statuses[id] = {
        network: "testnet",
        contractId: this.config!.contractId,
        accountId: state.ownerId,
        tokenId: `champion:${id}`,
        pending: false,
        lastTransaction: transaction,
        revision: state.revision,
      };
    }
    this.referee.acknowledgeChain(event.id, statuses, states);
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
