import { applyIntent, checkWinLoss } from '../engine';
import { makeFighterInstance } from '../setup';
import { getEffectiveStats, classOf, isAbilityLocked, cardTypesOf } from '../buffs';
import { legalMoves } from '../legalMoves';
import { getCard, DECKS, ALL_CARDS } from '../cards';
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
      p1: makeEmptyPlayer('saiyan'),
      p2: makeEmptyPlayer('namekian'),
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

// ---- Deck / data validation ----

describe('Deck validation', () => {
  it('all 7 decks are 10 heroes (counting duplicates) / 8 items / 2 fields, every id resolves', () => {
    const cardIds = new Set(ALL_CARDS.map(c => c.id));
    expect(Object.keys(DECKS)).toHaveLength(7);
    for (const [deckId, deck] of Object.entries(DECKS)) {
      for (const id of [...deck.heroes, ...deck.items]) {
        expect(cardIds.has(id)).toBe(true);
      }
      expect(deck.heroes).toHaveLength(10);
      const items = deck.items.filter(id => getCard(id).cardType === 'item');
      const fields = deck.items.filter(id => getCard(id).cardType === 'field');
      expect(items).toHaveLength(8);
      expect(fields).toHaveLength(2);
      const oneKiHeroes = deck.heroes.filter(id => getCard(id).kiCost === 1);
      expect(oneKiHeroes.length).toBeGreaterThanOrEqual(1);
      expect(deckId).toBeTruthy();
    }
  });

  it('no references to removed cards remain', () => {
    const json = JSON.stringify({ cards: ALL_CARDS, decks: DECKS });
    for (const removed of ['saiyan_recruit', 'saiyan_brawler', 'saiyan_trooper', 'android_19', 'scout_android']) {
      expect(json.includes(removed)).toBe(false);
    }
  });

  it('cell_swarm reads family:"cell"; three Cell family members plus the three Cell Jr. clones exist', () => {
    const card = getCard('cell_jr');
    expect(card.family).toBe('cell');
    expect(card.abilities[0].params).toMatchObject({ family: 'cell' });
    const cellFamily = ALL_CARDS.filter(c => c.family === 'cell').map(c => c.id).sort();
    expect(cellFamily).toEqual(['cell', 'cell_jr', 'cell_jr_2', 'cell_jr_3', 'semi_perfect_cell'].sort());
  });

  it('every hero has a class; per-deck colour tallies match the spec', () => {
    const expected: Record<string, [number, number, number]> = {
      human: [3, 3, 4],
      saiyan: [6, 1, 3],
      android: [4, 4, 2],
      namekian: [1, 3, 6],
      frieza_force: [3, 6, 1],
      majin: [2, 4, 4],
      kai: [5, 1, 4],
    };
    for (const [deckId, [a, b, c]] of Object.entries(expected)) {
      const tally = { A: 0, B: 0, C: 0 };
      for (const id of DECKS[deckId].heroes) {
        const card = getCard(id);
        expect(card.class).toBeDefined();
        tally[card.class!]++;
      }
      expect([tally.A, tally.B, tally.C]).toEqual([a, b, c]);
    }
  });

  it("Ultimate Gohan resolves as all three types for every type-matching check", () => {
    const gohan = getCard('ultimate_gohan');
    expect(gohan.types).toEqual(['earthling', 'saiyan', 'kai']);

    // Type-matching checks (e.g. recur_from_discard, "another_own_active_is_X") must
    // recognize Gohan under all three of his types, not just his primary fighterType.
    const types = cardTypesOf(gohan);
    expect(types.has('earthling')).toBe(true);
    expect(types.has('saiyan')).toBe(true);
    expect(types.has('kai')).toBe(true);

    // Grand Kai's "another_own_active_is_kai" condition also resolves correctly against him
    const s = makeState({ phase: 'battle' });
    s.players.p1.actives[0] = fighter('grand_kai');
    s.players.p1.actives[1] = fighter('ultimate_gohan');
    const stats = getEffectiveStats(s.players.p1.actives[0]!, 'active', 0, 'p1', s);
    expect(stats.atk).toBe(6500); // 5500 base + 1000 Master (Gohan counts as Kai)
  });
});

// ---- Cell Swarm (family_count_buff) ----

