import { FighterInstance, GameState, PlayerId, CardDef } from './types';
import { getCard } from './cards';

export function cardTypesOf(card: CardDef): Set<string> {
  return new Set(card.types ?? (card.fighterType ? [card.fighterType] : []));
}

export function typesOf(fighter: FighterInstance): Set<string> {
  return cardTypesOf(getCard(fighter.cardId));
}

export function isType(fighter: FighterInstance, t: string): boolean {
  return typesOf(fighter).has(t);
}

export function classOf(card: CardDef): string | undefined {
  return card.class;
}

// Evolving a Buu is discounted by the stage already standing in the slot, so the Ki you
// spend is only what the new form costs beyond what's already there. Derived from the
// occupying card rather than a per-slot counter so a hard-cast mid-chain Buu (or one that
// retreated to the bench) is discounted the same as one that climbed the whole ladder.
export function buuEvolveCost(next: CardDef, current: CardDef): number {
  return Math.max(0, next.kiCost - (current.buuStage ?? 0));
}

// What it actually costs THIS player to play this hero right now. Only differs from the
// printed kiCost for cards carrying a `cost_modifier` ability (Gotenks's Fusion, which
// discounts 1 Ki per Goten/Kid Trunks on the field, actives and bench alike). There's no
// printed minimum — the floor is just the engine's usual 0.
export function heroPlayCost(card: CardDef, playerSide: PlayerId, state: GameState): number {
  if (isAbilityLocked(card, state)) return card.kiCost;
  const player = state.players[playerSide];
  let cost = card.kiCost;
  for (const ab of card.abilities) {
    if (ab.kind !== 'cost_modifier') continue;
    const p = ab.params as any;
    const ids: string[] = p.countCardIds ?? [];
    const onField = [...player.actives, ...player.bench].filter(
      (f): f is FighterInstance => !!f && ids.includes(f.cardId)
    ).length;
    cost -= onField * (p.reducePerFighter ?? 0);
  }
  return Math.max(0, cost);
}

// Signed ATK/DEF deltas contributed by temporary statuses on this fighter (Prank Kit).
// Status-sourced, so never silenced by a field lockout.
function statusStatMod(fighter: FighterInstance, stat: 'atk' | 'def'): number {
  let total = 0;
  for (const st of fighter.statuses) {
    if (st.key === `${stat}_debuff` && st.value !== undefined) total += st.value;
  }
  return total;
}

// True when a `field_lockout` field is in play and this card's class isn't the
// protected one — its own printed abilities (passives, triggers, activated,
// ultimates) go dark for as long as the lock holds. Equipment, items, and field
// effects are separate cards and are never affected by this.
export function isAbilityLocked(card: CardDef, state: GameState): boolean {
  if (!state.field) return false;
  const fieldCard = getCard(state.field);
  for (const ab of fieldCard.abilities) {
    if (ab.kind === 'field_lockout') {
      const p = ab.params as any;
      return classOf(card) !== p.class;
    }
  }
  return false;
}

export interface EffectiveStats {
  atk: number;
  def: number;
  hp: number; // max HP (for clamp checks)
  attackKiCost: number; // normally 1, Android #17 makes it 0
}

