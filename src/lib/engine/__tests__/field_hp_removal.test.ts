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
    userId: 'u', deck: 'saiyan', kiMax: 8, kiCurrent: 8, koScoredAgainst: 0,
    hand, piles: { hero: [], item: [] },
    actives, bench: [null, null],
    turnNumber: 5, friendlySaiyanKoedThisGame: false,
    activeBuuCounts: [0, 0], benchBuuCounts: [0, 0],
  };
}

function baseState(p1Actives: (FighterInstance | null)[], p1Hand: string[], field: string | null): GameState {
  return {
    turnPlayer: 'p1', turnNumber: 5, phase: 'main1', firstPlayer: 'p1', field, discard: [],
    pendingPromotions: [], winner: null, log: [], firstDamageDone: false,
    players: { p1: mkPlayer(p1Actives, p1Hand), p2: mkPlayer([null, null]) },
  };
}

test("replacing a field removes its HP bonus instead of leaving it baked in", () => {
  // Raditz is class A (Green); Cell Games Arena grants Green fighters +500 HP.
  let s = baseState([null, null], ['sacred_world_of_the_kai'], 'cell_games_arena');

  // Simulate Cell Games Arena already having granted its +500 HP to Raditz (base maxHp 4000).
  s.players.p1.actives[0] = mkFighter('raditz', { maxHp: 4500, currentHp: 4500 });

  s = applyIntent(s, { type: 'play_field', cardId: 'sacred_world_of_the_kai' });

  const raditzAfter = s.players.p1.actives[0]!;
  expect(s.field).toBe('sacred_world_of_the_kai');
  expect(raditzAfter.maxHp).toBe(4000); // Cell Games Arena's +500 HP removed; Sacred World grants no HP
  expect(raditzAfter.currentHp).toBe(4000);
});

test('field HP bonus removal never drops currentHp below 1', () => {
  let s = baseState([null, null], ['sacred_world_of_the_kai'], 'cell_games_arena');
  // Fighter took heavy damage while under the +500 HP field buff.
  s.players.p1.actives[0] = mkFighter('raditz', { maxHp: 4500, currentHp: 300 });

  s = applyIntent(s, { type: 'play_field', cardId: 'sacred_world_of_the_kai' });

  const after = s.players.p1.actives[0]!;
  expect(after.maxHp).toBe(4000);
  expect(after.currentHp).toBe(1); // floored, not -200
});