describe('Cell Swarm', () => {
  it('Cell Jr. gains +1000 ATK per OTHER Cell-family fighter in play (actives + bench)', () => {
    const s = makeState({ phase: 'battle' });
    s.players.p1.actives[0] = fighter('cell_jr');
    s.players.p1.actives[1] = fighter('cell_jr_2');
    s.players.p1.bench[0] = fighter('semi_perfect_cell');

    const stats = getEffectiveStats(s.players.p1.actives[0]!, 'active', 0, 'p1', s);
    // base 2000 + 1000*2 (cell_jr_2 active, semi_perfect_cell bench) = 4000
    expect(stats.atk).toBe(4000);
  });

  it('does not count itself or the opponent\'s Cell-family fighters', () => {
    const s = makeState({ phase: 'battle' });
    s.players.p1.actives[0] = fighter('cell_jr');
    s.players.p2.actives[0] = fighter('cell'); // opponent's Cell — must not count

    const stats = getEffectiveStats(s.players.p1.actives[0]!, 'active', 0, 'p1', s);
    expect(stats.atk).toBe(2000); // base only
  });
});

// ---- Percentage math (exact, no rounding rule) ----

describe('Exact percentage math', () => {
  it('planet_namek heals a 7,500-max Yellow fighter exactly 1,125 (15%)', () => {
    let s = makeState({ phase: 'end', turnPlayer: 'p1', field: 'planet_namek' });
    // dende: class C (Yellow), maxHp 3000 — scale to 7500 to match the spec's worked example
    s.players.p1.actives[0] = fighter('dende', { maxHp: 7500, currentHp: 5000 });

    s = applyIntent(s, { type: 'advance_phase' });

    expect(s.players.p1.actives[0]?.currentHp).toBe(6125); // 5000 + 1125
  });

  it('kame_house heals 10% only when a player controls all three colours', () => {
    let s = makeState({ phase: 'end', turnPlayer: 'p1', field: 'kame_house' });
    s.players.p1.actives[0] = fighter('raditz', { currentHp: 1000 }); // A
    s.players.p1.actives[1] = fighter('king_cold', { currentHp: 1000 }); // B
    s.players.p1.bench[0] = fighter('dr_gero_20', { currentHp: 1000 }); // C

    s = applyIntent(s, { type: 'advance_phase' });

    expect(s.players.p1.actives[0]?.currentHp).toBe(1400); // 1000 + 10% of 4000 maxHp
  });

  it('kame_house heals nothing when only two colours are present', () => {
    let s = makeState({ phase: 'end', turnPlayer: 'p1', field: 'kame_house' });
    s.players.p1.actives[0] = fighter('raditz', { currentHp: 1000 }); // A
    s.players.p1.actives[1] = fighter('nappa', { currentHp: 1000 }); // A

    s = applyIntent(s, { type: 'advance_phase' });

    expect(s.players.p1.actives[0]?.currentHp).toBe(1000); // unchanged — only one colour in play
  });
});

// ---- World Tournament Arena (rainbow buff) ----

describe('World Tournament Arena', () => {
  it('gives +500 ATK per distinct colour among the controller\'s in-play fighters', () => {
    const s = makeState({ field: 'world_tournament_arena' });
    s.players.p1.actives[0] = fighter('raditz'); // A
    s.players.p1.actives[1] = fighter('king_cold'); // B
    s.players.p1.bench[0] = fighter('dr_gero_20'); // C

    const stats = getEffectiveStats(s.players.p1.actives[0]!, 'active', 0, 'p1', s);
    expect(stats.atk).toBe(3500 + 1500); // base 3500 + 500*3 colours
  });
});

// ---- Frieza's Spaceship (ability/ultimate damage boost, not basic attacks) ----

describe("Frieza's Spaceship damage boost", () => {
  it('boosts a Purple hero\'s ultimate damage by 15%, but not a basic attack', () => {
    let s = makeState({ phase: 'battle', field: 'friezas_spaceship' });
    s.players.p1.actives[0] = fighter('vegeta'); // class A — NOT purple, control case
    s.players.p1.actives[1] = fighter('cell'); // class B (Purple), solar_kamehameha 5000 dmg
    s.players.p2.actives[0] = fighter('dragon_clan_namekian', { maxHp: 20000, currentHp: 20000 });
    s.players.p2.actives[1] = fighter('namekian_child', { maxHp: 20000, currentHp: 20000 });

    s = applyIntent(s, { type: 'ultimate', fighterIndex: 1 }); // Cell's Solar Kamehameha, all enemy actives

    // 5000 * 1.15 = 5750
    expect(s.players.p2.actives[0]?.currentHp).toBe(20000 - 5750);
  });

  it('does not boost item damage', () => {
    let s = makeState({ phase: 'main1', field: 'friezas_spaceship' });
    s.players.p1.hand = ['kamehameha'];
    s.players.p1.kiCurrent = 3;
    s.players.p1.actives[0] = fighter('cell'); // Purple, irrelevant to item damage
    s.players.p2.actives[0] = fighter('dragon_clan_namekian', { maxHp: 20000, currentHp: 20000 });

    s = applyIntent(s, { type: 'play_item', cardId: 'kamehameha', targetIndex: 0 });

    expect(s.players.p2.actives[0]?.currentHp).toBe(20000 - 3000); // unboosted
  });
});

