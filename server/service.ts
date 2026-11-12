import { Referee, RefereeError } from "./referee.ts";
import { NearBridge } from "./near.ts";

/** Serialize local commits and relays so parallel HTTP requests cannot reuse a nonce. */
export class GameService {
  private tail: Promise<unknown> = Promise.resolve();
  readonly referee: Referee;
  readonly near: NearBridge;
  constructor(referee: Referee, near: NearBridge) {
    this.referee = referee;
    this.near = near;
  }
  private serial<T>(work: () => Promise<T>): Promise<T> {
    const result = this.tail.then(work, work);
    this.tail = result.catch(() => {});
    return result;
  }
  profile(owner: string) {
    return this.serial(async () => {
      if (this.near.config) {
        try {
          await this.near.flush();
          if (!this.referee.profile(owner).chain?.pending)
            await this.near.checkOwner(owner);
        } catch {
          /* Durable pending saves will retry; do not claim confirmation. */
        }
      }
      return this.near.status(this.referee.profile(owner));
    });
  }
  perform(owner: string, path: string, body: Record<string, unknown>) {
    return this.serial(async () => {
      if (path === "/api/duel-progress")
        return this.referee.checkpoint(owner, body.id, body.inputs);
      if (path === "/api/market") {
        const existing = this.referee.marketIntent(owner, body.id);
        if (!existing) await this.near.checkOwner(owner);
        if (!this.near.config || !this.near.supports("market"))
          throw new RefereeError("The Reliquary is not connected yet.", 503);
        if (
          ["list_gear", "cancel_sale", "buy_gear", "withdraw_sales"].includes(
            String(body.operation),
          ) &&
          !this.near.supports("exchange")
        )
          throw new RefereeError(
            "The marketplace opens after the testnet update.",
            503,
          );
        const marketData = body.data as Record<string, unknown> | undefined;
        if (
          body.operation === "reserve_mint" &&
          marketData?.weaponId &&
          marketData.weaponId !== "cinder-requiem" &&
          !this.near.supports("arsenal")
        )
          throw new RefereeError(
            "The arsenal opens after the testnet update.",
            503,
          );
        if (
          body.operation === "reserve_mint" &&
          ["gravewhisper", "vesper-reed"].includes(
            String(marketData?.weaponId),
          ) &&
          !this.near.supports("ranged")
        )
          throw new RefereeError(
            "Ranged relics open after the testnet update.",
            503,
          );
        this.referee.queueMarket(owner, body.id, body.operation, body.data);
        try {
          await this.near.flush();
        } catch {
          /* Return durable intent and let the same id confirm on retry. */
        }
        return {
          intent: this.referee.marketIntent(owner, body.id),
          champion: this.near.status(this.referee.profile(owner)),
          market: await this.near.market(this.referee.profile(owner)),
        };
      }
      await this.near.checkOwner(owner);
      let result: any;
      switch (path) {
        case "/api/runs":
          result = this.referee.begin(owner, body.retry, body.abandon);
          break;
        case "/api/results":
          result = this.referee.submit(owner, body.id, body.inputs);
          break;
        case "/api/train":
          if (
            this.near.config &&
            ["pyre", "afterimage", "coup", "mercy"].includes(
              String(body.skill),
            ) &&
            !this.near.supports("skill_tree")
          )
            throw new RefereeError(
              "The new skill paths open after the testnet update.",
              503,
            );
          result = this.referee.train(owner, body.skill);
          break;
        case "/api/upgrade":
          // An older deployed contract would reject the receipt and leave chain and save out of step.
          if (this.near.config && !this.near.supports("upgrade"))
            throw new RefereeError(
              "Gear upgrades open after the testnet contract is updated.",
              503,
            );
          result = { upgrade: this.referee.upgrade(owner, body.slot) };
          break;
        case "/api/claim": {
          if (!this.near.config || !this.near.supports("claim"))
            throw new RefereeError(
              "Claiming opens after the testnet contract is updated.",
              503,
            );
          if (!(await this.near.accountExists(String(body.receiver))))
            throw new RefereeError(
              "That testnet account does not exist. Check the name.",
              404,
            );
          const claimed = this.referee.claim(
            owner,
            body.receiver,
            body.championId,
          );
          result = { claimed };
          break;
        }
        case "/api/defense":
          result = this.referee.defense(owner, body.enabled);
          break;
        case "/api/duels":
          if (!this.near.config)
            throw new RefereeError(
              "Connect a testnet champion before entering Duel.",
              503,
            );
          await this.near.checkOpponent(body.opponentId);
          result = this.referee.beginDuel(owner, body.opponentId);
          break;
        case "/api/forfeit":
          result = this.referee.forfeit(owner, body.id);
          break;
        default:
          throw new RefereeError("Not found.", 404);
      }
      if (this.near.config) {
        try {
          await this.near.flush();
        } catch (e) {
          if (path === "/api/duels") throw e;
        }
      }
      if (
        path === "/api/train" ||
        path === "/api/defense" ||
        path === "/api/forfeit"
      )
        return this.near.status(this.referee.profile(owner));
      if (path === "/api/upgrade")
        result.champion = this.near.status(this.referee.profile(owner));
      if (path === "/api/claim") {
        result.champion = this.near.status(this.referee.profile(owner));
        result.claimed = {
          tokenId: `champion:${result.claimed.championId}`,
          pending: !!this.referee.pendingClaim(result.claimed.championId),
          receiver: result.claimed.receiver,
          transaction: this.referee.claimTransaction(result.claimed.championId),
        };
      }
      if (path === "/api/results")
        result.champion = this.near.status(this.referee.profile(owner));
      return result;
    });
  }
  market(owner: string) {
    return this.serial(async () => {
      try {
        await this.near.checkOwner(owner);
      } catch (e) {
        if (!this.referee.profile(owner).chain?.pending) throw e;
      }
      return this.near.market(this.referee.profile(owner));
    });
  }
  nft(owner: string) {
    return this.serial(async () => {
      if (this.near.config) {
        await this.near.checkOwner(owner);
      }
      return this.near.tokens(this.referee.profile(owner));
    });
  }
  opponents(owner: string) {
    return this.serial(async () => {
      await this.near.checkOwner(owner);
      return this.referee.opponents(owner);
    });
  }
  currentDuel(owner: string) {
    return this.serial(async () => {
      await this.near.checkOwner(owner);
      return this.referee.currentDuel(owner);
    });
  }
  lobby(owner: string) {
    return this.serial(async () => {
      if (!this.near.config)
        throw new RefereeError("Testnet connection is not ready.", 503);
      await this.near.checkOwner(owner);
      return {
        champion: this.near.status(this.referee.profile(owner)),
        opponents: this.referee.opponents(owner),
        active: this.referee.currentDuel(owner),
        stake: 10,
      };
    });
  }
  retryPending() {
    return this.serial(() => this.near.flush());
  }
}
