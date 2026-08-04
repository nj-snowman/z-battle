import { applyIntent } from '../engine';
import { makeFighterInstance } from '../setup';
import { getEffectiveStats, heroPlayCost } from '../buffs';
import { legalMoves } from '../legalMoves';
import { getCard, DECKS } from '../cards';
import { GHOST_COUNTER } from '../combat';
import { GameState, PlayerState, FighterInstance, Intent } from '../types';

// Vignettes V-R1..V-R9 from z-battle-rascals-deck.md, plus the mechanics that spec
// describes in prose rather than as a numbered vignette.

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
      p1: makeEmptyPlayer('rascals'),
      p2: makeEmptyPlayer('saiyan'),
    },
    winner: null,
    log: [],
    firstDamageDone: true, // skip the once-per-game halving so damage maths reads plainly
    pendingPromotions: [],
    lastKoTurn: 10,
  };
  return { ...base, ...overrides };
}

function fighter(cardId: string, overrides?: Partial<FighterInstance>): FighterInstance {
  return { ...makeFighterInstance(cardId), summoningSick: false, ...overrides };
}

const statsOf = (s: GameState, side: 'p1' | 'p2', slot: 'active' | 'bench', i: number) =>
  getEffectiveStats(
    (slot === 'active' ? s.players[side].actives : s.players[side].bench)[i]!,
    slot, i, side, s
  );

// ---- Deck wiring -------------------------------------------------------------

describe('Rascals deck data', () => {
  it('is a selectable deck of 10 heroes / 8 items / 2 fields with Gotenks as its ultimate', () => {
    const deck = DECKS['rascals'];
    expect(deck).toBeDefined();
    expect(deck.ultimate).toBe('gotenks');
    expect(deck.heroes).toHaveLength(10);
    expect(deck.items.filter(id => getCard(id).cardType === 'item')).toHaveLength(8);
    expect(deck.items.filter(id => getCard(id).cardType === 'field')).toHaveLength(2);
    // Power Pole and Weighted Clothing are shared with the Human deck, not redefined
    expect(DECKS['human'].items).toContain('power_pole');
    expect(deck.items).toContain('power_pole');
  });

  it('every Rascals hero carries the new `rascal` type, and the three re-typed cards join them', () => {
    for (const id of DECKS['rascals'].heroes) {
      expect(getCard(id).types).toContain('rascal');
    }
    expect(getCard('dende').types).toEqual(['namekian', 'rascal']);
    expect(getCard('namekian_child').types).toEqual(['namekian', 'rascal']);
    expect(getCard('cell_jr').types).toEqual(['android', 'rascal']);
    // Re-typing Cell Jr. must not disturb Cell Swarm's family tag
    expect(getCard('cell_jr').family).toBe('cell');
  });

  it('the opening-hand rule is satisfiable — the deck has 1-Ki heroes', () => {
    const oneKi = DECKS['rascals'].heroes.filter(id => getCard(id).kiCost === 1);
    expect(oneKi).toEqual(['emperor_pilaf', 'mai', 'shu']);
  });
});

// ---- §2 Live stat-borrowing --------------------------------------------------

describe('V-R1 — stat borrowing, both Actives', () => {
  it('Goten and Kid Trunks both read 6,000 / 5,500 / 3,000', () => {
    const s = makeState();
    s.players.p1.actives[0] = fighter('goten');
    s.players.p1.actives[1] = fighter('kid_trunks');

    const goten = statsOf(s, 'p1', 'active', 0);
    const trunks = statsOf(s, 'p1', 'active', 1);

    expect(goten.hp).toBe(6000);
    expect(goten.atk).toBe(5500); // borrowed from Trunks
    expect(goten.def).toBe(3000); // his own
    expect(trunks.hp).toBe(6000);
    expect(trunks.atk).toBe(5500); // his own
    expect(trunks.def).toBe(3000); // borrowed from Goten
  });
});

