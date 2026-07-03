import { applyIntent } from '../engine';
import type { GameState, PlayerState, FighterInstance } from '../types';

function mkFighter(cardId: string, overrides: Partial<FighterInstance> = {}): FighterInstance {
  return {
    cardId, maxHp: 9000, currentHp: 9000, equipment: [], summoningSick: false,
    hasAttackedThisTurn: false, oncePerGameUsed: {}, counters: {}, statuses: [],
    ...overrides,
  };
}

function mkPlayer(actives: (FighterInstance | null)[]): PlayerState {
  return {
    userId: 'u', deck: 'majin', kiMax: 8, kiCurrent: 8, koScoredAgainst: 0,
    hand: [], piles: { hero: [], item: [] },
    actives, bench: [null, null],
    turnNumber: 5, friendlySaiyanKoedThisGame: false,
    activeBuuCounts: [0, 0], benchBuuCounts: [0, 0],
  };
}

function baseState(p1Actives: (FighterInstance | null)[], p2Actives: (FighterInstance | null)[]): GameState {
  return {
    turnPlayer: 'p1', turnNumber: 5, phase: 'battle', firstPlayer: 'p1', field: null, discard: [],
    pendingPromotions: [], winner: null, log: [], firstDamageDone: false,
    players: { p1: mkPlayer(p1Actives), p2: mkPlayer(p2Actives) },
  };
}

test("Kid Buu does NOT gain Pure Evil stacks when a teammate scores the KO", () => {
  const kidBuu = mkFighter('kid_buu');
  const teammate = mkFighter('vegeta', { maxHp: 9000, currentHp: 9000 });
  const victim = mkFighter('pui_pui', { maxHp: 1000, currentHp: 1000 });

  let s = baseState([kidBuu, teammate], [victim, null]);
  // Vegeta (slot 1) attacks and KOs the enemy — Kid Buu is not involved.
  s = applyIntent(s, { type: 'attack', attackerIndex: 1, targetIndex: 0 });

  const kidBuuAfter = s.players.p1.actives[0]!;
  expect(kidBuuAfter.counters['pure_evil']).toBeUndefined();
  expect(kidBuuAfter.maxHp).toBe(9000);
});

test('Kid Buu DOES gain Pure Evil stacks when it scores the KO itself', () => {
  const kidBuu = mkFighter('kid_buu');
  const victim = mkFighter('pui_pui', { maxHp: 1000, currentHp: 1000 });

  let s = baseState([kidBuu, null], [victim, null]);
  s = applyIntent(s, { type: 'attack', attackerIndex: 0, targetIndex: 0 });

  const kidBuuAfter = s.players.p1.actives[0]!;
  expect(kidBuuAfter.counters['pure_evil']).toBe(1);
  expect(kidBuuAfter.maxHp).toBe(9500);
});
