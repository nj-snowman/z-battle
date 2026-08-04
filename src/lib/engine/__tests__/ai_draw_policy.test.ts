import { chooseDrawPile } from '../aiHeuristic';
import { chooseMove } from '../ai';
import { makeFighterInstance } from '../setup';
import { getCard } from '../cards';
import { GameState, PlayerState, FighterInstance } from '../types';
import type { Difficulty } from '../aiTypes';

// The draw-phase rule: items by default, because the hero pile is shallow and surplus
// heroes rot in hand. Take a hero only when the board would otherwise stop growing, or
// when a 6-star is stranded above a hole in the curve.

function makeEmptyPlayer(deckId: string): PlayerState {
  return {
    deck: deckId,
    kiMax: 8,
    kiCurrent: 8,
    koScoredAgainst: 0,
    hand: [],
    piles: { hero: ['goten', 'pan', 'shu'], item: ['masenko', 'prank_kit'] },
    actives: [null, null],
    bench: [null, null],
    turnNumber: 5,
    friendlySaiyanKoedThisGame: false,
  };
}

function makeState(overrides?: Partial<GameState>): GameState {
  const base: GameState = {
    phase: 'draw',
    turnPlayer: 'p1',
    turnNumber: 10,
    firstPlayer: 'p1',
    field: null,
    discard: [],
    players: { p1: makeEmptyPlayer('rascals'), p2: makeEmptyPlayer('saiyan') },
    winner: null,
    log: [],
    firstDamageDone: true,
    pendingPromotions: [],
    lastKoTurn: 10,
  };
  return { ...base, ...overrides };
}

const fighter = (cardId: string): FighterInstance =>
  ({ ...makeFighterInstance(cardId), summoningSick: false });

const pileOf = (s: GameState) => {
  const m = chooseDrawPile(s, 'p1');
  return m && m.type === 'draw' ? m.pile : null;
};

// Sanity-check the Ki costs these cases lean on, so a card rebalance can't quietly
// invalidate the scenarios below.
describe('star costs the policy is reasoned against', () => {
  it('are what the tests assume', () => {
    expect(getCard('gotenks').kiCost).toBe(6);   // 6-star
    expect(getCard('kid_goku').kiCost).toBe(5);  // 5-star
    expect(getCard('goten').kiCost).toBe(4);     // 4-star
    expect(getCard('kid_gohan').kiCost).toBe(3); // 3-star
    expect(getCard('pan').kiCost).toBe(2);
    expect(getCard('shu').kiCost).toBe(1);
  });
});

// Every "takes an item" case needs at least 4 bodies between hand and board, otherwise
// the board-capacity clause fires first and asks for a hero regardless.
describe('Draw policy — items are the default', () => {
  it('takes an item when the hand can already improve the board', () => {
    const s = makeState();
    s.players.p1.actives[0] = fighter('pan');       // 2-star deployed
    s.players.p1.actives[1] = fighter('shu');
    s.players.p1.bench[0] = fighter('mai');
    s.players.p1.hand = ['kid_goku', 'masenko'];    // 5-star waiting — no need for more
    expect(pileOf(s)).toBe('item');
  });

  it('takes an item once the board is stocked, even with heroes still in hand', () => {
    const s = makeState();
    s.players.p1.actives[0] = fighter('pan');
    s.players.p1.actives[1] = fighter('shu');
    s.players.p1.hand = ['kid_goku', 'goten'];      // 4 bodies total
    expect(pileOf(s)).toBe('item');
  });
});

describe('Draw policy — keep feeding the board while there are slots', () => {
  it('takes a hero on an empty board even holding one to deploy', () => {
    // One hero in hand, nothing out: three slots would still be empty after playing it.
    const s = makeState();
    s.players.p1.hand = ['goten', 'masenko'];
    expect(pileOf(s)).toBe('hero');
  });

  it('keeps taking heroes up to four bodies, then defers to the curve rules', () => {
    const s = makeState();
    s.players.p1.actives[0] = fighter('pan');   // 2-star out
    s.players.p1.hand = ['kid_goku'];           // 5-star upgrade waiting, but 2 bodies
    expect(pileOf(s)).toBe('hero');

    s.players.p1.actives[1] = fighter('shu');   // 3 bodies
    expect(pileOf(s)).toBe('hero');

    // 4 bodies — capacity is satisfied, so the "is there an upgrade in hand?" rule takes
    // over, and there is one (5-star vs a 2-star board).
    s.players.p1.bench[0] = fighter('mai');
    expect(pileOf(s)).toBe('item');
  });

  it('still takes heroes at four bodies when none of them improves the board', () => {
    const s = makeState();
    s.players.p1.actives[0] = fighter('kid_goku'); // strong 5-star already out
    s.players.p1.actives[1] = fighter('pan');
    s.players.p1.bench[0] = fighter('mai');
    s.players.p1.hand = ['shu'];                   // 4 bodies, but nothing above a 5-star
    expect(pileOf(s)).toBe('hero');
  });

  it('overrides the 6-star "not desperate" rule while the board is thin', () => {
    // A lone Gotenks would otherwise say "you're covered, take items" with 3 slots empty.
    const s = makeState();
    s.players.p1.actives[0] = fighter('gotenks');
    s.players.p1.hand = ['kid_goku'];
    expect(pileOf(s)).toBe('hero');
  });

  it('counts heroes in hand as bodies, and ignores items in the count', () => {
    const s = makeState();
    s.players.p1.actives[0] = fighter('gotenks');
    // 3 heroes in hand + Gotenks deployed = 4 bodies. The item alongside them doesn't count.
    s.players.p1.hand = ['kid_goku', 'goten', 'pan', 'masenko'];
    expect(pileOf(s)).toBe('item');

    // Drop one hero and it's 3 bodies again, so the board still wants filling.
    s.players.p1.hand = ['kid_goku', 'goten', 'masenko'];
    expect(pileOf(s)).toBe('hero');
  });
});