describe('V-R2 — live borrowing through equipment', () => {
  it('an ATK equip on Trunks lifts both, and a DEF equip on Goten lifts both', () => {
    const s = makeState();
    s.players.p1.actives[0] = fighter('goten');
    s.players.p1.actives[1] = fighter('kid_trunks', { equipment: ['power_pole'] });

    expect(statsOf(s, 'p1', 'active', 1).atk).toBe(7000); // 5500 + 1500
    expect(statsOf(s, 'p1', 'active', 0).atk).toBe(7000); // Goten borrows the live value

    // Weighted Clothing: +1,500 DEF / -500 ATK, onto Goten
    s.players.p1.actives[0] = fighter('goten', { equipment: ['weighted_clothing'] });

    const goten = statsOf(s, 'p1', 'active', 0);
    const trunks = statsOf(s, 'p1', 'active', 1);
    expect(goten.def).toBe(4500);  // 3000 + 1500
    expect(trunks.def).toBe(4500); // borrows Goten's live DEF
    expect(goten.atk).toBe(6500);  // borrowed 7000, then his OWN -500 layers on top
    expect(trunks.atk).toBe(7000); // unaffected by Goten's gear
  });
});

describe('V-R3 — the pair splits', () => {
  it('benching Goten drops both back to printed values', () => {
    const s = makeState();
    s.players.p1.actives[0] = fighter('kid_trunks');
    s.players.p1.bench[0] = fighter('goten');

    expect(statsOf(s, 'p1', 'active', 0).def).toBe(2000); // Trunks, printed
    expect(statsOf(s, 'p1', 'bench', 0).atk).toBe(4500);  // Goten, printed
  });

  it('a KO\'d partner ends the borrow too', () => {
    const s = makeState();
    s.players.p1.actives[0] = fighter('goten');
    expect(statsOf(s, 'p1', 'active', 0).atk).toBe(4500);
  });
});

describe('V-R4 — the borrowed stat overrides field effects', () => {
  it('Goten ignores a Green ATK buff while borrowing from Purple Trunks', () => {
    const s = makeState({ field: 'king_kais_planet' }); // Green +1,000 ATK
    s.players.p1.actives[0] = fighter('goten');
    s.players.p1.actives[1] = fighter('kid_trunks');

    expect(statsOf(s, 'p1', 'active', 0).atk).toBe(5500); // not 6,500
    expect(statsOf(s, 'p1', 'active', 1).atk).toBe(5500); // Purple, unbuffed
  });

  it('and ignores a Green ATK debuff the same way', () => {
    const s = makeState({ field: 'babidis_spaceship' }); // Green -1,000 ATK
    s.players.p1.actives[0] = fighter('goten');
    s.players.p1.actives[1] = fighter('kid_trunks');

    expect(statsOf(s, 'p1', 'active', 0).atk).toBe(5500); // immune while borrowing
  });

  it('a field buff on the PARTNER does carry across — the borrow reads their live value', () => {
    // Capsule Corp Yard gives Green +1,000 DEF. Goten is Green, so his DEF rises and
    // Trunks, borrowing it, rises with him.
    const s = makeState({ field: 'capsule_corp_yard' });
    s.players.p1.actives[0] = fighter('goten');
    s.players.p1.actives[1] = fighter('kid_trunks');

    expect(statsOf(s, 'p1', 'active', 0).def).toBe(4000); // 3000 + 1000 field
    expect(statsOf(s, 'p1', 'active', 1).def).toBe(4000); // borrowed live
  });
});

// ---- §3 Board-state cost reduction -------------------------------------------

