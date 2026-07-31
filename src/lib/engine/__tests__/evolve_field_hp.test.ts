import { applyIntent } from '../engine';
import type { GameState, PlayerState, FighterInstance } from '../types';

function mkFighter(cardId: string, overrides: Partial<FighterInstance> = {}): FighterInstance {
  return {
    cardId, maxHp: 3000, currentHp: 3000, equipment: [], summoningSick: false,
    hasAttackedThisTurn: false, oncePerGameUsed: {}, counters: {}, statuses: [],
    ...overrides,
  };
}

function mkPlayer(actives: (FighterInstance | null)[], hand: string[] = []): PlayerState {
  return {
    userId: 'u', deck: 'majin', kiMax: 8, kiCurrent: 8, koScoredAgainst: 0,
    hand, piles: { hero: [], item: [] },
    actives, bench: [null, null],
    turnNumber: 5, friendlySaiyanKoedThisGame: false,
  };
}

test('evolving a Buu under an active field recomputes the field HP bonus for the new stage\'s class', () => {
  // Evil Buu is class A (Green); Cell Games Arena grants Green fighters +500 HP.
  // Evil Buu here is already carrying that +500 (maxHp 3000 base + 500).
  const evilBuu = mkFighter('evil_buu', { maxHp: 3500, currentHp: 2500 }); // took 1000 damage while buffed

  let s: GameState = {
    turnPlayer: 'p1', turnNumber: 5, phase: 'main1', firstPlayer: 'p1',
    field: 'cell_games_arena', discard: [],
    pendingPromotions: [], winner: null, log: [], firstDamageDone: false,
    players: {
      p1: mkPlayer([evilBuu, null], ['majin_buu_fat']),
      p2: mkPlayer([null, null]),
    },
  };

  s = applyIntent(s, { type: 'evolve', cardId: 'majin_buu_fat', slotSide: 'active', slotIndex: 0 });

  const fatBuu = s.players.p1.actives[0]!;
  // Majin Buu (Fat) is class C (Yellow) — no longer matches Cell Games Arena's Green bonus,
  // so the +500 HP is NOT carried over; maxHp is just the new stage's base 6000.
  // The 1000 damage already taken still carries: 6000 - 1000 = 5000.
  expect(fatBuu.cardId).toBe('majin_buu_fat');
  expect(fatBuu.maxHp).toBe(6000);
  expect(fatBuu.currentHp).toBe(5000);
});
