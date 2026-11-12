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
          result = this.referee.train(owner, body.skill);
          break;
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
      if (path === "/api/results")
        result.champion = this.near.status(this.referee.profile(owner));
      return result;
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