describe('V-R5 — Fusion discount', () => {
  const gotenks = () => getCard('gotenks');

  it('costs 4 with both kids out, 5 with one, 6 with neither', () => {
    const s = makeState({ phase: 'main1' });
    expect(heroPlayCost(gotenks(), 'p1', s)).toBe(6);

    s.players.p1.actives[0] = fighter('kid_trunks');
    expect(heroPlayCost(gotenks(), 'p1', s)).toBe(5);

    s.players.p1.bench[0] = fighter('goten'); // bench counts too
    expect(heroPlayCost(gotenks(), 'p1', s)).toBe(4);
  });

  it('only counts your own side', () => {
    const s = makeState({ phase: 'main1' });
    s.players.p2.actives[0] = fighter('goten');
    expect(heroPlayCost(gotenks(), 'p1', s)).toBe(6);
  });

  it('the discount is what actually gets spent, and unlocks the play at 4 Ki', () => {
    let s = makeState({ phase: 'main1' });
    s.players.p1.actives[0] = fighter('kid_trunks');
    s.players.p1.bench[0] = fighter('goten');
    s.players.p1.hand = ['gotenks'];
    s.players.p1.kiCurrent = 4; // one short of the printed 6, but enough after Fusion

    expect(legalMoves(s, 'p1').some(m => m.type === 'play_hero' && m.cardId === 'gotenks')).toBe(true);

    s = applyIntent(s, { type: 'play_hero', cardId: 'gotenks', slot: 'active', index: 1 });
    expect(s.players.p1.kiCurrent).toBe(0);
    expect(s.players.p1.actives[1]?.cardId).toBe('gotenks');
    // Not a fusion — the kids are still standing
    expect(s.players.p1.actives[0]?.cardId).toBe('kid_trunks');
    expect(s.players.p1.bench[0]?.cardId).toBe('goten');
  });
});

// ---- §4 Death replacement ----------------------------------------------------

describe('V-R6 — Hidden Power', () => {
  it('survives lethal at 1 HP with no score, then permanently gains +2,000 ATK', () => {
    let s = makeState();
    s.players.p1.actives[0] = fighter('kid_gohan', { currentHp: 1000 });
    // A 6,500 ATK attacker vs 1,500 DEF = 5,000 damage
    s.players.p2.actives[0] = fighter('broly');
    s.turnPlayer = 'p2';

    const before = s.players.p1.koScoredAgainst;
    s = applyIntent(s, { type: 'attack', attackerIndex: 0, targetIndex: 0 });

    const gohan = s.players.p1.actives[0];
    expect(gohan).not.toBeNull();
    expect(gohan!.currentHp).toBe(1);
    expect(s.players.p1.koScoredAgainst).toBe(before); // no score for the opponent
    expect(s.pendingPromotions).toHaveLength(0);       // no on-KO machinery ran
    expect(statsOf(s, 'p1', 'active', 0).atk).toBe(5500); // 3,500 + 2,000
  });

  it('is once per game — the next lethal hit KOs him normally', () => {
    let s = makeState();
    s.players.p1.actives[0] = fighter('kid_gohan', {
      currentHp: 1,
      oncePerGameUsed: { hidden_power: true },
      counters: { hidden_power: 1 },
    });
    s.players.p2.actives[0] = fighter('broly');
    s.turnPlayer = 'p2';

    s = applyIntent(s, { type: 'attack', attackerIndex: 0, targetIndex: 0 });

    expect(s.players.p1.actives[0]).toBeNull();
    expect(s.players.p1.koScoredAgainst).toBe(1);
  });

  it('intercepts flat item damage too, not just attacks', () => {
    let s = makeState({ phase: 'main1' });
    s.players.p1.actives[0] = fighter('kid_gohan');
    s.players.p2.actives[0] = fighter('kid_gohan', { currentHp: 500 });
    s.players.p1.hand = ['masenko'];

    s = applyIntent(s, { type: 'play_item', cardId: 'masenko', targetIndex: 0 });

    expect(s.players.p2.actives[0]?.currentHp).toBe(1);
    expect(s.players.p2.koScoredAgainst).toBe(0);
  });
});

// ---- Shu's Ninja Dog ---------------------------------------------------------

