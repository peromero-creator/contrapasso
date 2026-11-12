// Native-price resale of existing gear NFTs. Ownership changes synchronously; proceeds use pull payments.
const check = (ok, message) => { if (!ok) throw new Error(message); };
const add = (a, b) => (BigInt(a ?? "0") + BigInt(b)).toString();
export const sale = (s, tokenId) => s.market.get(`sale:${tokenId}`);
export const saleBalance = (s, owner) => s.market.get(`sales:balance:${owner}`) ?? "0";
export const salePending = (s, owner) => s.market.get(`sales:pending:${owner}`);
export const listings = (s) => (s.market.get("sales:active") ?? []).map(id => sale(s, id)).filter(Boolean);
export function listGear(s, ctx, owner, data) {
  check(typeof data.tokenId === "string" && data.tokenId.length <= 160, "Invalid gear NFT");
  check(typeof data.priceYocto === "string" && /^[0-9]{1,25}$/.test(data.priceYocto) && BigInt(data.priceYocto) >= 10n ** 21n && BigInt(data.priceYocto) <= 10n ** 24n, "Choose a price from 0.001 to 1 test NEAR");
  const g = s.gearInfo(data.tokenId);
  check(g && !g.bound && !g.equippedTo && !s.gearPending(data.tokenId), "Unequip tradable gear before listing");
  check(s.gearOwner(data.tokenId) === owner, "Seller does not own this NFT");
  check(!sale(s, data.tokenId), "NFT already listed");
  const ids = s.market.get("sales:active") ?? [];
  check(ids.length < 100, "Marketplace listing limit reached");
  const sequence = (s.market.get("sales:sequence") ?? 0) + 1;
  check(Number.isSafeInteger(sequence), "Listing sequence exhausted");
  const listing = { id: `${data.tokenId}@${sequence}`, tokenId: data.tokenId, seller: owner, priceYocto: data.priceYocto, createdAt: ctx.nowMs, weaponId: g.weaponId ?? g.collection, level: g.level, kills: g.kills, pastOwners: [...g.pastOwners] };
  s.market.set(`sale:${data.tokenId}`, listing);
  s.market.set("sales:active", [...ids, data.tokenId]);
  s.market.set("sales:sequence", sequence);
  return listing;
}
function remove(s, tokenId) {
  s.market.remove(`sale:${tokenId}`);
  s.market.set("sales:active", (s.market.get("sales:active") ?? []).filter(id => id !== tokenId));
}
export function cancelSale(s, owner, data) {
  const l = sale(s, data.tokenId);
  check(l && l.id === data.listingId && l.seller === owner && s.gearOwner(l.tokenId) === owner, "Listing changed or belongs to another seller");
  remove(s, l.tokenId);
}
export function buyGear(s, ctx, buyer, data) {
  const l = sale(s, data.tokenId);
  check(l && l.id === data.listingId && l.priceYocto === data.priceYocto, "Listing changed; refresh the marketplace");
  check(l.seller !== buyer, "Cannot buy your own NFT");
  check(ctx.predecessor === buyer && ctx.depositYocto === l.priceYocto, "Purchase requires buyer and exact native payment");
  const g = s.gearInfo(l.tokenId);
  check(g && !g.bound && !g.equippedTo && !s.gearPending(l.tokenId) && s.gearOwner(l.tokenId) === l.seller, "Listed NFT is unavailable");
  const config = s.market.get("config");
  check(config?.mode === "treasury", "Treasury must be active before resale");
  remove(s, l.tokenId);
  s.transferGear(l.tokenId, l.seller, buyer);
  const price = BigInt(l.priceYocto), royalty = price / 10n;
  config.treasuryYocto = add(config.treasuryYocto, royalty);
  config.liabilityYocto = add(config.liabilityYocto, price);
  s.market.set("config", config);
  s.market.set(`sales:balance:${l.seller}`, add(saleBalance(s, l.seller), price - royalty));
  return l;
}
export function beginSaleWithdrawal(s, owner) {
  const amount = saleBalance(s, owner);
  check(BigInt(amount) > 0n && !salePending(s, owner), "No sale proceeds available or withdrawal pending");
  s.market.set(`sales:balance:${owner}`, "0");
  s.market.set(`sales:pending:${owner}`, amount);
  return amount;
}
export function resolveSaleWithdrawal(s, owner, success) {
  const amount = salePending(s, owner);
  check(amount, "No sale withdrawal pending");
  const config = s.market.get("config");
  if (success) config.liabilityYocto = (BigInt(config.liabilityYocto) - BigInt(amount)).toString();
  else s.market.set(`sales:balance:${owner}`, add(saleBalance(s, owner), amount));
  s.market.remove(`sales:pending:${owner}`);
  s.market.set("config", config);
}
