import type { GameState, PlayerState, FighterInstance } from '@/lib/engine/types';

const vegeta: FighterInstance = {
  cardId: 'vegeta',
  currentHp: 5500,
  maxHp: 9000,
  equipment: ['saiyan_armor'],
  summoningSick: false,
  hasAttackedThisTurn: false,
  oncePerGameUsed: { final_flash: false },
  counters: {},
  statuses: [],
};

const broly: FighterInstance = {
  cardId: 'broly',
  currentHp: 9500,
  maxHp: 9500,
  equipment: [],
  summoningSick: false,
  hasAttackedThisTurn: true,
  oncePerGameUsed: {},
  counters: { legendary: 2 },
  statuses: [],
};

const bardock: FighterInstance = {
  cardId: 'bardock',
  currentHp: 2000,
  maxHp: 6000,
  equipment: [],
  summoningSick: true,
  hasAttackedThisTurn: false,
  oncePerGameUsed: {},
  counters: {},
  statuses: [],
};

const piccolo: FighterInstance = {
  cardId: 'piccolo',
  currentHp: 6000,
  maxHp: 9000,
  equipment: ['demon_cloak'],
  summoningSick: false,
  hasAttackedThisTurn: false,
  oncePerGameUsed: { special_beam_cannon: false },
  counters: {},
  statuses: [],
};

const nail: FighterInstance = {
  cardId: 'nail',
  currentHp: 3500,
  maxHp: 5500,
  equipment: [],
  summoningSick: false,
  hasAttackedThisTurn: false,
  oncePerGameUsed: {},
  counters: {},
  statuses: [{ key: 'stun', until: 'their_next_turn' }],
};

const dende: FighterInstance = {
  cardId: 'dende',
  currentHp: 3000,
  maxHp: 3000,
  equipment: [],
  summoningSick: false,
  hasAttackedThisTurn: false,
  oncePerGameUsed: {},
  counters: {},
  statuses: [],
};

const p1: PlayerState = {
  userId: 'player1',
  deck: 'saiyan',
  kiMax: 5,
  kiCurrent: 3,
  koScoredAgainst: 1,
  hand: ['raditz', 'senzu_bean', 'galick_gun', 'super_saiyan', 'future_trunks'],
  piles: { hero: [], item: [] },
  actives: [vegeta, broly],
  bench: [bardock, null],
  retreatUsedThisTurn: false,
  turnNumber: 5,
  friendlySaiyanKoedThisGame: false,
  activeBuuCounts: [0, 0],
  benchBuuCounts: [0, 0],
};

const p2: PlayerState = {
  userId: 'player2',
  deck: 'namekian',
  kiMax: 5,
  kiCurrent: 5,
  koScoredAgainst: 1,
  hand: ['planet_namek', 'dragon_clan_ritual', 'namekian_insight', 'fusion_namekian'],
  piles: { hero: [], item: [] },
  actives: [piccolo, nail],
  bench: [dende, null],
  retreatUsedThisTurn: false,
  turnNumber: 4,
  friendlySaiyanKoedThisGame: false,
  activeBuuCounts: [0, 0],
  benchBuuCounts: [0, 0],
};

export const mockState: GameState = {
  phase: 'battle',
  turnPlayer: 'p1',
  turnNumber: 9,
  firstPlayer: 'p1',
  field: 'hyperbolic_time_chamber',
  discard: [],
  players: { p1, p2 },
  winner: null,
  log: [],
  firstAttackDone: false,
  pendingPromotions: [],
};
