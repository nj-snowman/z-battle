import { applyIntent, checkWinLoss } from '../engine';
import { makeFighterInstance } from '../setup';
import { getEffectiveStats } from '../buffs';
import { legalMoves } from '../legalMoves';
import { GameState, PlayerState, FighterInstance } from '../types';

// ---- Helper to build a minimal deterministic GameState ----
function makeEmptyPlayer(deckId: string): PlayerState {
  return {
    deck: deckId,
    kiMax: 1,
    kiCurrent: 1,
    koScoredAgainst: 0,
    hand: [],
    piles: { hero: [], item: [] },
    actives: [null, null],
    bench: [null, null],
    turnNumber: 1,
    friendlySaiyanKoedThisGame: false,
    activeBuuCounts: [0, 0],
    benchBuuCounts: [0, 0],
  };
}

function makeState(overrides?: Partial<GameState>): GameState {
  const base: GameState = {
    phase: 'main1',
    turnPlayer: 'p1',
    turnNumber: 1,
    firstPlayer: 'p1',
    field: null,
    discard: [],
    players: {
      p1: makeEmptyPlayer('saiyan'),
      p2: makeEmptyPlayer('namekian'),
    },
    winner: null,
    log: [],
    firstDamageDone: false,
    pendingPromotions: [],
  };
  return { ...base, ...overrides };
}

// ---- Test 1: Ki curve ----
describe('Ki curve', () => {
  it('Turn 1 P1 starts with 1 Ki', () => {
    const s = makeState({ phase: 'draw' });
    // Give p1 a card to draw so we can skip past draw phase
    const s1 = { ...s, players: { ...s.players, p1: { ...s.players.p1, piles: { ...s.players.p1.piles, hero: ['saibaman'] } } } };
    const s2 = applyIntent(s1, { type: 'draw', pile: 'hero' });
    expect(s2.players.p1.kiCurrent).toBe(1);
    expect(s2.players.p1.kiMax).toBe(1);
  });

  it('After first end_turn, p2 gets turn with 1 Ki', () => {
    // P1 turn number = 1, P2 hasn't had a turn yet (turnNumber 0 -> 1 after first turn switch)
    let s = makeState({ phase: 'end' });
    // p2 starts with turnNumber 0 (not yet had a turn)
    s = { ...s, players: { ...s.players, p2: { ...s.players.p2, turnNumber: 0 } } };
    s = applyIntent(s, { type: 'advance_phase' }); // EOT + switch to p2
    expect(s.turnPlayer).toBe('p2');
    expect(s.players.p2.kiMax).toBe(1);
    expect(s.players.p2.kiCurrent).toBe(1);
  });

  it('P1 Turn 2 gets 2 Ki', () => {
    let s = makeState({ phase: 'end' });
    // p2 starts with turnNumber 0 (not yet had a turn)
    s = { ...s, players: { ...s.players, p2: { ...s.players.p2, turnNumber: 0 } } };
    // End p1 turn 1 -> p2 turn 1
    s = applyIntent(s, { type: 'advance_phase' });
    expect(s.turnPlayer).toBe('p2');
    // End p2 turn 1 -> p1 turn 2
    s = { ...s, phase: 'end' };
    s = applyIntent(s, { type: 'advance_phase' });
    expect(s.turnPlayer).toBe('p1');
    expect(s.players.p1.kiMax).toBe(2);
    expect(s.players.p1.kiCurrent).toBe(2);
  });

  it('Ki caps at 8', () => {
    // Simulate many turns
    let s = makeState({ phase: 'end' });
    for (let i = 0; i < 20; i++) {
      s = applyIntent(s, { type: 'advance_phase' });
      s = { ...s, phase: 'end' };
    }
    // Both players should be at 8 Ki max
    expect(s.players.p1.kiMax).toBeLessThanOrEqual(8);
    expect(s.players.p2.kiMax).toBeLessThanOrEqual(8);
  });
});

// ---- Test 2: KO scoring ----
describe('KO scoring', () => {
  it('Defeating a fighter increments koScoredAgainst on the KO\'d player', () => {
    let s = makeState({ phase: 'battle', firstDamageDone: true });
    // P1 has a strong fighter, P2 has a weak fighter
    const p1Fighter = makeFighterInstance('saibaman'); // 2500 ATK, 500 DEF
    const p2Fighter = makeFighterInstance('namekian_child'); // 2500 ATK, 1000 DEF, 2500 HP

    s.players.p1.actives[0] = { ...p1Fighter, summoningSick: false };
    s.players.p1.kiCurrent = 5;
    s.players.p2.actives[0] = p2Fighter;

    // ATK 3000 vs DEF 1000 = 2000 damage. namekian_child has 2500 HP. Won't KO.
    // Let's reduce p2 fighter HP to be KO-able
    s.players.p2.actives[0] = { ...p2Fighter, currentHp: 1000 };

    s = applyIntent(s, { type: 'attack', attackerIndex: 0, targetIndex: 0 });

    // p2 fighter was KO'd -> p2's koScoredAgainst goes up by 1
    expect(s.players.p2.koScoredAgainst).toBe(1);
  });

  it('Reaching 3 KOs triggers a winner', () => {
    let s = makeState({ phase: 'battle' });
    s.players.p2.koScoredAgainst = 2;

    const p1Fighter = makeFighterInstance('saibaman');
    const p2Fighter = makeFighterInstance('namekian_child');

    s.players.p1.actives[0] = { ...p1Fighter, summoningSick: false };
    s.players.p1.kiCurrent = 5;
    s.players.p2.actives[0] = { ...p2Fighter, currentHp: 500 };

    s = applyIntent(s, { type: 'attack', attackerIndex: 0, targetIndex: 0 });

    expect(s.players.p2.koScoredAgainst).toBe(3);
    expect(s.winner).toBe('p1');
  });
});

