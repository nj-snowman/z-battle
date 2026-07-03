import { chooseMove, chooseAiPromotion } from '../ai';
import { chooseMoveSearch, choosePromotion } from '../aiSearch';
import { legalMoves } from '../legalMoves';
import { makeFighterInstance } from '../setup';
import { DIFFICULTY_PRESETS, Difficulty } from '../aiTypes';
import { GameState, PlayerState, FighterInstance } from '../types';

function makeEmptyPlayer(deckId: string): PlayerState {
  return {
    deck: deckId,
    kiMax: 8,
    kiCurrent: 8,
    koScoredAgainst: 0,
    hand: [],
    piles: { hero: [], item: [] },
    actives: [null, null],
    bench: [null, null],
    turnNumber: 5,
    friendlySaiyanKoedThisGame: false,
    activeBuuCounts: [0, 0],
    benchBuuCounts: [0, 0],
  };
}

function makeState(overrides?: Partial<GameState>): GameState {
  const base: GameState = {
    phase: 'battle',
    turnPlayer: 'p1',
    turnNumber: 10,
    firstPlayer: 'p1',
    field: null,
    discard: [],
    players: {
      p1: makeEmptyPlayer('human'),
      p2: makeEmptyPlayer('human'),
    },
    winner: null,
    log: [],
    firstAttackDone: true,
    pendingPromotions: [],
  };
  return { ...base, ...overrides };
}

function fighter(cardId: string, overrides?: Partial<FighterInstance>): FighterInstance {
  return { ...makeFighterInstance(cardId), summoningSick: false, ...overrides };
}

const HARD_DIFFICULTIES: Difficulty[] = ['hard', 'strongest'];

describe('chooseMoveSearch — lethal detection', () => {
  it('takes a guaranteed lethal plain attack when available', () => {
    const state = makeState({
      phase: 'battle',
      players: {
        p1: {
          ...makeEmptyPlayer('human'),
          actives: [fighter('earthling_fighter'), null], // atk 2000
        },
        p2: {
          ...makeEmptyPlayer('human'),
          actives: [fighter('martial_artist', { currentHp: 500 }), null], // def 500 -> dmg 1500 >= 500
        },
      },
    });

    for (const difficulty of HARD_DIFFICULTIES) {
      const move = chooseMove(state, 'p1', difficulty);
      expect(move).toEqual({ type: 'attack', attackerIndex: 0, targetIndex: 0 });
    }
  });

  it('uses Kaioken when only the boosted attack is lethal', () => {
    const state = makeState({
      phase: 'battle',
      players: {
        p1: {
          ...makeEmptyPlayer('human'),
          kiCurrent: 8,
          actives: [fighter('goku'), null], // atk 7000, kaioken +3000
        },
        p2: {
          ...makeEmptyPlayer('human'),
          // def 1500 -> base dmg 5500 (not lethal at 7000 hp), kaioken dmg 8500 (lethal)
          actives: [fighter('young_trainee', { maxHp: 7000, currentHp: 7000 }), null],
        },
      },
    });

    for (const difficulty of HARD_DIFFICULTIES) {
      const move = chooseMove(state, 'p1', difficulty);
      expect(move).toEqual({ type: 'attack', attackerIndex: 0, targetIndex: 0, useKaioken: true });
    }
  });
});

describe('chooseMoveSearch — multi-ply lookahead', () => {
  it('heals now to survive a lethal counter-attack next turn, even above the heuristic heal thresholds', () => {
    // p1's active is at 70% HP — above both of the heuristic's heal thresholds (30%/60%), so
    // the shallow heuristic chain never considers healing here. But if left unhealed, the
    // opponent's active can one-shot it next turn (exact lethal: atk 7000 vs def 0 = 7000 dmg
    // against 7000 current HP), which loses the game outright since p1 has no bench.
    const state = makeState({
      phase: 'main1',
      turnPlayer: 'p1',
      players: {
        p1: {
          ...makeEmptyPlayer('human'),
          hand: ['senzu_bean'],
          actives: [fighter('saiyan_brawler', { maxHp: 10000, currentHp: 7000 }), null], // def 0
        },
        p2: {
          ...makeEmptyPlayer('human'),
          actives: [fighter('broly'), null], // atk 7000
        },
      },
    });

    for (const difficulty of HARD_DIFFICULTIES) {
      const move = chooseMove(state, 'p1', difficulty);
      expect(move).toEqual({ type: 'play_item', cardId: 'senzu_bean', targetSide: 'active', targetIndex: 0 });
    }

    // Contrast: the shallow heuristic (Medium) does NOT catch this — proving the search adds
    // real value rather than just replicating existing behavior.
    const medium = chooseMove(state, 'p1', 'medium');
    expect(medium).not.toEqual({ type: 'play_item', cardId: 'senzu_bean', targetSide: 'active', targetIndex: 0 });
  });
});