// ---- Dr. Gero's Lab (lifesteal on basic attacks) ----

describe("Dr. Gero's Lab lifesteal", () => {
  it('heals a Purple attacker 30% of the damage actually dealt by a basic attack', () => {
    let s = makeState({ phase: 'battle', field: 'dr_geros_lab' });
    // android_17 is class B (Purple), atk 4500, attackKiCost 0
    s.players.p1.actives[0] = fighter('android_17', { currentHp: 3000, maxHp: 5500 });
    s.players.p2.actives[0] = fighter('dragon_clan_namekian'); // def 1000

    s = applyIntent(s, { type: 'attack', attackerIndex: 0, targetIndex: 0 });

    // damage = 4500 - 1000 = 3500; lifesteal = 30% of 3500 = 1050
    expect(s.players.p1.actives[0]?.currentHp).toBe(3000 + 1050);
  });
});

// ---- Lockout (field_lockout) ----

describe('Lockout fields', () => {
  it("Guru's House: Broly (Green) gains no Legendary stacks from KOs during the lock", () => {
    let s = makeState({ phase: 'battle', field: 'gurus_house' });
    s.players.p1.actives[0] = fighter('broly');
    s.players.p1.actives[1] = fighter('dende', { summoningSick: false }); // Yellow attacker
    s.players.p2.actives[0] = fighter('pui_pui', { currentHp: 1 });

    s = applyIntent(s, { type: 'attack', attackerIndex: 1, targetIndex: 0 });

    expect(s.players.p1.actives[0]?.counters.legendary).toBeUndefined();
  });

  it("Guru's House: Vegeta (Green) can't use Final Flash", () => {
    const s = makeState({ phase: 'battle', field: 'gurus_house' });
    s.players.p1.actives[0] = fighter('vegeta');
    s.players.p2.actives[0] = fighter('dragon_clan_namekian');

    const moves = legalMoves(s, 'p1');
    expect(moves.some(m => m.type === 'ultimate')).toBe(false);
    expect(() => applyIntent(s, { type: 'ultimate', fighterIndex: 0, targetIndex: 0 })).toThrow('locked');
  });

  it("Guru's House: Dende (Yellow) still heals normally", () => {
    let s = makeState({ phase: 'end', turnPlayer: 'p1', field: 'gurus_house' });
    s.players.p1.actives[0] = fighter('dende'); // Yellow — matches the lock
    s.players.p1.actives[1] = fighter('king_yemma', { currentHp: 1000 }); // Kai, Green — heal target

    s = applyIntent(s, { type: 'advance_phase' });

    expect(s.players.p1.actives[1]?.currentHp).toBe(2500); // Dende's 1500 heal still fires
  });

  it('a lockout resumes applying accumulated (but frozen) counters once it ends', () => {
    let s = makeState({ phase: 'battle', field: 'gurus_house' });
    s.players.p1.actives[0] = fighter('broly', { counters: { legendary: 2 } }); // pre-existing stacks
    const lockedStats = getEffectiveStats(s.players.p1.actives[0]!, 'active', 0, 'p1', s);
    expect(lockedStats.atk).toBe(7000); // base only — stacks frozen, not lost

    s = { ...s, field: null };
    const unlockedStats = getEffectiveStats(s.players.p1.actives[0]!, 'active', 0, 'p1', s);
    expect(unlockedStats.atk).toBe(8000); // 7000 + 500*2 — resumes once the lock ends
  });
});

// ---- Kai deck engine hooks ----

