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
    activeBuuCounts: [0, 0], benchBuuCounts: [0, 0],
  };
}

test('evolving a Buu under an active field keeps the field HP bonus instead of losing it', () => {
  // Majin Buu (Fat), base maxHp 6000, already carrying Babidi's Spaceship's +1000 HP.
  const majinBuuFat = mkFighter('majin_buu_fat', { maxHp: 7000, currentHp: 7000 });

  let s: GameState = {
    turnPlayer: 'p1', turnNumber: 5, phase: 'main1', firstPlayer: 'p1',
    field: 'babidis_spaceship', discard: [],
    pendingPromotions: [], winner: null, log: [], firstAttackDone: false,
    players: {
      p1: mkPlayer([majinBuuFat, null], ['super_buu']),
      p2: mkPlayer([null, null]),
    },
  };

  s = applyIntent(s, { type: 'evolve', cardId: 'super_buu', slotSide: 'active', slotIndex: 0 });

  const superBuu = s.players.p1.actives[0]!;
  // Super Buu base maxHp is 7500 per cards.json; +1000 from the still-active field.
  expect(superBuu.cardId).toBe('super_buu');
  expect(superBuu.maxHp).toBe(8500);
  expect(superBuu.currentHp).toBe(8500);
});
