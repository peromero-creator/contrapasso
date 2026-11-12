import { createServer } from "node:http";
import { createHash } from "node:crypto";
import { mkdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join } from "node:path";
import { Referee, RefereeError } from "./referee.ts";
import { SIM_VERSION } from "../src/sim/input.ts";
import { NearBridge } from "./near.ts";
import { GameService } from "./service.ts";
import { refereeKey } from "./keys.ts";

const directory =
  process.env.REFEREE_DATA_DIR ??
  fileURLToPath(new URL("../.data", import.meta.url));
mkdirSync(directory, { recursive: true, mode: 0o700 });
const key = refereeKey(directory);
const referee = new Referee({ directory, key });
const near = new NearBridge(directory, referee);
const service = new GameService(referee, near);
setInterval(() => {
  void service.retryPending().catch(() => {});
}, 10_000).unref();
const origins = new Set([
  "http://127.0.0.1:5173",
  "http://localhost:5173",
  "http://127.0.0.1:8787",
  "http://localhost:8787",
]);
const limits = new Map<string, { at: number; count: number }>();
const server = createServer(async (req, res) => {
  res.setHeader("Content-Type", "application/json");
  res.setHeader("Cache-Control", "no-store");
  res.setHeader("X-Content-Type-Options", "nosniff");
  try {
    if (req.headers.origin && !origins.has(req.headers.origin))
      throw new RefereeError("Origin not allowed.", 403);
    const url = new URL(req.url ?? "/", "http://127.0.0.1");
    if (req.method === "GET" && url.pathname === "/api/info") {
      res.end(
        JSON.stringify({
          version: SIM_VERSION,
          publicKey: referee.publicKey,
          ...near.info(),
        }),
      );
      return;
    }
    const token = req.headers.cookie?.match(
      /(?:^|;\s*)contrapasso=([A-Za-z0-9_-]{43})(?:;|$)/,
    )?.[1];
    let owner = token ? createHash("sha256").update(token).digest("hex") : "";
    if (!referee.hasSession(owner)) {
      if (req.method !== "GET" || url.pathname !== "/api/profile")
        throw new RefereeError("Reload to restore your guest session.", 401);
      const session = referee.createSession();
      owner = session.owner;
      res.setHeader(
        "Set-Cookie",
        `contrapasso=${session.token}; HttpOnly; SameSite=Strict; Path=/api; Max-Age=2592000`,
      );
    }
    if (req.method === "GET" && url.pathname === "/api/profile") {
      res.end(JSON.stringify(await service.profile(owner)));
      return;
    }
    if (req.method === "GET" && url.pathname === "/api/opponents") {
      res.end(JSON.stringify(await service.opponents(owner)));
      return;
    }
    if (req.method === "GET" && url.pathname === "/api/duel-current") {
      res.end(JSON.stringify(await service.currentDuel(owner)));
      return;
    }
    if (req.method === "GET" && url.pathname === "/api/duel-lobby") {
      res.end(JSON.stringify(await service.lobby(owner)));
      return;
    }
    if (req.method !== "POST") throw new RefereeError("Not found.", 404);
    const now = Date.now();
    const limitKey =
      url.pathname === "/api/duel-progress" ? `${owner}:progress` : owner;
    const limit = limits.get(limitKey);
    if (limit && now - limit.at < 60_000) {
      if (++limit.count > (url.pathname === "/api/duel-progress" ? 90 : 30))
        throw new RefereeError("Please slow down.", 429);
    } else limits.set(limitKey, { at: now, count: 1 });
    if (limits.size > 1000)
      for (const [id, value] of limits)
        if (now - value.at > 60_000) limits.delete(id);
    let bytes = 0;
    const chunks: Buffer[] = [];
    for await (const chunk of req) {
      bytes += chunk.length;
      if (bytes > 1_048_576)
        throw new RefereeError("Replay is too large.", 413);
      chunks.push(Buffer.from(chunk));
    }
    let body;
    try {
      body = JSON.parse(Buffer.concat(chunks).toString("utf8"));
    } catch {
      throw new RefereeError("Invalid JSON.");
    }
    if (!body || typeof body !== "object" || Array.isArray(body))
      throw new RefereeError("Invalid request.");
    const result = await service.perform(owner, url.pathname, body);
    res.end(JSON.stringify(result));
  } catch (e) {
    const known = e instanceof RefereeError;
    res.statusCode = known ? e.status : 500;
    res.end(
      JSON.stringify({
        error: known ? e.message : "Unable to save your descent. Try again.",
      }),
    );
    if (!known) console.error("Referee request failed:", (e as Error).message);
  }
});
server.requestTimeout = 10_000;
server.headersTimeout = 5000;
server.listen(8787, "127.0.0.1", () =>
  console.log("Contrapasso referee: http://127.0.0.1:8787"),
);