describe('Ninja Dog', () => {
  it('automatically shaves 1,000 off the first hit Shu takes, once per game', () => {
    let s = makeState();
    s.players.p1.actives[0] = fighter('shu'); // 2,000 HP / 1,500 DEF
    s.players.p2.actives[0] = fighter('nappa');
    s.turnPlayer = 'p2';

    const dmg = statsOf(s, 'p2', 'active', 0).atk - 1500;
    s = applyIntent(s, { type: 'attack', attackerIndex: 0, targetIndex: 0 });

    expect(s.players.p1.actives[0]?.currentHp).toBe(2000 - (dmg - 1000));
    expect(s.players.p1.actives[0]?.oncePerGameUsed['ninja_dog']).toBe(true);

    // Second hit lands in full
    const hpAfterFirst = s.players.p1.actives[0]!.currentHp;
    s = { ...s, players: { ...s.players, p2: { ...s.players.p2, kiCurrent: 8,
      actives: [{ ...s.players.p2.actives[0]!, hasAttackedThisTurn: false }, null] } } };
    s = applyIntent(s, { type: 'attack', attackerIndex: 0, targetIndex: 0 });
    const expected = Math.max(0, hpAfterFirst - dmg);
    expect(s.players.p1.actives[0]?.currentHp ?? 0).toBe(expected);
  });
});

// ---- Pan / Mai conditionals --------------------------------------------------

describe('Conditional ATK', () => {
  it('Pan gets +1,000 ATK only while she is the entire board', () => {
    const s = makeState();
    s.players.p1.actives[0] = fighter('pan');
    expect(statsOf(s, 'p1', 'active', 0).atk).toBe(3500); // 2,500 + 1,000

    s.players.p1.bench[0] = fighter('shu'); // a benched friend still breaks it
    expect(statsOf(s, 'p1', 'active', 0).atk).toBe(2500);
  });

  it('Mai gets +1,000 ATK only when the fighter she attacks is Basic tier', () => {
    let s = makeState();
    s.players.p1.actives[0] = fighter('mai');            // 1,500 ATK
    s.players.p2.actives[0] = fighter('saibaman');       // basic, 1,000 DEF
    s.players.p2.actives[1] = fighter('vegeta');         // high tier

    const saibamanDef = statsOf(s, 'p2', 'active', 0).def;
    const saibamanHp = s.players.p2.actives[0]!.currentHp;
    s = applyIntent(s, { type: 'attack', attackerIndex: 0, targetIndex: 0 });
    // Sidearm applies: (1,500 + 1,000) - DEF
    expect(saibamanHp - (s.players.p2.actives[0]?.currentHp ?? 0)).toBe(2500 - saibamanDef);
  });

  it('Mai gets no Sidearm bonus against a non-Basic fighter', () => {
    let s = makeState();
    s.players.p1.actives[0] = fighter('mai');
    s.players.p2.actives[0] = fighter('vegeta'); // high tier

    const def = statsOf(s, 'p2', 'active', 0).def;
    const hp = s.players.p2.actives[0]!.currentHp;
    s = applyIntent(s, { type: 'attack', attackerIndex: 0, targetIndex: 0 });
    // plain 1,500 ATK, floored at the engine's 500 minimum
    expect(hp - (s.players.p2.actives[0]?.currentHp ?? 0)).toBe(Math.max(1500 - def, 500));
  });
});

// ---- Kid Goku's Power Pole ---------------------------------------------------

