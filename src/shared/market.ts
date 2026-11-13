export const MINT_ENTRY_COIN = 10;
export const TICKET_COIN = 5;
export const MINT_PRICE_YOCTO = "10000000000000000000000"; // 0.01 test NEAR
export const SPONSOR_YOCTO = "200000000000000000000000"; // bounded demo gas/deposit grant
export const SPONSOR_LIMIT = 6;
export const MINT_CAP = 12;
export const TICKET_LIMIT = 10;
export const MARKET_OPERATIONS = [
  "list_gear",
  "cancel_sale",
  "buy_gear",
  "withdraw_sales",
  "reserve_mint",
  "cancel_mint",
  "mint",
  "tickets",
  "draw_round",
  "fund_guest",
  "withdraw_prize",
  "equip_gear",
  "unequip_gear",
] as const;
export type MarketOperation = (typeof MARKET_OPERATIONS)[number];
export interface MintReservation {
  id: string;
  championId: string;
  expiresAt: number;
  status: "reserved" | "minted" | "cancelled";
  tokenId?: string;
  weaponId?: import("../sim/weapons.ts").WeaponId;
}
export interface RaffleWinner {
  championId: string;
  amountYocto: string;
}
export interface MintRound {
  id: string;
  title: string;
  revenueMode?: "treasury" | "raffle";
  startsAt: number;
  endsAt: number;
  cap: number;
  minted: number;
  reserved: number;
  poolYocto: string;
  entryCoin: number;
  ticketCoin: number;
  priceYocto: string;
  tickets: Record<string, number>;
  reservationIds: string[];
  drawn: boolean;
  winners: RaffleWinner[];
  entropy?: string;
  drawBlock?: number;
  carriedYocto?: string;
}
export interface SaleListing {
  id: string; tokenId: string; seller: string; priceYocto: string; createdAt: number;
  weaponId: import("../sim/weapons.ts").WeaponId; level: number; kills: number; pastOwners: string[];
}
export interface MarketView {
  listings?: SaleListing[];
  proceedsYocto?: string;
  proceedsPending?: boolean;
  onChain: boolean;
  revenueMode?: "treasury" | "raffle";
  treasuryYocto?: string;
  treasuryPending?: boolean;
  round: MintRound | null;
  reservation: MintReservation | null;
  prizeYocto: string;
  sponsored: boolean;
  fundingAvailable: boolean;
  pendingNative: boolean;
  nativeBalanceYocto?: string;
  nativeGasReserveYocto?: string;
  history: MintRound[];
}
/** 120 Tgas paid call with headroom for transaction overhead. */
export function nativeGasReserve(gasPriceYocto: string): bigint {
  return BigInt(gasPriceYocto) * 150_000_000_000_000n;
}
export function canPayNative(
  quote: Pick<MarketView, "nativeBalanceYocto" | "nativeGasReserveYocto">,
  depositYocto: string,
): boolean {
  if (quote.nativeBalanceYocto === undefined || quote.nativeGasReserveYocto === undefined) return false;
  return BigInt(quote.nativeBalanceYocto) >= BigInt(depositYocto) + BigInt(quote.nativeGasReserveYocto);
}
export interface MarketIntent {
  id: string;
  championId: string;
  operation: MarketOperation;
  data: Record<string, unknown>;
  complete: boolean;
  error?: string;
  transaction?: string;
}
