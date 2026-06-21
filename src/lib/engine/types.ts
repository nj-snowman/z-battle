export type Phase = 'draw' | 'main1' | 'battle' | 'main2' | 'end';
export type PlayerId = 'p1' | 'p2';
export type SlotType = 'active' | 'bench';
export type DrawPile = 'hero' | 'item';

export interface StatusEffect {
  key: string; // e.g. 'stun'
  until: 'their_next_turn' | 'end_of_current_turn';
}

export interface FighterInstance {
  cardId: string;
  currentHp: number;
  maxHp: number;
  equipment: string[]; // item card ids, max 2 equipment
  summoningSick: boolean;
  hasAttackedThisTurn: boolean;
  oncePerGameUsed: Record<string, boolean>;
  counters: Record<string, number>; // e.g. { legendary: 3 }
  statuses: StatusEffect[];
  cannotAttackNextTurn?: boolean; // Frieza Supernova — converted to hasAttackedThisTurn on next turn
  cannotRetreatThisTurn?: boolean; // Frieza Supernova — set alongside hasAttackedThisTurn during stun turn
}

export interface PlayerState {
  userId?: string;
  deck: string;
  kiMax: number;
  kiCurrent: number;
  koScoredAgainst: number; // KOs opponent scored ON this player
  hand: string[];
  piles: { hero: string[]; item: string[] };
  actives: (FighterInstance | null)[];
  bench: (FighterInstance | null)[];
  retreatUsedThisTurn: boolean;
  turnNumber: number; // this player's own turn count (for Ki curve)
  friendlySaiyanKoedThisGame: boolean; // for Nappa Rampage
}

export interface LogEntry {
  t: number;
  by: PlayerId;
  text: string;
}

export interface PendingPromotion {
  side: PlayerId;
  activeIndex: number;
  friezaWrathPending: boolean;
}

export interface GameState {
  phase: Phase;
  turnPlayer: PlayerId;
  turnNumber: number; // global turn counter
  firstPlayer: PlayerId; // who went first (for skip-draw on turn 1)
  field: string | null; // field card id or null
  discard: string[];
  players: { p1: PlayerState; p2: PlayerState };
  winner: PlayerId | null;
  log: LogEntry[];
  firstAttackDone: boolean;
  pendingPromotions: PendingPromotion[];
}

// ---- Card definitions (mirror cards.json shape) ----
export interface AbilityDef {
  key: string;
  kind: string;
  oncePerGame?: boolean;
  text: string;
  params: Record<string, unknown>;
}

export interface CardDef {
  id: string;
  name: string;
  cardType: 'hero' | 'item' | 'field';
  fighterType?: string;
  tier?: 'basic' | 'mid' | 'high';
  kiCost: number;
  hp?: number;
  atk?: number;
  def?: number;
  isUltimateHero?: boolean;
  itemClass?: 'equipment' | 'consumable';
  fieldClass?: 'flat' | 'type';
  abilities: AbilityDef[];
  image?: string;
}

// ---- Intents ----
export type Intent =
  | { type: 'draw'; pile: DrawPile }
  | { type: 'play_hero'; cardId: string; slot: SlotType; index: number; stunTargetIndex?: number }
  | { type: 'play_item'; cardId: string; targetSide?: SlotType; targetIndex?: number; enemyTargetIndex?: number; promotionIndex?: number; pileChoice?: 'hero' | 'item'; drawChoices?: Array<'hero' | 'item'>; discardIndex?: number }
  | { type: 'play_field'; cardId: string }
  | { type: 'retreat'; activeIndex: number; benchIndex: number }
  | { type: 'attack'; attackerIndex: number; targetIndex: number; useKaioken?: boolean; useOneShotAbility?: boolean; useTriBeam?: boolean }
  | { type: 'ultimate'; fighterIndex: number; targetIndex?: number }
  | { type: 'sacrifice'; side: SlotType; index: number }
  | { type: 'promote_from_bench'; benchIndex: number }
  | { type: 'advance_phase' }
  | { type: 'end_turn' };
