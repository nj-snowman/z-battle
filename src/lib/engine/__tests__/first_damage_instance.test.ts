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
    userId: 'u', deck: 'saiyan', kiMax: 8, kiCurrent: 8, koScoredAgainst: 0,
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

test('an ultimate as the first instance of damage in the game is halved, not just the first attack', () => {
  // Cell's Solar Kamehameha deals a flat 5000 to all enemy actives.
  const cell = mkFighter('cell');
  const victim = mkFighter('pui_pui', { maxHp: 6000, currentHp: 6000 });
  let s = baseState([cell, null], [victim, null]);

  s = applyIntent(s, { type: 'ultimate', fighterIndex: 0 });

  // 5000 * 0.5 = 2500, already a multiple of 500 -> exactly half, not full damage.
  expect(s.players.p2.actives[0]?.currentHp).toBe(3500); // 6000 - 2500
});

test('the second instance of damage in the game is full, even if the first came from an item', () => {
  const attacker = mkFighter('vegeta'); // atk 7000, no field/def modifiers here
  const target1 = mkFighter('pui_pui', { maxHp: 9000, currentHp: 9000 });
  let s = baseState([attacker, null], [target1, null]);

  // First damage instance: a basic attack, still halved by the same rule.
  s = applyIntent(s, { type: 'attack', attackerIndex: 0, targetIndex: 0 });
  const afterFirst = s.players.p2.actives[0]!;
  expect(afterFirst.maxHp - afterFirst.currentHp).toBeGreaterThan(0);
  expect(afterFirst.currentHp).toBeGreaterThan(9000 - 7000); // less than full 7000 damage landed

  expect(s.firstDamageDone).toBe(true);
});
