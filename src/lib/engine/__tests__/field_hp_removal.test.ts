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

function baseState(p1Actives: (FighterInstance | null)[], p1Hand: string[], field: string | null): GameState {
  return {
    turnPlayer: 'p1', turnNumber: 5, phase: 'main1', firstPlayer: 'p1', field, discard: [],
    pendingPromotions: [], winner: null, log: [], firstAttackDone: false,
    players: { p1: mkPlayer(p1Actives, p1Hand), p2: mkPlayer([null, null]) },
  };
}

test("replacing a field removes its HP bonus instead of leaving it baked in", () => {
  const puiPui = mkFighter('pui_pui'); // majin, base maxHp 2500 per cards.json — using 3000 here for a clean baseline
  let s = baseState([puiPui, null], ['sacred_world_of_the_kai'], 'babidis_spaceship');

  // Simulate Babidi's Spaceship already having granted its +1000 HP to Pui Pui.
  s.players.p1.actives[0] = mkFighter('pui_pui', { maxHp: 4000, currentHp: 4000 });

  s = applyIntent(s, { type: 'play_field', cardId: 'sacred_world_of_the_kai' });

  const puiPuiAfter = s.players.p1.actives[0]!;
  expect(s.field).toBe('sacred_world_of_the_kai');
  expect(puiPuiAfter.maxHp).toBe(3000); // Spaceship's +1000 HP removed, Sacred World grants no HP
  expect(puiPuiAfter.currentHp).toBe(3000);
});

test('field HP bonus removal never drops currentHp below 1', () => {
  let s = baseState([null, null], ['sacred_world_of_the_kai'], 'babidis_spaceship');
  // Fighter took heavy damage while under the +1000 HP field buff.
  s.players.p1.actives[0] = mkFighter('pui_pui', { maxHp: 4000, currentHp: 300 });

  s = applyIntent(s, { type: 'play_field', cardId: 'sacred_world_of_the_kai' });

  const after = s.players.p1.actives[0]!;
  expect(after.maxHp).toBe(3000);
  expect(after.currentHp).toBe(1); // floored, not -700
});