describe("Kid Goku's Power Pole", () => {
  it('is offered as a legal move, so the AI can use it and not just a human', () => {
    const s = makeState();
    s.players.p1.actives[0] = fighter('kid_goku');
    s.players.p2.actives[0] = fighter('vegeta');

    const oneShots = legalMoves(s, 'p1').filter(
      m => m.type === 'attack' && m.attackerIndex === 0 && m.useOneShotAbility
    );
    expect(oneShots.length).toBeGreaterThan(0);
  });

  it('ignores the target DEF entirely, once per game', () => {
    let s = makeState();
    s.players.p1.actives[0] = fighter('kid_goku');   // 5,000 ATK
    s.players.p2.actives[0] = fighter('vegeta');

    const def = statsOf(s, 'p2', 'active', 0).def;
    expect(def).toBeGreaterThan(0); // the test is meaningless if the target has no DEF
    const hp = s.players.p2.actives[0]!.currentHp;

    s = applyIntent(s, { type: 'attack', attackerIndex: 0, targetIndex: 0, useOneShotAbility: true });

    expect(hp - s.players.p2.actives[0]!.currentHp).toBe(5000); // full ATK, no DEF subtracted
    expect(s.players.p1.actives[0]?.oncePerGameUsed['power_pole_strike']).toBe(true);

    // Spent — no longer on the menu
    s = { ...s, players: { ...s.players, p1: { ...s.players.p1, kiCurrent: 8,
      actives: [{ ...s.players.p1.actives[0]!, hasAttackedThisTurn: false }, null] } } };
    expect(legalMoves(s, 'p1').some(m => m.type === 'attack' && m.useOneShotAbility)).toBe(false);
  });

  it('is offered for the other one-shot heroes too (same engine path)', () => {
    for (const [cardId, key] of [
      ['krillin', 'destructo_disc'],
      ['future_trunks', 'burning_attack'],
      ['recoome', 'eraser_gun'],
    ] as const) {
      const s = makeState();
      s.players.p1.actives[0] = fighter(cardId);
      s.players.p2.actives[0] = fighter('vegeta');
      const offered = legalMoves(s, 'p1').some(m => m.type === 'attack' && m.useOneShotAbility);
      expect([cardId, offered]).toEqual([cardId, true]);
      expect(getCard(cardId).abilities.some(a => a.key === key)).toBe(true);
    }
  });
});

// ---- §5 Free-action ability --------------------------------------------------

describe('V-R7 — Uub free action', () => {
  it('heals to full without spending Ki or his attack, and can then still attack', () => {
    let s = makeState();
    s.players.p1.actives[0] = fighter('uub', { currentHp: 2000 });
    s.players.p2.actives[0] = fighter('nappa');
    const kiBefore = s.players.p1.kiCurrent;

    s = applyIntent(s, { type: 'ultimate', fighterIndex: 0 });

    expect(s.players.p1.actives[0]?.currentHp).toBe(7500);
    expect(s.players.p1.kiCurrent).toBe(kiBefore); // costs no Ki
    expect(s.players.p1.actives[0]?.hasAttackedThisTurn).toBe(false);
    expect(legalMoves(s, 'p1').some(m => m.type === 'attack' && m.attackerIndex === 0)).toBe(true);

    s = applyIntent(s, { type: 'attack', attackerIndex: 0, targetIndex: 0 });
    expect(s.players.p1.actives[0]?.hasAttackedThisTurn).toBe(true);
  });

  it('is still offered after Uub has already attacked, but only once per game', () => {
    let s = makeState();
    s.players.p1.actives[0] = fighter('uub', { currentHp: 2000, hasAttackedThisTurn: true });
    s.players.p2.actives[0] = fighter('nappa');

    expect(legalMoves(s, 'p1').some(m => m.type === 'ultimate' && m.fighterIndex === 0)).toBe(true);
    s = applyIntent(s, { type: 'ultimate', fighterIndex: 0 });
    expect(s.players.p1.actives[0]?.currentHp).toBe(7500);

    expect(legalMoves(s, 'p1').some(m => m.type === 'ultimate' && m.fighterIndex === 0)).toBe(false);
    expect(() => applyIntent(s, { type: 'ultimate', fighterIndex: 0 })).toThrow();
  });
});

// ---- §6 The ghost ------------------------------------------------------------