// ---- Test 4: Conditional buff (Nail's Warrior Clan) ----
describe('Conditional buffs', () => {
  it("Nail gains +1000 DEF when another Namekian is in the other active slot", () => {
    let s = makeState({ phase: 'battle' });
    const nail = makeFighterInstance('nail');
    const otherNamekian = makeFighterInstance('dragon_clan_namekian');

    s.players.p1.actives[0] = { ...nail, summoningSick: false };
    s.players.p1.actives[1] = otherNamekian;
    s.players.p1.kiCurrent = 5;

    const stats = getEffectiveStats(s.players.p1.actives[0]!, 'active', 0, 'p1', s);
    // Nail base DEF = 2500, +1000 from Warrior Clan = 3500
    expect(stats.def).toBe(3500);
  });

  it("Nail does NOT gain +1000 DEF when no other Namekian is active", () => {
    let s = makeState({ phase: 'battle' });
    const nail = makeFighterInstance('nail');
    const saiyan = makeFighterInstance('saibaman'); // not namekian

    s.players.p1.actives[0] = { ...nail, summoningSick: false };
    s.players.p1.actives[1] = saiyan;
    s.players.p1.kiCurrent = 5;

    const stats = getEffectiveStats(s.players.p1.actives[0]!, 'active', 0, 'p1', s);
    // Nail base DEF = 2500, no bonus
    expect(stats.def).toBe(2500);
  });

  it("Bardock gets +2000 ATK at or below half HP", () => {
    let s = makeState();
    const bardock = makeFighterInstance('bardock'); // HP: 6000
    s.players.p1.actives[0] = { ...bardock, currentHp: 3000 }; // exactly half

    const stats = getEffectiveStats(s.players.p1.actives[0]!, 'active', 0, 'p1', s);
    // Bardock base ATK = 5000, +2000 last_stand = 7000
    expect(stats.atk).toBe(7000);
  });

  it("Bardock does NOT get +2000 ATK above half HP", () => {
    let s = makeState();
    const bardock = makeFighterInstance('bardock');
    s.players.p1.actives[0] = { ...bardock, currentHp: 3001 }; // just above half

    const stats = getEffectiveStats(s.players.p1.actives[0]!, 'active', 0, 'p1', s);
    expect(stats.atk).toBe(5000);
  });
});

// ---- Test 5: Min 500 damage on basic attacks ----
describe('Minimum 500 damage rule', () => {
  it('Attack that would deal negative damage still deals 500', () => {
    let s = makeState({ phase: 'battle', firstDamageDone: true });
    // Saibaman ATK 2500, target Kami DEF 4000 → raw = -1500, clamped to 500
    const attackerF = makeFighterInstance('saibaman'); // ATK 2500
    const targetF = makeFighterInstance('kami'); // ATK 5000, DEF 4000, HP 7000

    s.players.p1.actives[0] = { ...attackerF, summoningSick: false };
    s.players.p1.kiCurrent = 5;
    s.players.p2.actives[0] = targetF;

    const initialHp = s.players.p2.actives[0]!.currentHp;
    s = applyIntent(s, { type: 'attack', attackerIndex: 0, targetIndex: 0 });

    // saibaman ATK 2500 - kami DEF 4000 = -1500 → min 500 damage
    const expectedHp = initialHp - 500;
    expect(s.players.p2.actives[0]?.currentHp).toBe(expectedHp);
  });

  it('Still deals the 500 minimum on the very first hit of the game, never halved to 250', () => {
    let s = makeState({ phase: 'battle' }); // firstDamageDone defaults to false
    const attackerF = makeFighterInstance('saibaman'); // ATK 2500
    const targetF = makeFighterInstance('kami'); // DEF 4000, HP 7000

    s.players.p1.actives[0] = { ...attackerF, summoningSick: false };
    s.players.p1.kiCurrent = 5;
    s.players.p2.actives[0] = targetF;

    const initialHp = s.players.p2.actives[0]!.currentHp;
    s = applyIntent(s, { type: 'attack', attackerIndex: 0, targetIndex: 0 });

    expect(s.players.p2.actives[0]?.currentHp).toBe(initialHp - 500);
  });

  it('Attack where ATK > DEF deals the difference as damage', () => {
    let s = makeState({ phase: 'battle' });
    const attackerF = makeFighterInstance('saibaman'); // ATK 3000, DEF 0
    const targetF = makeFighterInstance('saibaman');   // ATK 2000, DEF 1000, HP 3000

    s.players.p1.actives[0] = { ...attackerF, summoningSick: false };
    s.players.p1.kiCurrent = 5;
    s.players.p2.actives[0] = targetF;

    s = applyIntent(s, { type: 'attack', attackerIndex: 0, targetIndex: 0 });

    // 3000 ATK - 1000 DEF = 2000 damage
    expect(s.players.p2.actives[0]?.currentHp).toBe(3000 - 2000);
  });
});

