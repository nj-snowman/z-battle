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
    firstDamageDone: true,
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
          actives: [fighter('yajirobe'), null], // atk 2000
        },
        p2: {
          ...makeEmptyPlayer('human'),
          actives: [fighter('hercule', { currentHp: 500 }), null], // def 500 -> dmg 1500 >= 500
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
          actives: [fighter('videl', { maxHp: 7000, currentHp: 7000 }), null],
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
          actives: [fighter('saibaman', { maxHp: 9000, currentHp: 6500 }), null], // def 500 — Broly's 7000 ATK still deals exactly 6500, lethal
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
            fighter('hercule', { currentHp: 100 }),
            fighter('goku'),
          ],
        },
        p2: {
          ...makeEmptyPlayer('human'),
          actives: [fighter('yajirobe'), null],
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
          hand: ['senzu_bean', 'power_pole', 'videl'],
          actives: [fighter('yajirobe', { currentHp: 1500 }), fighter('hercule')],
          bench: [fighter('videl'), null],
        },
        p2: {
          ...makeEmptyPlayer('human'),
          hand: ['senzu_bean'],
          actives: [fighter('goku', { currentHp: 4000 }), null],
          bench: [fighter('videl'), null],
        },
      },
    }),
    makeState({
      phase: 'battle',
      players: {
        p1: {
          ...makeEmptyPlayer('human'),
          actives: [fighter('yajirobe'), fighter('hercule')],
        },
        p2: {
          ...makeEmptyPlayer('human'),
          actives: [fighter('videl', { currentHp: 2500 }), fighter('goku', { currentHp: 3000 })],
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
        hand: ['senzu_bean', 'power_pole', 'yajirobe', 'hercule', 'videl'],
        actives: [fighter('goku', { currentHp: 5000 }), fighter('yajirobe')],
        bench: [fighter('hercule'), fighter('videl')],
      },
      p2: {
        ...makeEmptyPlayer('human'),
        kiCurrent: 8,
        hand: ['senzu_bean', 'power_pole', 'yajirobe'],
        actives: [fighter('broly', { currentHp: 6000 }), fighter('videl')],
        bench: [fighter('hercule'), fighter('yajirobe')],
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

describe('chooseMoveSearch — attacks a non-lethal, evenly-matched target instead of passing', () => {
  // Regression for a self-play stall: the evaluate() "tempo" term (rewarding unused ready
  // attackers) used to be weighted heavily enough that any attack dealing less than ~50% of
  // the target's max HP scored worse than just advancing the phase — so two evenly-matched,
  // tanky fighters (e.g. a Namekian mirror) would never attack each other, stalling forever.
  it('attacks rather than advancing the phase when the only attack is a modest, non-lethal hit', () => {
    const state = makeState({
      phase: 'battle',
      players: {
        p1: {
          ...makeEmptyPlayer('human'),
          actives: [fighter('dragon_clan_namekian'), null], // atk 4000, def 2500, hp 6500
        },
        p2: {
          ...makeEmptyPlayer('human'),
          actives: [fighter('dragon_clan_namekian'), null], // dmg = 4000 - 2500 = 1500, far from lethal
        },
      },
    });

    for (const difficulty of HARD_DIFFICULTIES) {
      const move = chooseMove(state, 'p1', difficulty);
      expect(move).toEqual({ type: 'attack', attackerIndex: 0, targetIndex: 0 });
    }
  });
});
