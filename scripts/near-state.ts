import { createHash } from "node:crypto";

type Page = {
  block_hash: string;
  values: { key: string; value: string }[];
  last_key?: string | null;
};
/** Pin every page to one finalized block; never compare partial state during upgrades. */
export async function contractStateHash(
  query: (params: any) => Promise<Page>,
  accountId: string,
) {
  const values = new Map<string, string>();
  const cursors = new Set<string>();
  let block: string | undefined, cursor: string | undefined;
  do {
    const page = await query({
      request_type: "view_state",
      account_id: accountId,
      prefix_base64: "",
      limit: 50,
      ...(block ? { block_id: block } : { finality: "final" }),
      ...(cursor ? { after_key_base64: cursor } : {}),
    });
    if (!page.block_hash || (block && page.block_hash !== block))
      throw new Error("State snapshot block changed");
    block = page.block_hash;
    for (const { key, value } of page.values) {
      if (values.has(key)) throw new Error("Duplicate state key across pages");
      values.set(key, value);
    }
    cursor = page.last_key ?? undefined;
    if (cursor) {
      if (!page.values.length || cursors.has(cursor))
        throw new Error("State pagination did not advance");
      cursors.add(cursor);
    }
  } while (cursor);
  const ordered = [...values].sort(([a], [b]) =>
    Buffer.compare(Buffer.from(a, "base64"), Buffer.from(b, "base64")),
  );
  return createHash("sha256").update(JSON.stringify(ordered)).digest("hex");
}