// ---- Test: Saibaman self-destruct can KO the attacker back ----
describe('Saibaman self-destruct', () => {
  it('KOs the attacker when its 1,000 Pure Damage retaliation brings them to 0 HP', () => {
    let s = makeState({ phase: 'battle', firstDamageDone: true });

    const attackerF = makeFighterInstance('saibaman'); // ATK 2500, DEF 500
    const defenderF = makeFighterInstance('saibaman'); // HP 2000, DEF 500

    s.players.p1.actives[0] = { ...attackerF, summoningSick: false, currentHp: 1000 };
    s.players.p1.kiCurrent = 5;
    s.players.p2.actives[0] = defenderF;

    s = applyIntent(s, { type: 'attack', attackerIndex: 0, targetIndex: 0 });

    // 2500 ATK - 500 DEF = 2000 damage, lethal to the defender's 2000 HP
    expect(s.players.p2.actives[0]).toBeNull();
    // Saibaman's self-destruct deals 1,000 Pure Damage back to the attacker,
    // whose remaining 1,000 HP should also drop to 0 and KO them
    expect(s.players.p1.actives[0]).toBeNull();
    expect(s.players.p1.koScoredAgainst).toBe(1);
    expect(s.players.p2.koScoredAgainst).toBe(1);
  });
});

// ---- Test 6: Sacrifice does NOT score a KO ----
describe('Sacrifice does not score a KO', () => {
  it('Sacrificing a fighter does not increment opponent koScoredAgainst', () => {
    let s = makeState({ phase: 'main1' });
    const fighter = makeFighterInstance('saibaman');
    s.players.p1.actives[0] = fighter;
    s.players.p1.kiCurrent = 5;

    const p2KosBefore = s.players.p2.koScoredAgainst;
    s = applyIntent(s, { type: 'sacrifice', side: 'active', index: 0 });

    expect(s.players.p2.koScoredAgainst).toBe(p2KosBefore);
  });
});

// ---- Test 7: Self-destruct DOES score for opponent ----
describe('Self-destruct scores a KO for opponent', () => {
  it("Android #16 ultimate KOs itself — opponent (p2) scores", () => {
    let s = makeState({ phase: 'battle' });
    const android16 = makeFighterInstance('android_16');
    const target = makeFighterInstance('dragon_clan_namekian');

    s.players.p1.actives[0] = { ...android16, summoningSick: false };
    s.players.p1.kiCurrent = 5;
    s.players.p2.actives[0] = target;

    const p1KosBefore = s.players.p1.koScoredAgainst; // 0

    // Use the ultimate (self_destruct_16)
    s = applyIntent(s, { type: 'ultimate', fighterIndex: 0, targetIndex: 0 });

    // p1 KO'd itself -> p2 scores the KO -> p1's koScoredAgainst increases
    expect(s.players.p1.koScoredAgainst).toBe(p1KosBefore + 1);
    // Android #16 should be gone
    expect(s.players.p1.actives[0]).toBeNull();
  });
});

// ---- Test 8: End-of-turn heals capped at maxHp ----
describe('End-of-turn heals', () => {
  it('Namekian Warrior Mend heal is capped at maxHp', () => {
    let s = makeState({ phase: 'end' });
    const warrior = makeFighterInstance('namekian_warrior'); // HP 3000, heals 500 EOT
    // Set at full HP
    s.players.p1.actives[0] = { ...warrior, currentHp: 3000 };

    s = applyIntent(s, { type: 'advance_phase' }); // process EOT for p1 then switch to p2

    // The p1 fighter healed but was already at max — still max
    // After advance_phase, it switches to p2, but EOT ran for p1
    // The p1 fighter was processed in p1's EOT
    // We need to check what happened during p1's EOT
    // After advance_phase from 'end', it switches to p2.
    // But p1's fighter state was processed and stored.
    // Check discard: no, check p1.actives: they remain (just cleared summoningSick etc)
    const p1ActualPlayer = s.players.p1;
    expect(p1ActualPlayer.actives[0]?.currentHp).toBeLessThanOrEqual(3000);
  });

  it('Namekian Warrior heals 500 when below max HP', () => {
    let s = makeState({ phase: 'end' });
    const warrior = makeFighterInstance('namekian_warrior'); // HP 3000
    s.players.p1.actives[0] = { ...warrior, currentHp: 2000 }; // below max

    s = applyIntent(s, { type: 'advance_phase' }); // EOT for p1

    // p1's fighter should now be at 2500
    expect(s.players.p1.actives[0]?.currentHp).toBe(2500);
  });

  it('Android #18 heals 1000 at end of turn', () => {
    let s = makeState({ phase: 'end' });
    const android18 = makeFighterInstance('android_18'); // HP 5000, heals 1000 EOT
    s.players.p1.actives[0] = { ...android18, currentHp: 3000 };

    s = applyIntent(s, { type: 'advance_phase' });

    expect(s.players.p1.actives[0]?.currentHp).toBe(4000);
  });

  it('Heal does not exceed maxHp', () => {
    let s = makeState({ phase: 'end' });
    const android18 = makeFighterInstance('android_18'); // HP 5000
    s.players.p1.actives[0] = { ...android18, currentHp: 4500 }; // only 500 below max

    s = applyIntent(s, { type: 'advance_phase' });

    // Should heal to 5000 (max), not 5500
    expect(s.players.p1.actives[0]?.currentHp).toBe(5000);
  });
});