export function getEffectiveStats(
  fighter: FighterInstance,
  slot: 'active' | 'bench',
  index: number,
  playerSide: PlayerId,
  state: GameState,
  // Internal: set on the recursive call made while resolving a `stat_borrow`, so the
  // partner we're reading reports its OWN value instead of trying to borrow back.
  opts?: { noBorrow?: boolean }
): EffectiveStats {
  const card = getCard(fighter.cardId);
  const player = state.players[playerSide];
  const selfLocked = isAbilityLocked(card, state);

  // Base and modifiers are tracked apart because a borrowed stat (Goten/Kid Trunks)
  // replaces only the BASE — the borrower's own modifiers still layer on top, while the
  // field-class modifiers below are skipped entirely. `fieldAtk`/`fieldDef` are therefore
  // accumulated separately rather than folded in as they're found.
  let atkBase = card.atk ?? 0;
  let defBase = card.def ?? 0;
  let atk = 0; // own modifiers only, from here down
  let def = 0;
  let fieldAtk = 0;
  let fieldDef = 0;
  const hp = fighter.maxHp;
  let attackKiCost = 1;

  // Equipment stat bonuses (never locked — equipment is a separate card)
  for (const itemId of fighter.equipment) {
    const item = getCard(itemId);
    for (const ab of item.abilities) {
      if (ab.kind === 'attach_stat') {
        const p = ab.params as any;
        if (p.atk) atk += p.atk;
        if (p.def) def += p.def;
        // hp changes are reflected in maxHp, not recomputed here
      }
    }
  }

  // Temporary stat statuses (Prank Kit's -1,500 ATK)
  atk += statusStatMod(fighter, 'atk');
  def += statusStatMod(fighter, 'def');

  if (!selfLocked) {
    // Android #17 static_modifier: attackKiCost = 0
    for (const ab of card.abilities) {
      if (ab.kind === 'static_modifier') {
        const p = ab.params as any;
        if (p.attackKiCost === 0) attackKiCost = 0;
      }
    }

    // Conditional abilities on THIS fighter
    for (const ab of card.abilities) {
      if (ab.kind !== 'conditional') continue;
      const p = ab.params as any;
      // Skip grantsToOtherActive — those are processed elsewhere
      if (p.grantsToOtherActive) continue;
      if (evaluateCondition(p.condition, fighter, slot, index, playerSide, state)) {
        if (p.atk) atk += p.atk;
        if (p.def) def += p.def;
      }
    }

    // Permanent counters (key = the ability's own key, e.g. 'legendary', 'fifth_form', 'pure_evil')
    for (const ab of card.abilities) {
      if (ab.kind === 'permanent_counter') {
        const p = ab.params as any;
        if (p.atkPerKo) atk += (fighter.counters[ab.key] ?? 0) * p.atkPerKo;
        if (p.defPerTurn) def += (fighter.counters[ab.key] ?? 0) * p.defPerTurn;
      }
    }

    // Death-replacement payoff (Kid Gohan's Hidden Power): the permanent ATK counter
    // stamped on him when the effect saved his life.
    for (const ab of card.abilities) {
      if (ab.kind === 'death_replacement') {
        const p = ab.params as any;
        if (p.atkBonus) atk += (fighter.counters[ab.key] ?? 0) * p.atkBonus;
      }
    }

    // Absorb-style stacking ATK from own-KO triggers (Super Buu's Absorb)
    for (const ab of card.abilities) {
      if (ab.kind === 'triggered_on_ko') {
        const p = ab.params as any;
        if (p.onlyOnOwnKo && p.atkPerKo) atk += (fighter.counters[ab.key] ?? 0) * p.atkPerKo;
      }
    }

    // Cell-family scaling (Cell Jr.'s Cell Swarm): +ATK per OTHER in-play fighter
    // (actives + bench) sharing the same family tag.
    for (const ab of card.abilities) {
      if (ab.kind === 'family_count_buff') {
        const p = ab.params as any;
        const others = [...player.actives, ...player.bench].filter(
          (f): f is FighterInstance => !!f && f !== fighter && getCard(f.cardId).family === p.family
        );
        atk += others.length * (p.atkPerMember ?? 0);
      }
    }
  }

  // Equipment-granted own-KO stacking ATK (Assimilate) — item-sourced, never locked
  for (const itemId of fighter.equipment) {
    const item = getCard(itemId);
    for (const ab of item.abilities) {
      if (ab.kind === 'attach_trigger') {
        const p = ab.params as any;
        if (p.grants === 'triggered_on_ko' && p.onlyOnOwnKo && p.atkPerKo) {
          atk += (fighter.counters[ab.key] ?? 0) * p.atkPerKo;
        }
      }
    }
  }

  // Body-Change swap (Captain Ginyu): stored in counters.swappedAtk — a resolved
  // printed-stat swap, not an ongoing ability, so unaffected by lockout. It replaces
  // everything accumulated above, exactly as before the base/modifier split.
  if (fighter.counters['swappedAtk'] !== undefined) {
    atkBase = fighter.counters['swappedAtk'];
    atk = 0;
  }

  // Abilities from OTHER fighters (active or bench) that GRANT to this active fighter
  const checkGrantors = (grantor: FighterInstance, grantorSlot: 'active' | 'bench', grantorIdx: number) => {
    const grantorCard = getCard(grantor.cardId);
    if (isAbilityLocked(grantorCard, state)) return; // the grantor's own ability is what's disabled
    for (const ab of grantorCard.abilities) {
      if (ab.kind !== 'conditional') continue;
      const p = ab.params as any;
      if (!p.grantsToOtherActive) continue;
      if (evaluateCondition(p.condition ?? null, grantor, grantorSlot, grantorIdx, playerSide, state)) {
        const g = p.grantsToOtherActive as any;
        if (p.requiresType && !cardTypesOf(card).has(p.requiresType)) continue;
        if (g.atk) atk += g.atk;
        if (g.def) def += g.def;
      }
    }
  };

  if (slot === 'active') {
    for (let i = 0; i < player.actives.length; i++) {
      if (i === index) continue; // skip self
      const other = player.actives[i];
      if (other) checkGrantors(other, 'active', i);
    }
    for (let i = 0; i < player.bench.length; i++) {
      const benched = player.bench[i];
      if (benched) checkGrantors(benched, 'bench', i);
    }
  }

  // Field buffs — field effects are never affected by lockout (they're the field's own
  // effect). Kept in their own accumulator so a borrowed stat can ignore them: Goten swings
  // with Purple Trunks's ATK, so he neither gains nor suffers a Green ATK field modifier.
  if (state.field) {
    const fieldCard = getCard(state.field);
    for (const ab of fieldCard.abilities) {
      if (ab.kind === 'field_class_buff') {
        const p = ab.params as any;
        if (classOf(card) === p.class) {
          if (p.atk) fieldAtk += p.atk;
          if (p.def) fieldDef += p.def;
          // hp changes are baked into maxHp at field entry/exit, not recomputed here
        }
      } else if (ab.kind === 'field_rainbow_buff') {
        const p = ab.params as any;
        const distinctColors = new Set(
          [...player.actives, ...player.bench]
            .filter((f): f is FighterInstance => !!f)
            .map(f => classOf(getCard(f.cardId)))
            .filter(Boolean)
        ).size;
        fieldAtk += distinctColors * (p.atkPerColor ?? 0);
      }
    }
  }

  // Live stat-borrowing (Goten's Best Friends / Kid Trunks's Rival Spirit): while both
  // partners are this player's Actives, one reads the OTHER's live effective stat in place
  // of its own base — equipment and field buffs on the partner carry across. This stays
  // acyclic because Goten only ever borrows ATK and Trunks only ever borrows DEF, so the
  // stat we read from the partner is never itself borrowed; `noBorrow` enforces that on
  // the recursive call rather than relying on the data staying well-behaved.
  let borrowedAtk: number | null = null;
  let borrowedDef: number | null = null;
  if (!selfLocked && !opts?.noBorrow && slot === 'active') {
    for (const ab of card.abilities) {
      if (ab.kind !== 'stat_borrow') continue;
      const p = ab.params as any;
      const partnerIdx = player.actives.findIndex((f, i) => i !== index && !!f && f.cardId === p.partner);
      if (partnerIdx === -1) continue; // benched, KO'd or never played — both revert to printed
      const partner = player.actives[partnerIdx]!;
      const partnerStats = getEffectiveStats(partner, 'active', partnerIdx, playerSide, state, { noBorrow: true });
      if (p.stat === 'atk') borrowedAtk = partnerStats.atk;
      else if (p.stat === 'def') borrowedDef = partnerStats.def;
    }
  }

  const finalAtk = Math.max(0, borrowedAtk !== null ? borrowedAtk + atk : atkBase + atk + fieldAtk);
  // DEF floors at 0 too — Pilaf's Castle is the first field to hand out a negative, and a
  // negative DEF would silently amplify incoming damage rather than just removing armour.
  const finalDef = Math.max(0, borrowedDef !== null ? borrowedDef + def : defBase + def + fieldDef);

  return { atk: finalAtk, def: finalDef, hp, attackKiCost };
}