describe('V-R8 — the ghost', () => {
  function ghostSetup(oppFighters: number) {
    let s = makeState();
    s.players.p1.actives[0] = fighter('gotenks');
    s.players.p2.actives[0] = fighter('vegeta'); // 7,000 ATK
    if (oppFighters > 1) s.players.p2.actives[1] = fighter('nappa');
    if (oppFighters > 2) s.players.p2.bench[0] = fighter('raditz');
    if (oppFighters > 3) s.players.p2.bench[1] = fighter('saibaman');
    s = applyIntent(s, { type: 'ultimate', fighterIndex: 0, targetIndex: 0 });
    return s;
  }

  it('splits the attacker\'s ATK across all four of its controller\'s fighters, ignoring DEF', () => {
    let s = ghostSetup(4);
    expect(s.players.p2.actives[0]?.counters[GHOST_COUNTER]).toBe(1);
    expect(statsOf(s, 'p2', 'active', 0).atk).toBe(7000);

    const before = {
      vegeta: s.players.p2.actives[0]!.currentHp,
      nappa: s.players.p2.actives[1]!.currentHp,
      raditz: s.players.p2.bench[0]!.currentHp,
      saibaman: s.players.p2.bench[1]!.currentHp,
      gotenksHp: s.players.p1.actives[0]!.currentHp,
    };

    s = { ...s, turnPlayer: 'p2', phase: 'battle' };
    s = applyIntent(s, { type: 'attack', attackerIndex: 0, targetIndex: 0 });

    // Gotenks — the nominal target — takes nothing
    expect(s.players.p1.actives[0]?.currentHp).toBe(before.gotenksHp);
    // 7,000 / 4 = 1,750 each, DEF ignored
    expect(before.vegeta - s.players.p2.actives[0]!.currentHp).toBe(1750);
    expect(before.nappa - s.players.p2.actives[1]!.currentHp).toBe(1750);
    expect(before.raditz - s.players.p2.bench[0]!.currentHp).toBe(1750);
    expect(before.saibaman - s.players.p2.bench[1]!.currentHp).toBe(1750);
    // and the ghost is spent
    expect(s.players.p2.actives[0]?.counters[GHOST_COUNTER]).toBeUndefined();
  });

  it('hits a lone fighter for the attacker\'s whole ATK, and credits the KO to the Gotenks player', () => {
    let s = ghostSetup(1);
    s.players.p2.actives[0] = { ...s.players.p2.actives[0]!, currentHp: 5000 };

    s = { ...s, turnPlayer: 'p2', phase: 'battle' };
    s = applyIntent(s, { type: 'attack', attackerIndex: 0, targetIndex: 0 });

    // 7,000 into its own 5,000 HP — it kills itself
    expect(s.players.p2.actives[0]).toBeNull();
    expect(s.players.p2.koScoredAgainst).toBe(1); // scored against p2, i.e. FOR the Gotenks player
  });

  it('an ultimate does not discharge the ghost — only a basic attack does', () => {
    let s = ghostSetup(2);
    // Give the ghosted Vegeta an ultimate to fire instead
    s = { ...s, turnPlayer: 'p2', phase: 'battle' };
    const gotenksHp = s.players.p1.actives[0]!.currentHp;

    s = applyIntent(s, { type: 'ultimate', fighterIndex: 0, targetIndex: 0 });

    expect(s.players.p1.actives[0]!.currentHp).toBeLessThan(gotenksHp); // resolved normally
    expect(s.players.p2.actives[0]?.counters[GHOST_COUNTER]).toBe(1);   // still armed
  });

  it('only the tagged fighter can trigger it', () => {
    let s = ghostSetup(2);
    s = { ...s, turnPlayer: 'p2', phase: 'battle' };
    const nappaHpBefore = s.players.p2.actives[1]!.currentHp;
    const gotenksHp = s.players.p1.actives[0]!.currentHp;

    // Nappa (untagged) attacks — a completely ordinary swing
    s = applyIntent(s, { type: 'attack', attackerIndex: 1, targetIndex: 0 });

    expect(s.players.p1.actives[0]!.currentHp).toBeLessThan(gotenksHp);
    expect(s.players.p2.actives[1]!.currentHp).toBe(nappaHpBefore);
    expect(s.players.p2.actives[0]?.counters[GHOST_COUNTER]).toBe(1); // Vegeta still holds it
  });
});