// ---- Test 9: Ki spending on attack ----
describe('Ki spending', () => {
  it('Normal attack costs 1 Ki', () => {
    let s = makeState({ phase: 'battle' });
    const attacker = makeFighterInstance('saibaman');
    s.players.p1.actives[0] = { ...attacker, summoningSick: false };
    s.players.p1.kiCurrent = 3;
    s.players.p2.actives[0] = makeFighterInstance('dragon_clan_namekian');

    s = applyIntent(s, { type: 'attack', attackerIndex: 0, targetIndex: 0 });

    expect(s.players.p1.kiCurrent).toBe(2); // 3 - 1 = 2
  });

  it('Android #17 attacks cost 0 Ki', () => {
    let s = makeState({ phase: 'battle' });
    const android17 = makeFighterInstance('android_17');
    s.players.p1.actives[0] = { ...android17, summoningSick: false };
    s.players.p1.kiCurrent = 2;
    s.players.p2.actives[0] = makeFighterInstance('dragon_clan_namekian');

    s = applyIntent(s, { type: 'attack', attackerIndex: 0, targetIndex: 0 });

    expect(s.players.p1.kiCurrent).toBe(2); // unchanged — costs 0 Ki
  });
});

// ---- Test 10: Play hero puts fighter in slot ----
describe('Play hero', () => {
  it('Playing a hero from hand puts it in the specified slot', () => {
    let s = makeState({ phase: 'main1' });
    s.players.p1.hand = ['saibaman'];
    s.players.p1.kiCurrent = 3;

    s = applyIntent(s, { type: 'play_hero', cardId: 'saibaman', slot: 'active', index: 0 });

    expect(s.players.p1.actives[0]?.cardId).toBe('saibaman');
    expect(s.players.p1.hand).not.toContain('saibaman');
    expect(s.players.p1.kiCurrent).toBe(2); // cost 1 Ki
    expect(s.players.p1.actives[0]?.summoningSick).toBe(true);
  });

  it('Playing Chiaotzu stuns an enemy active', () => {
    let s = makeState({ phase: 'main1' });
    s.players.p1.hand = ['chiaotzu'];
    s.players.p1.kiCurrent = 5;
    const enemyFighter = makeFighterInstance('dragon_clan_namekian');
    s.players.p2.actives[0] = enemyFighter;

    s = applyIntent(s, { type: 'play_hero', cardId: 'chiaotzu', slot: 'active', index: 0 });

    const stunStatus = s.players.p2.actives[0]?.statuses.find(st => st.key === 'stun');
    expect(stunStatus).toBeDefined();
  });
});

// ---- Test 11: Phase transitions ----
describe('Phase transitions', () => {
  it('advance_phase goes from main1 to battle', () => {
    let s = makeState({ phase: 'main1' });
    s = applyIntent(s, { type: 'advance_phase' });
    expect(s.phase).toBe('battle');
  });

  it('draw intent moves from draw to main1', () => {
    let s = makeState({ phase: 'draw' });
    s.players.p1.piles.hero = ['saibaman'];
    s = applyIntent(s, { type: 'draw', pile: 'hero' });
    expect(s.phase).toBe('main1');
    expect(s.players.p1.hand).toContain('saibaman');
  });
});

// ---- Test 12: Giant Namekian bonus HP ----
describe('Giant Namekian', () => {
  it('Enters with +2000 HP (max HP becomes 9500)', () => {
    let s = makeState({ phase: 'main1' });
    s.players.p1.hand = ['giant_namekian'];
    s.players.p1.kiCurrent = 10;

    s = applyIntent(s, { type: 'play_hero', cardId: 'giant_namekian', slot: 'active', index: 0 });

    expect(s.players.p1.actives[0]?.maxHp).toBe(9500);
    expect(s.players.p1.actives[0]?.currentHp).toBe(9500);
  });
});

// ---- Test 13: Broly legendary counter ----
describe('Broly Legendary counter', () => {
  it('Broly gains a legendary counter each time any fighter is KO\'d', () => {
    let s = makeState({ phase: 'battle' });
    const broly = makeFighterInstance('broly');
    const attacker = makeFighterInstance('saibaman');
    const target = makeFighterInstance('dragon_clan_namekian');

    s.players.p1.actives[0] = { ...broly };
    s.players.p1.actives[1] = { ...attacker, summoningSick: false };
    s.players.p1.kiCurrent = 10;
    s.players.p2.actives[0] = { ...target, currentHp: 500 };

    s = applyIntent(s, { type: 'attack', attackerIndex: 1, targetIndex: 0 });

    // Broly should have 1 legendary counter
    expect(s.players.p1.actives[0]?.counters.legendary).toBe(1);
  });

  it('Broly ATK increases by 500 per legendary counter', () => {
    let s = makeState();
    const broly = makeFighterInstance('broly');
    s.players.p1.actives[0] = { ...broly, counters: { legendary: 3 } };

    const stats = getEffectiveStats(s.players.p1.actives[0]!, 'active', 0, 'p1', s);
    // Broly base ATK = 7000, +500 * 3 = 8500
    expect(stats.atk).toBe(8500);
  });
});