describe('choosePromotion', () => {
  it('promotes the stronger bench fighter, unlike the "first available" Medium behavior', () => {
    const state = makeState({
      phase: 'main1',
      turnPlayer: 'p1',
      pendingPromotions: [{ side: 'p1', activeIndex: 0, friezaWrathPending: false }],
      players: {
        p1: {
          ...makeEmptyPlayer('human'),
          actives: [null, null],
          // weak fighter first, strong fighter second — Medium's "first available" would pick the weak one
          bench: [
            fighter('martial_artist', { currentHp: 100 }),
            fighter('goku'),
          ],
        },
        p2: {
          ...makeEmptyPlayer('human'),
          actives: [fighter('earthling_fighter'), null],
        },
      },
    });

    expect(choosePromotion(state, 'p1')).toBe(1);
    expect(chooseAiPromotion(state, 'p1', 'hard')).toBe(1);
    expect(chooseAiPromotion(state, 'p1', 'strongest')).toBe(1);
    expect(chooseAiPromotion(state, 'p1', 'medium')).toBe(0);
  });
});

describe('chooseMoveSearch — safety invariants', () => {
  const genericStates = [
    makeState({
      phase: 'main1',
      players: {
        p1: {
          ...makeEmptyPlayer('human'),
          hand: ['senzu_bean', 'power_pole', 'young_trainee'],
          actives: [fighter('earthling_fighter', { currentHp: 1500 }), fighter('martial_artist')],
          bench: [fighter('young_trainee'), null],
        },
        p2: {
          ...makeEmptyPlayer('human'),
          hand: ['senzu_bean'],
          actives: [fighter('goku', { currentHp: 4000 }), null],
          bench: [fighter('young_trainee'), null],
        },
      },
    }),
    makeState({
      phase: 'battle',
      players: {
        p1: {
          ...makeEmptyPlayer('human'),
          actives: [fighter('earthling_fighter'), fighter('martial_artist')],
        },
        p2: {
          ...makeEmptyPlayer('human'),
          actives: [fighter('young_trainee', { currentHp: 2500 }), fighter('goku', { currentHp: 3000 })],
        },
      },
    }),
  ];

  it('never voluntarily sacrifices a fighter', () => {
    for (const state of genericStates) {
      for (const difficulty of ['medium', 'hard', 'strongest'] as Difficulty[]) {
        const move = chooseMove(state, 'p1', difficulty);
        expect(move?.type).not.toBe('sacrifice');
      }
    }
  });

  it('always returns a move that is actually legal', () => {
    for (const state of genericStates) {
      for (const difficulty of ['medium', 'hard', 'strongest'] as Difficulty[]) {
        const move = chooseMove(state, 'p1', difficulty);
        const legal = legalMoves(state, 'p1');
        expect(legal).toContainEqual(move);
      }
    }
  });
});

describe('chooseMoveSearch — performance budget', () => {
  const busyState = makeState({
    phase: 'main1',
    players: {
      p1: {
        ...makeEmptyPlayer('human'),
        kiCurrent: 8,
        hand: ['senzu_bean', 'power_pole', 'earthling_fighter', 'martial_artist', 'young_trainee'],
        actives: [fighter('goku', { currentHp: 5000 }), fighter('earthling_fighter')],
        bench: [fighter('martial_artist'), fighter('young_trainee')],
      },
      p2: {
        ...makeEmptyPlayer('human'),
        kiCurrent: 8,
        hand: ['senzu_bean', 'power_pole', 'earthling_fighter'],
        actives: [fighter('broly', { currentHp: 6000 }), fighter('young_trainee')],
        bench: [fighter('martial_artist'), fighter('earthling_fighter')],
      },
    },
  });

  it('Medium resolves near-instantly', () => {
    const start = Date.now();
    chooseMove(busyState, 'p1', 'medium');
    expect(Date.now() - start).toBeLessThan(50);
  });

  it('Hard respects its time budget', () => {
    const start = Date.now();
    chooseMove(busyState, 'p1', 'hard');
    expect(Date.now() - start).toBeLessThan(DIFFICULTY_PRESETS.hard.timeBudgetMs * 3);
  });

  it('Strongest respects its time budget', () => {
    const start = Date.now();
    chooseMove(busyState, 'p1', 'strongest');
    expect(Date.now() - start).toBeLessThan(DIFFICULTY_PRESETS.strongest.timeBudgetMs * 3);
  });
});
