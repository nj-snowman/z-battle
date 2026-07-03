import { applyIntent } from '../engine';
import { getEffectiveStats } from '../buffs';
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

test('Assimilate gains a stack when Kid Buu KOs via its ultimate (planet_burst)', () => {
  const kidBuu = mkFighter('kid_buu', { equipment: ['assimilate'] });
  // Weak enemy actives that planet_burst's 2000 flat damage will KO.
  const victim1 = mkFighter('pui_pui', { maxHp: 1000, currentHp: 1000 });
  const victim2 = mkFighter('yakon', { maxHp: 1500, currentHp: 1500 });

  let s: GameState = {
    turnPlayer: 'p1', turnNumber: 5, phase: 'battle', firstPlayer: 'p1', field: null, discard: [],
    pendingPromotions: [], winner: null, log: [], firstDamageDone: false,
    players: {
      p1: mkPlayer([kidBuu, null]),
      p2: mkPlayer([victim1, victim2]),
    },
  };

  s = applyIntent(s, { type: 'ultimate', fighterIndex: 0 });

  const kidBuuAfter = s.players.p1.actives[0]!;
  expect(kidBuuAfter.counters['assimilate']).toBe(2); // one stack per enemy KO'd

  const stats = getEffectiveStats(kidBuuAfter, 'active', 0, 'p1', s);
  // Base 6500 ATK + Pure Evil (2 KOs * 500) + Assimilate (2 KOs * 500)
  expect(stats.atk).toBe(6500 + 2 * 500 + 2 * 500);
});