// ---- Test 14: Kami guardian buff to other active ----
describe('Kami guardian', () => {
  it('Other active gains +1000 DEF when Kami is active', () => {
    let s = makeState();
    const kami = makeFighterInstance('kami');
    const warrior = makeFighterInstance('namekian_warrior');

    s.players.p1.actives[0] = kami;
    s.players.p1.actives[1] = warrior;

    const stats = getEffectiveStats(s.players.p1.actives[1]!, 'active', 1, 'p1', s);
    // namekian_warrior base DEF = 1500, +1000 from Kami = 2500
    expect(stats.def).toBe(2500);
  });
});

// ---- Test 15: Field buffs (now class-based; fields key off colour, not race) ----
describe('Field buffs', () => {
  it('Hyperbolic Time Chamber (Green lockout) leaves a Green hero\'s conditional ability intact', () => {
    let s = makeState({ field: 'hyperbolic_time_chamber' });
    const bardock = makeFighterInstance('bardock'); // class A (Green); last_stand +2000 ATK at/below half HP
    s.players.p1.actives[0] = { ...bardock, currentHp: 3000 }; // exactly half of 6000

    const stats = getEffectiveStats(s.players.p1.actives[0]!, 'active', 0, 'p1', s);
    expect(stats.atk).toBe(7000); // 5000 base + 2000 last_stand — Green still functions
  });

  it('Hyperbolic Time Chamber (Green lockout) disables a non-Green hero\'s conditional ability', () => {
    let s = makeState({ field: 'hyperbolic_time_chamber' });
    const lordSlug = makeFighterInstance('lord_slug'); // class B (Purple); tyrant +1000 ATK at full HP
    s.players.p1.actives[0] = lordSlug; // starts at full HP

    const stats = getEffectiveStats(s.players.p1.actives[0]!, 'active', 0, 'p1', s);
    expect(stats.atk).toBe(4000); // base only — tyrant is locked out (not Green)
  });

  it('King Kai\'s Planet gives Green fighters +1000 ATK, and leaves other colours alone', () => {
    let s = makeState({ field: 'king_kais_planet' });
    const raditz = makeFighterInstance('raditz'); // class A (Green), ATK 3500
    const drGero = makeFighterInstance('dr_gero_20'); // class C (Yellow), ATK 3000
    s.players.p1.actives[0] = raditz;
    s.players.p1.actives[1] = drGero;

    const raditzStats = getEffectiveStats(s.players.p1.actives[0]!, 'active', 0, 'p1', s);
    const geroStats = getEffectiveStats(s.players.p1.actives[1]!, 'active', 1, 'p1', s);
    expect(raditzStats.atk).toBe(4500); // 3500 + 1000
    expect(geroStats.atk).toBe(3000); // unaffected
  });
});

// ---- Test 16: Win by empty board ----
describe('Win by empty board', () => {
  it("A player wins if opponent has no fighters left", () => {
    let s = makeState();
    // Give p1 a fighter so only p2 has an empty board
    const p1Fighter = makeFighterInstance('saibaman');
    s = {
      ...s,
      players: {
        ...s.players,
        p1: { ...s.players.p1, actives: [p1Fighter, null] as typeof s.players.p1.actives },
        p2: { ...s.players.p2, actives: [null, null] as typeof s.players.p2.actives, bench: [null, null] as typeof s.players.p2.bench },
      },
    };

    s = checkWinLoss(s);
    expect(s.winner).toBe('p1');
  });
});

// ---- Test 17: Nappa Rampage ----
describe('Nappa Rampage', () => {
  it('Nappa gains +1000 ATK after a friendly Saiyan is KO\'d', () => {
    let s = makeState({ phase: 'battle' });
    const nappa = makeFighterInstance('nappa');
    // Mark that a friendly Saiyan was KO'd
    s.players.p1.actives[0] = nappa;
    s.players.p1.friendlySaiyanKoedThisGame = true;

    const stats = getEffectiveStats(s.players.p1.actives[0]!, 'active', 0, 'p1', s);
    // Nappa base ATK = 4000, +1000 rampage = 5000
    expect(stats.atk).toBe(5000);
  });

  it('Nappa base ATK without rampage', () => {
    let s = makeState({ phase: 'battle' });
    const nappa = makeFighterInstance('nappa');
    s.players.p1.actives[0] = nappa;
    s.players.p1.friendlySaiyanKoedThisGame = false;

    const stats = getEffectiveStats(s.players.p1.actives[0]!, 'active', 0, 'p1', s);
    expect(stats.atk).toBe(4000);
  });
});

// ---- Test 18: Equipment limit ----
describe('Equipment limit', () => {
  it('Cannot attach more than 2 equipment to a fighter', () => {
    let s = makeState({ phase: 'main1' });
    const fighter = makeFighterInstance('saibaman');
    s.players.p1.actives[0] = { ...fighter, equipment: ['saiyan_armor', 'power_pole'] };
    s.players.p1.hand = ['weighted_clothing'];
    s.players.p1.kiCurrent = 5;

    expect(() => {
      applyIntent(s, { type: 'play_item', cardId: 'weighted_clothing', targetSide: 'active', targetIndex: 0 });
    }).toThrow('Equipment limit reached');
  });
});