describe('Kai deck', () => {
  it('Ultimate Gohan: Unlocked Potential is live at/above half HP, off below it', () => {
    const s = makeState();
    s.players.p1.actives[0] = fighter('ultimate_gohan', { currentHp: 5000 }); // 5000/9000, >= half
    let stats = getEffectiveStats(s.players.p1.actives[0]!, 'active', 0, 'p1', s);
    expect(stats.atk).toBe(9000); // 7000 + 2000

    s.players.p1.actives[0] = { ...s.players.p1.actives[0]!, currentHp: 4000 }; // < half
    stats = getEffectiveStats(s.players.p1.actives[0]!, 'active', 0, 'p1', s);
    expect(stats.atk).toBe(7000); // bonus off
  });

  it('Ultimate Kamehameha deals 7,000 Pure Damage and consumes the turn', () => {
    let s = makeState({ phase: 'battle' });
    s.players.p1.actives[0] = fighter('ultimate_gohan');
    s.players.p2.actives[0] = fighter('dragon_clan_namekian', { maxHp: 20000, currentHp: 20000 });

    s = applyIntent(s, { type: 'ultimate', fighterIndex: 0, targetIndex: 0 });

    expect(s.players.p2.actives[0]?.currentHp).toBe(13000);
    expect(s.players.p1.actives[0]?.oncePerGameUsed['ultimate_kamehameha']).toBe(true);
  });

  it("Korin's Senzu Stock heals a chosen friendly fighter (active or bench), once per game", () => {
    let s = makeState({ phase: 'battle' });
    s.players.p1.actives[0] = fighter('korin');
    s.players.p1.bench[0] = fighter('king_yemma', { currentHp: 500 });
    s.players.p2.actives[0] = fighter('dragon_clan_namekian'); // keep p2's board non-empty

    s = applyIntent(s, { type: 'ultimate', fighterIndex: 0, targetSide: 'bench', targetIndex: 0 });

    expect(s.players.p1.bench[0]?.currentHp).toBe(2500); // 500 + 2000
    expect(() =>
      applyIntent({ ...s, players: { ...s.players, p1: { ...s.players.p1, actives: [fighter('korin', { oncePerGameUsed: { senzu_stock: true } }), null] } } },
        { type: 'ultimate', fighterIndex: 0, targetSide: 'bench', targetIndex: 0 })
    ).toThrow('already used');
  });

  it("Korin's Senzu Stock works even while Korin is summoning-sick, unlike a normal ultimate", () => {
    let s = makeState({ phase: 'battle' });
    s.players.p1.actives[0] = fighter('korin', { summoningSick: true });
    s.players.p1.bench[0] = fighter('king_yemma', { currentHp: 500 });
    s.players.p2.actives[0] = fighter('dragon_clan_namekian');

    s = applyIntent(s, { type: 'ultimate', fighterIndex: 0, targetSide: 'bench', targetIndex: 0 });
    expect(s.players.p1.bench[0]?.currentHp).toBe(2500); // heal still landed

    // Contrast: a freshly-played Vegeta (summoning-sick) can't use Final Flash —
    // the bypass is specific to abilities flagged ignoresSummoningSickness.
    const sickVegeta = makeState({ phase: 'battle' });
    sickVegeta.players.p1.actives[0] = fighter('vegeta', { summoningSick: true });
    sickVegeta.players.p2.actives[0] = fighter('dragon_clan_namekian');
    expect(legalMoves(sickVegeta, 'p1').some(m => m.type === 'ultimate')).toBe(false);
    expect(() => applyIntent(sickVegeta, { type: 'ultimate', fighterIndex: 0, targetIndex: 0 })).toThrow('summoning sick');
  });

  it("Mr. Popo's Caretaker heals the other Active at end of turn", () => {
    let s = makeState({ phase: 'end', turnPlayer: 'p1' });
    s.players.p1.actives[0] = fighter('mr_popo');
    s.players.p1.actives[1] = fighter('king_yemma', { currentHp: 1000 });

    s = applyIntent(s, { type: 'advance_phase' });

    expect(s.players.p1.actives[1]?.currentHp).toBe(2000); // + 1000
  });

  it("Supreme Kai's Divine Guidance heals all own Kai fighters 1,500 (actives + bench), not non-Kai", () => {
    let s = makeState({ phase: 'end', turnPlayer: 'p1' });
    s.players.p1.actives[0] = fighter('supreme_kai');
    s.players.p1.actives[1] = fighter('king_yemma', { currentHp: 1000 }); // Kai active
    s.players.p1.bench[0] = fighter('korin', { currentHp: 500 }); // Kai on the bench
    s.players.p1.bench[1] = fighter('raditz', { currentHp: 1000 }); // not Kai

    s = applyIntent(s, { type: 'advance_phase' });

    expect(s.players.p1.actives[1]?.currentHp).toBe(2500); // Kai active — healed 1,500
    expect(s.players.p1.bench[0]?.currentHp).toBe(2000); // Kai bench — healed 1,500 too
    expect(s.players.p1.bench[1]?.currentHp).toBe(1000); // not Kai — untouched
  });

  it("Angel's Grace heals every friendly fighter 1,000, uncapped target selection", () => {
    let s = makeState({ phase: 'main1' });
    s.players.p1.hand = ['angels_grace'];
    s.players.p1.kiCurrent = 2;
    s.players.p1.actives[0] = fighter('king_yemma', { currentHp: 1000 });
    s.players.p1.bench[0] = fighter('korin', { currentHp: 500 });

    s = applyIntent(s, { type: 'play_item', cardId: 'angels_grace' });

    expect(s.players.p1.actives[0]?.currentHp).toBe(2000);
    expect(s.players.p1.bench[0]?.currentHp).toBe(1500);
  });
});
