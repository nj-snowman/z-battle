import { applyIntent } from '../engine';
import { legalMoves } from '../legalMoves';
import type { GameState, PlayerState, FighterInstance } from '../types';

function mkFighter(cardId: string): FighterInstance {
  return {
    cardId, maxHp: 5000, currentHp: 5000, equipment: [], summoningSick: false,
    hasAttackedThisTurn: false, oncePerGameUsed: {}, counters: {}, statuses: [],
  };
}

function mkPlayer(actives: (FighterInstance | null)[], hand: string[]): PlayerState {
  return {
    userId: 'u', deck: 'saiyan', kiMax: 8, kiCurrent: 8, koScoredAgainst: 0,
    hand, piles: { hero: [], item: [] },
    actives, bench: [null, null],
    turnNumber: 3, friendlySaiyanKoedThisGame: false,
    activeBuuCounts: [0, 0], benchBuuCounts: [0, 0],
  };
}

function baseState(p1Actives: (FighterInstance | null)[], p1Hand: string[]): GameState {
  return {
    turnPlayer: 'p1', turnNumber: 3, phase: 'main1', firstPlayer: 'p1', field: null, discard: [],
    pendingPromotions: [], winner: null, log: [], firstDamageDone: true,
    players: { p1: mkPlayer(p1Actives, p1Hand), p2: mkPlayer([mkFighter('vegeta'), mkFighter('vegeta')], []) },
  };
}

test('cannot bench a hero while an active slot is empty', () => {
  const s = baseState([mkFighter('vegeta'), null], ['goku']);

  const moves = legalMoves(s, 'p1').filter(m => m.type === 'play_hero') as Array<{ slot: string; index: number }>;
  expect(moves.some(m => m.slot === 'bench')).toBe(false);
  expect(moves.some(m => m.slot === 'active')).toBe(true);

  expect(() => applyIntent(s, { type: 'play_hero', cardId: 'goku', slot: 'bench', index: 0 }))
    .toThrow('Both active slots must be filled before benching a hero');
});

test('can bench a hero once both active slots are filled', () => {
  const s = baseState([mkFighter('vegeta'), mkFighter('goku')], ['pui_pui']);

  const moves = legalMoves(s, 'p1').filter(m => m.type === 'play_hero') as Array<{ slot: string; index: number }>;
  expect(moves.some(m => m.slot === 'bench')).toBe(true);

  const after = applyIntent(s, { type: 'play_hero', cardId: 'pui_pui', slot: 'bench', index: 0 });
  expect(after.players.p1.bench[0]?.cardId).toBe('pui_pui');
});