// ---- Majin vignettes (V-M1 – V-M7) ----

describe('Majin — Buu evolve chain', () => {
  it('V-M1: evolve cost ladder and buuCount progression', () => {
    let s = makeState({ phase: 'main1' });
    s.players.p1.hand = ['evil_buu'];
    s.players.p1.kiCurrent = 1;
    s = applyIntent(s, { type: 'play_hero', cardId: 'evil_buu', slot: 'active', index: 0 });
    expect(s.players.p1.kiCurrent).toBe(0); // hard-cast pays full 1 Ki
    expect(s.players.p1.activeBuuCounts[0]).toBe(1);
    expect(s.players.p1.actives[0]?.cardId).toBe('evil_buu');

    s.players.p1.hand = ['majin_buu_fat'];
    s.players.p1.kiCurrent = 2;
    s = applyIntent(s, { type: 'evolve', cardId: 'majin_buu_fat', slotSide: 'active', slotIndex: 0 });
    expect(s.players.p1.kiCurrent).toBe(0); // cost = 3 - 1 = 2
    expect(s.players.p1.activeBuuCounts[0]).toBe(2);
    expect(s.players.p1.actives[0]?.cardId).toBe('majin_buu_fat');

    s.players.p1.hand = ['super_buu'];
    s.players.p1.kiCurrent = 3;
    s = applyIntent(s, { type: 'evolve', cardId: 'super_buu', slotSide: 'active', slotIndex: 0 });
    expect(s.players.p1.kiCurrent).toBe(0); // cost = 5 - 2 = 3
    expect(s.players.p1.activeBuuCounts[0]).toBe(3);
    expect(s.players.p1.actives[0]?.cardId).toBe('super_buu');

    s.players.p1.hand = ['kid_buu'];
    s.players.p1.kiCurrent = 3;
    s = applyIntent(s, { type: 'evolve', cardId: 'kid_buu', slotSide: 'active', slotIndex: 0 });
    expect(s.players.p1.kiCurrent).toBe(0); // cost = 6 - 3 = 3
    expect(s.players.p1.activeBuuCounts[0]).toBe(4);
    expect(s.players.p1.actives[0]?.cardId).toBe('kid_buu');
  });

  it('V-M2: evolve carries damage and gear, and is not a KO', () => {
    let s = makeState({ phase: 'main1' });
    const fatBuu = makeFighterInstance('majin_buu_fat'); // maxHp 6000
    s.players.p1.actives[0] = { ...fatBuu, currentHp: 4000, equipment: ['power_pole'] };
    s.players.p1.activeBuuCounts = [2, 0];
    s.players.p1.hand = ['super_buu'];
    s.players.p1.kiCurrent = 10;
    const p2KosBefore = s.players.p2.koScoredAgainst;

    s = applyIntent(s, { type: 'evolve', cardId: 'super_buu', slotSide: 'active', slotIndex: 0 });

    expect(s.players.p1.actives[0]?.cardId).toBe('super_buu');
    expect(s.players.p1.actives[0]?.currentHp).toBe(5500); // 7500 max - 2000 damage taken
    expect(s.players.p1.actives[0]?.equipment).toContain('power_pole');
    expect(s.players.p2.koScoredAgainst).toBe(p2KosBefore); // evolving never scores a KO
  });

  it('V-M3: Absorb counter does not carry to Kid Buu on evolve', () => {
    let s = makeState({ phase: 'main1' });
    const superBuu = makeFighterInstance('super_buu');
    s.players.p1.actives[0] = { ...superBuu, counters: { absorb: 2 } };
    s.players.p1.activeBuuCounts = [3, 0];
    s.players.p1.hand = ['kid_buu'];
    s.players.p1.kiCurrent = 10;

    s = applyIntent(s, { type: 'evolve', cardId: 'kid_buu', slotSide: 'active', slotIndex: 0 });

    expect(s.players.p1.actives[0]?.cardId).toBe('kid_buu');
    expect(s.players.p1.actives[0]?.counters.absorb).toBeUndefined();
    const stats = getEffectiveStats(s.players.p1.actives[0]!, 'active', 0, 'p1', s);
    expect(stats.atk).toBe(6500); // base ATK only — Absorb reset on evolve
  });
});

describe('Majin — dual type', () => {
  it('V-M4: fields key off class, not race — a multi-typed card is unaffected by an off-colour field', () => {
    // Majin Vegeta (types: majin, saiyan) is class B (Purple). Babidi's Spaceship debuffs
    // Green (A) fighters — Majin Vegeta's dual TYPE doesn't matter; only class does, and
    // he isn't Green, so he's untouched. A Green fighter (Evil Buu) is affected.
    let s = makeState({ phase: 'main1' });
    const mv = makeFighterInstance('majin_vegeta');
    const evilBuu = makeFighterInstance('evil_buu'); // class A (Green)
    s.players.p1.actives[0] = mv;
    s.players.p1.actives[1] = evilBuu;

    let stats = getEffectiveStats(s.players.p1.actives[0]!, 'active', 0, 'p1', s);
    expect(stats.atk).toBe(6500); // base only — no field yet

    s.players.p1.hand = ['babidis_spaceship'];
    s.players.p1.kiCurrent = 1;
    s = applyIntent(s, { type: 'play_field', cardId: 'babidis_spaceship' });

    const mvStats = getEffectiveStats(s.players.p1.actives[0]!, 'active', 0, 'p1', s);
    const buuStats = getEffectiveStats(s.players.p1.actives[1]!, 'active', 1, 'p1', s);
    expect(mvStats.atk).toBe(6500); // Purple — unaffected by the Green debuff
    expect(buuStats.atk).toBe(1000); // 2000 base - 1000 Green debuff
  });
});

