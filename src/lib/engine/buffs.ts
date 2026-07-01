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
  state: GameState
): EffectiveStats {
  const card = getCard(fighter.cardId);
  const player = state.players[playerSide];

  let atk = card.atk ?? 0;
  let def = card.def ?? 0;
  const hp = fighter.maxHp;
  let attackKiCost = 1;

  // Equipment stat bonuses
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

  // Absorb-style stacking ATK from own-KO triggers (Super Buu's Absorb)
  for (const ab of card.abilities) {
    if (ab.kind === 'triggered_on_ko') {
      const p = ab.params as any;
      if (p.onlyOnOwnKo && p.atkPerKo) atk += (fighter.counters[ab.key] ?? 0) * p.atkPerKo;
    }
  }

  // Equipment-granted own-KO stacking ATK (Assimilate)
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

  // Body-Change swap (Captain Ginyu): stored in counters.swappedAtk
  if (fighter.counters['swappedAtk'] !== undefined) {
    atk = fighter.counters['swappedAtk'];
  }

  // Abilities from OTHER fighters (active or bench) that GRANT to this active fighter
  const checkGrantors = (grantor: FighterInstance, grantorSlot: 'active' | 'bench', grantorIdx: number) => {
    const grantorCard = getCard(grantor.cardId);
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

  // Field buffs
  if (state.field) {
    const fieldCard = getCard(state.field);
    for (const ab of fieldCard.abilities) {
      if (ab.kind === 'field_flat_buff') {
        const p = ab.params as any;
        if (p.allFighters?.def) def += p.allFighters.def;
        if (p.allFighters?.atk) atk += p.allFighters.atk;
      } else if (ab.kind === 'field_type_buff') {
        const p = ab.params as any;
        if (cardTypesOf(card).has(p.type)) {
          if (p.atk) atk += p.atk;
          if (p.def) def += p.def;
        }
      }
    }
  }

  return { atk, def, hp, attackKiCost };
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
  const card = getCard(fighter.cardId);

  switch (condition) {
    case 'self_at_or_below_half_hp':
      return fighter.currentHp <= Math.floor(fighter.maxHp / 2);
    case 'self_at_full_hp':
      return fighter.currentHp === fighter.maxHp;
    case 'own_bench_empty':
      return player.bench.every(b => b === null);
    case 'own_bench_full':
      return player.bench.every(b => b !== null);
    case 'another_own_active_is_namekian': {
      const actives = player.actives;
      for (let i = 0; i < actives.length; i++) {
        if (i === index && slot === 'active') continue;
        const other = actives[i];
        if (other && cardTypesOf(getCard(other.cardId)).has('namekian')) return true;
      }
      return false;
    }
    case 'another_own_active_is_frieza_force': {
      const actives = player.actives;
      for (let i = 0; i < actives.length; i++) {
        if (i === index && slot === 'active') continue;
        const other = actives[i];
        if (other && cardTypesOf(getCard(other.cardId)).has('frieza_force')) return true;
      }
      return false;
    }
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
