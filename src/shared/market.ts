export const MINT_ENTRY_COIN = 10;
export const TICKET_COIN = 5;
export const MINT_PRICE_YOCTO = "10000000000000000000000"; // 0.01 test NEAR
export const SPONSOR_YOCTO = "200000000000000000000000"; // bounded demo gas/deposit grant
export const SPONSOR_LIMIT = 6;
export const MINT_CAP = 12;
export const TICKET_LIMIT = 10;
export const MARKET_OPERATIONS = [
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
}
export interface RaffleWinner {
  championId: string;
  amountYocto: string;
}
export interface MintRound {
  id: string;
  title: string;
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
export interface MarketView {
  onChain: boolean;
  round: MintRound | null;
  reservation: MintReservation | null;
  prizeYocto: string;
  sponsored: boolean;
  fundingAvailable: boolean;
  pendingNative: boolean;
  nativeBalanceYocto?: string;
  history: MintRound[];
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