describe('V-R9 — ghost persistence', () => {
  it('survives a retreat and re-arms when the fighter comes back', () => {
    let s = makeState();
    s.players.p1.actives[0] = fighter('gotenks');
    s.players.p2.actives[0] = fighter('vegeta');
    s.players.p2.actives[1] = fighter('nappa');
    s.players.p2.bench[0] = fighter('raditz');
    s = applyIntent(s, { type: 'ultimate', fighterIndex: 0, targetIndex: 0 });

    // p2 retreats the tagged Vegeta to the bench
    s = { ...s, turnPlayer: 'p2', phase: 'main1' };
    s = applyIntent(s, { type: 'retreat', activeIndex: 0, benchIndex: 0 });

    expect(s.players.p2.bench[0]?.cardId).toBe('vegeta');
    expect(s.players.p2.bench[0]?.counters[GHOST_COUNTER]).toBe(1); // rode along

    // and back out again
    s = { ...s, players: { ...s.players, p2: { ...s.players.p2, kiCurrent: 8,
      actives: [{ ...s.players.p2.actives[0]!, cannotRetreatThisTurn: undefined }, s.players.p2.actives[1]] } } };
    s = applyIntent(s, { type: 'retreat', activeIndex: 0, benchIndex: 0 });
    expect(s.players.p2.actives[0]?.cardId).toBe('vegeta');
    expect(s.players.p2.actives[0]?.counters[GHOST_COUNTER]).toBe(1);
  });

  it('is lost when the tagged fighter is KO\'d and does not transfer to the replacement', () => {
    let s = makeState();
    s.players.p1.actives[0] = fighter('gotenks');
    s.players.p2.actives[0] = fighter('saibaman', { currentHp: 500 });
    s.players.p2.actives[1] = fighter('nappa');
    s.players.p2.bench[0] = fighter('raditz');
    s = applyIntent(s, { type: 'ultimate', fighterIndex: 0, targetIndex: 0 });
    expect(s.players.p2.actives[0]?.counters[GHOST_COUNTER]).toBe(1);

    // Gotenks finishes the tagged Saibaman off with a normal swing next turn
    s = { ...s, phase: 'battle', turnPlayer: 'p1', players: { ...s.players, p1: { ...s.players.p1,
      actives: [{ ...s.players.p1.actives[0]!, hasAttackedThisTurn: false }, null] } } };
    s = applyIntent(s, { type: 'attack', attackerIndex: 0, targetIndex: 0 });
    s = applyIntent(s, { type: 'promote_from_bench', benchIndex: 0 });

    expect(s.players.p2.actives[0]?.cardId).toBe('raditz');
    expect(s.players.p2.actives[0]?.counters[GHOST_COUNTER]).toBeUndefined();
    expect(s.players.p2.bench.every(b => b === null)).toBe(true);
  });
});

// ---- Items -------------------------------------------------------------------

describe('Prank Kit', () => {
  it('drops an enemy Active 2,000 ATK and lasts through their whole next turn', () => {
    let s = makeState({ phase: 'main1' });
    s.players.p1.actives[0] = fighter('goten');
    s.players.p2.actives[0] = fighter('nappa');
    s.players.p1.hand = ['prank_kit'];

    const base = statsOf(s, 'p2', 'active', 0).atk;
    s = applyIntent(s, { type: 'play_item', cardId: 'prank_kit', targetIndex: 0 });
    expect(statsOf(s, 'p2', 'active', 0).atk).toBe(base - 2000);

    // Hand over to p2 — the debuff must survive INTO their turn, not be swept at its start
    s = applyIntent(s, { type: 'end_turn' });
    expect(s.turnPlayer).toBe('p2');
    expect(statsOf(s, 'p2', 'active', 0).atk).toBe(base - 2000);

    // ...and lapse once that turn ends
    s = applyIntent(s, { type: 'end_turn' });
    expect(statsOf(s, 'p2', 'active', 0).atk).toBe(base);
  });

  it('never pushes ATK below 0', () => {
    const s = makeState();
    s.players.p2.actives[0] = fighter('emperor_pilaf', { // 1,000 ATK
      statuses: [{ key: 'atk_debuff', until: 'end_of_their_next_turn', value: -2000 }],
    });
    expect(statsOf(s, 'p2', 'active', 0).atk).toBe(0);
  });
});