export function evaluateCondition(
  condition: string | null,
  fighter: FighterInstance,
  slot: 'active' | 'bench',
  index: number,
  playerSide: PlayerId,
  state: GameState
): boolean {
  if (!condition) return true;
  const player = state.players[playerSide];

  const anotherOwnActiveIsType = condition.match(/^another_own_active_is_(.+)$/);
  if (anotherOwnActiveIsType) {
    const type = anotherOwnActiveIsType[1];
    const actives = player.actives;
    for (let i = 0; i < actives.length; i++) {
      if (i === index && slot === 'active') continue;
      const other = actives[i];
      if (other && cardTypesOf(getCard(other.cardId)).has(type)) return true;
    }
    return false;
  }

  switch (condition) {
    case 'self_at_or_below_half_hp':
      return fighter.currentHp <= Math.floor(fighter.maxHp / 2);
    case 'self_at_or_above_half_hp':
      return fighter.currentHp >= Math.ceil(fighter.maxHp / 2);
    case 'self_at_full_hp':
      return fighter.currentHp === fighter.maxHp;
    case 'only_own_fighter_in_play':
      // Pan's Feisty — she has to be the player's ENTIRE board, bench included.
      return [...player.actives, ...player.bench].filter(f => f !== null).length === 1;
    case 'own_bench_empty':
      return player.bench.every(b => b === null);
    case 'own_bench_full':
      return player.bench.every(b => b !== null);
    case 'goku_is_own_active': {
      return player.actives.some(a => a && a.cardId === 'goku');
    }
    case 'friendly_saiyan_koed_this_game':
      return player.friendlySaiyanKoedThisGame;
    case 'target_tier_is_basic':
      // This condition is checked during attack resolution with target context, not here
      return false;
    default:
      return false;
  }
}