describe('Majin — Kid Buu Planet Burst', () => {
  it('V-M5: Planet Burst reaches the Bench; multi-KOs feed Pure Evil', () => {
    let s = makeState({ phase: 'battle' });
    const kidBuu = makeFighterInstance('kid_buu'); // maxHp 9000, atk 6500
    s.players.p1.actives[0] = { ...kidBuu, summoningSick: false };
    s.players.p1.kiCurrent = 5;

    s.players.p2.actives[0] = { ...makeFighterInstance('pui_pui'), currentHp: 2000 };
    s.players.p2.actives[1] = { ...makeFighterInstance('yakon'), currentHp: 1500 };
    s.players.p2.bench[0] = { ...makeFighterInstance('evil_buu'), currentHp: 2000 };
    s.players.p2.bench[1] = { ...makeFighterInstance('babidi'), maxHp: 6000, currentHp: 6000 };

    s = applyIntent(s, { type: 'ultimate', fighterIndex: 0 });

    // Planet Burst hits the bench before the actives, so bench[0] (evil_buu) takes
    // the game's first-ever instance of damage — halved to 1000, leaving it alive.
    expect(s.players.p2.bench[0]?.currentHp).toBe(1000); // 2000 - 1000 (halved first hit), survives
    expect(s.players.p2.bench[1]?.currentHp).toBe(4000); // 6000 - 2000, survives
    expect(s.players.p2.actives[0]).toBeNull();
    expect(s.players.p2.actives[1]).toBeNull();

    // 2 KOs this wave (actives only; evil_buu survived) -> Kid Buu +1000 ATK / +1000 HP (Pure Evil)
    const kb = s.players.p1.actives[0]!;
    expect(kb.maxHp).toBe(9000 + 1000);
    expect(kb.currentHp).toBe(9000 + 1000);
    const stats = getEffectiveStats(kb, 'active', 0, 'p1', s);
    expect(stats.atk).toBe(6500 + 1000);
  });
});

describe('Majin — Dabura stun-on-promote', () => {
  it('V-M6: promoted replacement enters stunned; passives still fire; stun clears after', () => {
    let s = makeState({ phase: 'battle' });
    const dabura = makeFighterInstance('dabura');
    s.players.p1.actives[0] = { ...dabura, summoningSick: false };
    s.players.p1.kiCurrent = 5;

    s.players.p2.actives[0] = { ...makeFighterInstance('namekian_child'), currentHp: 500 };
    s.players.p2.bench[0] = { ...makeFighterInstance('namekian_warrior'), currentHp: 2000 }; // below max; heals 500 EOT

    s = applyIntent(s, { type: 'attack', attackerIndex: 0, targetIndex: 0 });
    expect(s.pendingPromotions[0]?.daburaStunPending).toBe(true);

    s = applyIntent(s, { type: 'promote_from_bench', benchIndex: 0 });

    const promoted = s.players.p2.actives[0]!;
    expect(promoted.cardId).toBe('namekian_warrior');
    expect(promoted.cannotAttackNextTurn).toBe(true);
    expect(promoted.statuses.some((st) => st.key === 'stun')).toBe(true);

    // Blocked from attacking on its controller's next turn by the immediate stun status
    // (not by summoning sickness — simulate the promoted fighter having already had a turn)
    const s2: GameState = {
      ...s,
      turnPlayer: 'p2',
      phase: 'battle',
      players: {
        ...s.players,
        p2: {
          ...s.players.p2,
          actives: [{ ...promoted, summoningSick: false }, s.players.p2.actives[1]] as typeof s.players.p2.actives,
        },
      },
    };
    expect(() => applyIntent(s2, { type: 'attack', attackerIndex: 0, targetIndex: 0 })).toThrow('Fighter is stunned');

    // Its passive end-of-turn heal still fires despite the stun
    let s3: GameState = { ...s, turnPlayer: 'p2', phase: 'end' };
    s3 = applyIntent(s3, { type: 'advance_phase' });
    expect(s3.players.p2.actives[0]?.currentHp).toBe(2500);

    // Stun clears by the end of the controller's next turn
    expect(s3.players.p2.actives[0]?.statuses.some((st) => st.key === 'stun')).toBe(false);
  });
});