describe('Fusion Dance Practice', () => {
  it('pulls the chosen kid out of the Hero pile into hand', () => {
    let s = makeState({ phase: 'main1' });
    s.players.p1.actives[0] = fighter('shu');
    s.players.p1.hand = ['fusion_dance_practice'];
    s.players.p1.piles = { hero: ['pan', 'kid_trunks', 'goten', 'uub'], item: [] };

    const moves = legalMoves(s, 'p1').filter(
      m => m.type === 'play_item' && m.cardId === 'fusion_dance_practice'
    ) as Extract<Intent, { type: 'play_item' }>[];
    expect(moves.map(m => m.tutorCardId).sort()).toEqual(['goten', 'kid_trunks']);

    s = applyIntent(s, { type: 'play_item', cardId: 'fusion_dance_practice', tutorCardId: 'goten' });

    expect(s.players.p1.hand).toContain('goten');
    expect(s.players.p1.piles.hero).toEqual(['pan', 'kid_trunks', 'uub']);
    expect(s.discard.some(e => e.cardId === 'fusion_dance_practice')).toBe(true);
  });

  it('is not offered when neither kid is left in the pile', () => {
    const s = makeState({ phase: 'main1' });
    s.players.p1.actives[0] = fighter('shu');
    s.players.p1.hand = ['fusion_dance_practice'];
    s.players.p1.piles = { hero: ['pan', 'uub'], item: [] };

    expect(legalMoves(s, 'p1').some(
      m => m.type === 'play_item' && m.cardId === 'fusion_dance_practice'
    )).toBe(false);
  });
});

describe('Pilaf Machine', () => {
  it('grants +2,000 ATK and +3,000 HP on attach', () => {
    let s = makeState({ phase: 'main1' });
    s.players.p1.actives[0] = fighter('emperor_pilaf');
    s.players.p1.hand = ['pilaf_machine'];

    s = applyIntent(s, { type: 'play_item', cardId: 'pilaf_machine', targetSide: 'active', targetIndex: 0 });

    expect(s.players.p1.actives[0]?.maxHp).toBe(5000);
    expect(s.players.p1.actives[0]?.currentHp).toBe(5000);
    expect(statsOf(s, 'p1', 'active', 0).atk).toBe(3000);
  });
});

// ---- Fields ------------------------------------------------------------------

describe('Rascals fields', () => {
  it('Capsule Corp Yard gives Green fighters +1,000 DEF', () => {
    const s = makeState({ field: 'capsule_corp_yard' });
    s.players.p1.actives[0] = fighter('pan');       // Green
    s.players.p1.actives[1] = fighter('kid_gohan'); // Yellow
    expect(statsOf(s, 'p1', 'active', 0).def).toBe(2000); // 1000 + 1000
    expect(statsOf(s, 'p1', 'active', 1).def).toBe(1500); // untouched
  });

  it("Pilaf's Castle hits every Yellow fighter for -1,000 ATK / -1,000 DEF, both sides", () => {
    const s = makeState({ field: 'pilafs_castle' });
    s.players.p1.actives[0] = fighter('kid_gohan'); // Yellow 4,500 / 3,500 / 1,500
    s.players.p2.actives[0] = fighter('shu');       // Yellow 2,000 / 1,500 / 1,500

    const gohan = statsOf(s, 'p1', 'active', 0);
    expect(gohan.hp).toBe(4500);
    expect(gohan.atk).toBe(2500);
    expect(gohan.def).toBe(500);

    expect(statsOf(s, 'p2', 'active', 0).atk).toBe(500); // it hurts Rascals too
  });
});