describe('Draw policy — hero when the board would stall', () => {
  it("draws a hero when a 4-star is the best on field and the hand has nothing above it", () => {
    // The stated case: 4-star in play, no 5 or 6 in hand -> don't stunt the field.
    const s = makeState();
    s.players.p1.actives[0] = fighter('goten');     // 4-star
    s.players.p1.hand = ['kid_gohan', 'masenko'];   // only a 3-star
    expect(pileOf(s)).toBe('hero');
  });

  it('draws a hero when the hand exactly matches the board (no upgrade available)', () => {
    const s = makeState();
    s.players.p1.actives[0] = fighter('goten');  // 4-star
    s.players.p1.hand = ['goten'];               // another 4-star is not growth
    expect(pileOf(s)).toBe('hero');
  });

  it('counts the bench as in play', () => {
    const s = makeState();
    s.players.p1.actives[0] = fighter('shu');
    s.players.p1.bench[0] = fighter('kid_goku'); // 5-star benched is still deployed
    s.players.p1.hand = ['goten'];               // 4-star can't improve on it
    expect(pileOf(s)).toBe('hero');
  });
});

// These isolate the curve rules, so each keeps 4+ bodies on hand/board — otherwise the
// board-capacity clause answers first and the branch under test never runs.
describe('Draw policy — a 6-star means you are not desperate', () => {
  it('takes an item with a 6-star on the field and a healthy curve under it', () => {
    const s = makeState();
    s.players.p1.actives[0] = fighter('gotenks');  // 6-star
    s.players.p1.actives[1] = fighter('shu');
    s.players.p1.bench[0] = fighter('pan');
    s.players.p1.hand = ['kid_goku'];              // 5-star bridges fine
    expect(pileOf(s)).toBe('item');
  });

  it('takes an item with a 6-star in hand and a 4-star bridging', () => {
    const s = makeState();
    s.players.p1.actives[0] = fighter('goten');    // 4-star
    s.players.p1.actives[1] = fighter('shu');
    s.players.p1.bench[0] = fighter('pan');
    s.players.p1.hand = ['gotenks'];               // 6-star in hand
    expect(pileOf(s)).toBe('item');
  });

  it('draws a hero when a 6-star sits above a hole — a 3 and a 6 with no 4 or 5', () => {
    // The stated risk case. Board is otherwise stocked, so only the gap can trigger this.
    const s = makeState();
    s.players.p1.actives[0] = fighter('kid_gohan'); // 3-star
    s.players.p1.actives[1] = fighter('pan');       // 2-star
    s.players.p1.bench[0] = fighter('shu');         // 1-star
    s.players.p1.hand = ['gotenks'];                // 6-star, nothing in the 4-5 band
    expect(pileOf(s)).toBe('hero');
  });

  it('stops wanting a hero once the gap is bridged', () => {
    const s = makeState();
    s.players.p1.actives[0] = fighter('kid_gohan'); // 3-star
    s.players.p1.actives[1] = fighter('goten');     // 4-star fills the hole
    s.players.p1.bench[0] = fighter('shu');
    s.players.p1.hand = ['gotenks'];
    expect(pileOf(s)).toBe('item');
  });
});

describe('Draw policy — safety and availability', () => {
  it('always takes a hero when an Active slot is empty and the hand has none', () => {
    const s = makeState();
    s.players.p1.actives[0] = fighter('gotenks'); // even with a 6-star out
    s.players.p1.actives[1] = null;
    s.players.p1.hand = ['masenko'];              // no hero to refill with
    expect(pileOf(s)).toBe('hero');
  });

  it('falls back to whichever pile still has cards', () => {
    // Stocked board + an upgrade in hand: the policy wants an item, but there are none.
    const s = makeState();
    s.players.p1.actives[0] = fighter('pan');
    s.players.p1.actives[1] = fighter('shu');
    s.players.p1.bench[0] = fighter('mai');
    s.players.p1.hand = ['kid_goku'];
    s.players.p1.piles = { hero: ['goten'], item: [] };
    expect(pileOf(s)).toBe('hero');

    // Thin board: the policy wants a hero, but the hero pile is spent.
    const s2 = makeState();
    s2.players.p1.actives[0] = fighter('goten');
    s2.players.p1.hand = ['shu'];
    s2.players.p1.piles = { hero: [], item: ['masenko'] };
    expect(pileOf(s2)).toBe('item');
  });

  it('returns null when both piles are empty', () => {
    const s = makeState();
    s.players.p1.piles = { hero: [], item: [] };
    expect(chooseDrawPile(s, 'p1')).toBeNull();
  });
});

describe('Draw policy is applied at every difficulty', () => {
  it('medium, hard and strongest all follow it', () => {
    for (const difficulty of ['medium', 'hard', 'strongest'] as Difficulty[]) {
      const s = makeState();
      s.players.p1.actives[0] = fighter('pan');
      s.players.p1.actives[1] = fighter('shu');
      s.players.p1.bench[0] = fighter('mai');
      s.players.p1.hand = ['kid_goku', 'masenko']; // stocked board + upgrade -> item
      const m = chooseMove(s, 'p1', difficulty);
      expect([difficulty, m]).toEqual([difficulty, { type: 'draw', pile: 'item' }]);
    }
  });
});