describe('Majin — Babidi Manipulation', () => {
  it("V-M7: forced attack KOs the second target; credited to Babidi's controller; Absorb does not trigger", () => {
    let s = makeState({ phase: 'battle' });
    const babidi = makeFighterInstance('babidi');
    s.players.p1.actives[0] = { ...babidi, summoningSick: false };
    s.players.p1.kiCurrent = 5;
    // Super Buu sits on p1's bench — Manipulation is not his own attack, so Absorb must not fire
    s.players.p1.bench[0] = makeFighterInstance('super_buu');

    s.players.p2.actives[0] = makeFighterInstance('dabura'); // "A" — the forced attacker
    s.players.p2.actives[1] = { ...makeFighterInstance('majin_buu_fat'), currentHp: 1 }; // "B" — guaranteed KO

    const p1KosBefore = s.players.p2.koScoredAgainst; // KOs scored BY p1 live on p2.koScoredAgainst

    s = applyIntent(s, { type: 'ultimate', fighterIndex: 0, targetIndex: 0, secondTargetIndex: 1 });

    expect(s.players.p2.koScoredAgainst).toBe(p1KosBefore + 1); // credited to Babidi's controller (p1)
    expect(s.players.p2.actives[1]).toBeNull();
    expect(s.players.p1.bench[0]?.counters.absorb).toBeUndefined(); // Absorb only triggers on Super Buu's own attacks
  });
});

describe('Majin — Bibidi Creation usable in Main phase', () => {
  it('can be used in Main 1, only once, and does not prevent attacking afterward', () => {
    let s = makeState({ phase: 'main1' });
    s.players.p1.actives[0] = { ...makeFighterInstance('bibidi'), summoningSick: false };
    s.players.p1.kiCurrent = 5;
    s.players.p2.actives[0] = { ...makeFighterInstance('namekian_child'), summoningSick: false };
    s.discard.push({ cardId: 'pui_pui', owner: 'p1' }); // p1's own KO'd Majin — index 0

    // Legal in Main 1
    const creationMoves = legalMoves(s, 'p1').filter(m => m.type === 'ultimate' && m.fighterIndex === 0);
    expect(creationMoves.length).toBeGreaterThan(0);

    s = applyIntent(s, { type: 'ultimate', fighterIndex: 0, targetIndex: 0 });
    expect(s.players.p1.hand).toContain('pui_pui');
    expect(s.discard.some(e => e.cardId === 'pui_pui')).toBe(false);
    // Doesn't consume the attack, and Bibidi can't use it again this game
    expect(s.players.p1.actives[0]?.hasAttackedThisTurn).toBe(false);
    expect(s.players.p1.actives[0]?.oncePerGameUsed['creation']).toBe(true);
    expect(legalMoves(s, 'p1').some(m => m.type === 'ultimate' && m.fighterIndex === 0)).toBe(false);

    // Still able to attack once battle phase arrives
    s = applyIntent(s, { type: 'advance_phase' });
    expect(s.phase).toBe('battle');
    s = applyIntent(s, { type: 'attack', attackerIndex: 0, targetIndex: 0 });
    expect(s.players.p1.actives[0]?.hasAttackedThisTurn).toBe(true);
    expect(s.players.p2.actives[0]?.currentHp).toBeLessThan(makeFighterInstance('namekian_child').currentHp);
  });
});

describe('Majin — Bibidi Creation ownership', () => {
  it("can only revive your own KO'd Majin, never the opponent's, even in a mirror matchup", () => {
    let s = makeState({ phase: 'main1' });
    s.players.p1.deck = 'majin';
    s.players.p2.deck = 'majin';
    s.players.p1.actives[0] = { ...makeFighterInstance('bibidi'), summoningSick: false };
    s.players.p1.kiCurrent = 5;

    s.discard.push({ cardId: 'pui_pui', owner: 'p1' }); // p1's own KO'd Majin — index 0
    s.discard.push({ cardId: 'yakon', owner: 'p2' });   // p2's KO'd Majin — index 1

    const creationMoves = legalMoves(s, 'p1').filter(
      m => m.type === 'ultimate' && m.fighterIndex === 0
    ) as Array<{ targetIndex?: number }>;
    expect(creationMoves.map(m => m.targetIndex)).toEqual([0]); // p2's discard entry never offered

    // Even if forced directly (bypassing legalMoves), the engine must refuse.
    const forced = applyIntent(s, { type: 'ultimate', fighterIndex: 0, targetIndex: 1 });
    expect(forced.players.p1.hand).not.toContain('yakon');
    expect(forced.discard).toHaveLength(2); // untouched
  });
});

describe('Namekian — Dragon Clan Ritual ownership', () => {
  it("can only recur your own KO'd Namekian, never the opponent's", () => {
    let s = makeState({ phase: 'main1' });
    s.players.p1.hand = ['dragon_clan_ritual'];
    s.players.p1.kiCurrent = 2;

    s.discard.push({ cardId: 'nail', owner: 'p1' });  // p1's own KO'd Namekian — index 0
    s.discard.push({ cardId: 'dende', owner: 'p2' }); // p2's KO'd Namekian — index 1

    const recurMoves = legalMoves(s, 'p1').filter(
      m => m.type === 'play_item' && m.cardId === 'dragon_clan_ritual'
    ) as Array<{ discardIndex?: number }>;
    expect(recurMoves.map(m => m.discardIndex)).toEqual([0]); // p2's discard entry never offered

    // Even if forced directly (bypassing legalMoves), the engine must refuse.
    const forced = applyIntent(s, { type: 'play_item', cardId: 'dragon_clan_ritual', discardIndex: 1 });
    expect(forced.players.p1.hand).not.toContain('dende');
    expect(forced.discard.some(e => e.cardId === 'dende')).toBe(true); // still sitting in discard
  });
});
