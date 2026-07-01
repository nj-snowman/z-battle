import { GameState, PlayerId, PendingPromotion } from './types';
import { getCard } from './cards';
import { getEffectiveStats } from './buffs';
import { checkWinLoss } from './utils';

// Produce a new state after a fighter at (side, slot, index) is KO'd.
export function resolveKo(
  state: GameState,
  koDSide: PlayerId,     // player whose fighter is being KO'd
  slot: 'active' | 'bench',
  index: number,
  attackerSide: PlayerId,
  attackerIndex?: number, // index in actives of the fighter that scored the KO
  skipAutoPromote?: boolean
): GameState {
  let s = { ...state, players: { ...state.players } };
  let koPlayer = { ...s.players[koDSide] };
  s.players = { ...s.players, [koDSide]: koPlayer };

  const slots = slot === 'active' ? [...koPlayer.actives] : [...koPlayer.bench];
  const fighter = slots[index];
  if (!fighter) return s;

  const card = getCard(fighter.cardId);

  // Remove from board
  if (slot === 'active') {
    koPlayer = { ...koPlayer, actives: [...koPlayer.actives] };
    (koPlayer.actives as Array<typeof fighter | null>)[index] = null;
  } else {
    koPlayer = { ...koPlayer, bench: [...koPlayer.bench] };
    (koPlayer.bench as Array<typeof fighter | null>)[index] = null;
  }
  s.players = { ...s.players, [koDSide]: koPlayer };

  // Discard fighter + equipment
  s.discard = [...s.discard, fighter.cardId, ...fighter.equipment];

  // Increment koScoredAgainst for the KO'd player
  koPlayer = { ...s.players[koDSide], koScoredAgainst: s.players[koDSide].koScoredAgainst + 1 };
  s.players = { ...s.players, [koDSide]: koPlayer };

  // The Buu evolve chain is gone once its slot empties via a KO — a future hard-cast starts fresh
  if (card.subtype === 'buu') {
    if (slot === 'active') {
      const counts = [...koPlayer.activeBuuCounts] as [number, number];
      counts[index] = 0;
      koPlayer = { ...koPlayer, activeBuuCounts: counts };
    } else {
      const counts = [...koPlayer.benchBuuCounts] as [number, number];
      counts[index] = 0;
      koPlayer = { ...koPlayer, benchBuuCounts: counts };
    }
    s.players = { ...s.players, [koDSide]: koPlayer };
  }

  // Track Nappa Rampage: if a Saiyan was KO'd, mark for the player who LOST the Saiyan
  if (card.fighterType === 'saiyan') {
    const updatedKoPlayer = { ...s.players[koDSide], friendlySaiyanKoedThisGame: true };
    s.players = { ...s.players, [koDSide]: updatedKoPlayer };
  }

  // Trigger Broly Legendary for BOTH players (any KO)
  s = triggerLegendaryCounters(s);

  // Trigger on-KO abilities of the KO'd fighter
  for (const ab of card.abilities) {
    if (ab.kind === 'triggered_on_ko') {
      const p = ab.params as any;
      if (p.damageToKoer && attackerIndex !== undefined) {
        // Saibaman: deal damage to the attacker
        s = applyDamageToFighter(s, attackerSide, 'active', attackerIndex, p.damageToKoer);
      }
    }
  }

  // Trigger Cell Bio-Absorption: heal when Cell scores a KO
  s = triggerBioAbsorption(s, attackerSide);

  // Trigger Super Buu's Absorb / Assimilate: stacking ATK when THIS fighter scores a KO
  s = triggerAbsorb(s, attackerSide, attackerIndex);

  // Queue a pending promotion instead of auto-promoting — lets the player choose which bench card to send in.
  // Emperor's Wrath damage fires after the player confirms their choice (handled in promote_from_bench).
  if (slot === 'active' && !skipAutoPromote) {
    const hasBench = s.players[koDSide].bench.some(b => b !== null);
    if (hasBench) {
      const entry: PendingPromotion = {
        side: koDSide,
        activeIndex: index,
        friezaWrathPending: hasFriezaWrathTrigger(s, attackerSide, attackerIndex),
        daburaStunPending: hasDaburaStunTrigger(s, attackerSide, attackerIndex),
      };
      s = { ...s, pendingPromotions: [...s.pendingPromotions, entry] };
    }
  }

  return s;
}

function hasDaburaStunTrigger(s: GameState, attackerSide: PlayerId, attackerIndex?: number): boolean {
  if (attackerIndex === undefined) return false;
  const attacker = s.players[attackerSide].actives[attackerIndex];
  return !!attacker && attacker.cardId === 'dabura';
}

function triggerAbsorb(s: GameState, scoringSide: PlayerId, attackerIndex?: number): GameState {
  if (attackerIndex === undefined) return s;
  const player = s.players[scoringSide];
  const f = player.actives[attackerIndex];
  if (!f) return s;

  const card = getCard(f.cardId);
  const counters = { ...f.counters };
  let changed = false;

  for (const ab of card.abilities) {
    if (ab.kind === 'triggered_on_ko') {
      const p = ab.params as any;
      if (p.onlyOnOwnKo && p.atkPerKo) {
        counters[ab.key] = (counters[ab.key] ?? 0) + 1;
        changed = true;
      }
    }
  }

  for (const itemId of f.equipment) {
    const item = getCard(itemId);
    for (const ab of item.abilities) {
      if (ab.kind === 'attach_trigger') {
        const p = ab.params as any;
        if (p.grants === 'triggered_on_ko' && p.onlyOnOwnKo && p.atkPerKo) {
          counters[ab.key] = (counters[ab.key] ?? 0) + 1;
          changed = true;
        }
      }
    }
  }

  if (changed) {
    const newActives = [...player.actives] as typeof player.actives;
    newActives[attackerIndex] = { ...f, counters };
    s = { ...s, players: { ...s.players, [scoringSide]: { ...player, actives: newActives } } };
  }
  return s;
}

function triggerLegendaryCounters(s: GameState): GameState {
  // Broly gets +500 ATK per KO (counters[ab.key]); Kid Buu's Pure Evil also grows maxHp/currentHp per KO
  for (const side of ['p1', 'p2'] as PlayerId[]) {
    let player = s.players[side];

    const bump = (f: NonNullable<typeof player.actives[0]>) => {
      const card = getCard(f.cardId);
      let updated = f;
      for (const ab of card.abilities) {
        if (ab.kind !== 'permanent_counter') continue;
        const p = ab.params as any;
        if (p.trigger !== 'any_ko') continue;
        if (p.atkPerKo) {
          updated = { ...updated, counters: { ...updated.counters, [ab.key]: (updated.counters[ab.key] ?? 0) + 1 } };
        }
        if (p.hpPerKo) {
          updated = { ...updated, maxHp: updated.maxHp + p.hpPerKo, currentHp: updated.currentHp + p.hpPerKo };
        }
      }
      return updated;
    };

    const newActives = [...player.actives] as typeof player.actives;
    let activesChanged = false;
    for (let i = 0; i < player.actives.length; i++) {
      const f = player.actives[i];
      if (!f) continue;
      const updated = bump(f);
      if (updated !== f) { newActives[i] = updated; activesChanged = true; }
    }
    const newBench = [...player.bench] as typeof player.bench;
    let benchChanged = false;
    for (let i = 0; i < player.bench.length; i++) {
      const f = player.bench[i];
      if (!f) continue;
      const updated = bump(f);
      if (updated !== f) { newBench[i] = updated; benchChanged = true; }
    }
    if (activesChanged || benchChanged) {
      player = {
        ...player,
        actives: activesChanged ? newActives : player.actives,
        bench: benchChanged ? newBench : player.bench,
      };
      s = { ...s, players: { ...s.players, [side]: player } };
    }
  }
  return s;
}

function triggerBioAbsorption(s: GameState, scoringSide: PlayerId): GameState {
  const player = s.players[scoringSide];
  const newActives = [...player.actives] as typeof player.actives;
  let changed = false;
  for (let i = 0; i < player.actives.length; i++) {
    const f = player.actives[i];
    if (!f) continue;
    const card = getCard(f.cardId);
    for (const ab of card.abilities) {
      if (ab.kind === 'triggered_on_ko' && (ab.params as any).onlyOnOwnKo) {
        const p = ab.params as any;
        if (p.heal) {
          const healed = Math.min(f.currentHp + p.heal, f.maxHp);
          newActives[i] = { ...f, currentHp: healed };
          changed = true;
        }
      }
    }
  }
  if (changed) {
    s = { ...s, players: { ...s.players, [scoringSide]: { ...player, actives: newActives } } };
  }
  return s;
}

function hasFriezaWrathTrigger(s: GameState, attackerSide: PlayerId, attackerIndex?: number): boolean {
  const player = s.players[attackerSide];
  const toCheck = attackerIndex !== undefined
    ? [player.actives[attackerIndex]]
    : player.actives;
  for (const f of toCheck) {
    if (!f) continue;
    const card = getCard(f.cardId);
    for (const ab of card.abilities) {
      if (ab.kind === 'triggered_on_ko' && (ab.params as any).onlyOnOwnKo) {
        const p = ab.params as any;
        if (p.damageToPromoted) return true;
      }
    }
  }
  return false;
}

export function promoteFromBench(s: GameState, side: PlayerId, emptyActiveIndex: number): GameState {
  const player = { ...s.players[side] };
  const newBench = [...player.bench] as typeof player.bench;
  const newActives = [...player.actives] as typeof player.actives;

  // Find first non-null bench slot
  const benchIdx = newBench.findIndex(b => b !== null);
  if (benchIdx === -1) return { ...s, players: { ...s.players, [side]: player } };

  const promoted = newBench[benchIdx]!;
  newBench[benchIdx] = null;
  newActives[emptyActiveIndex] = promoted;

  return {
    ...s,
    players: {
      ...s.players,
      [side]: { ...player, actives: newActives, bench: newBench },
    },
  };
}

export function promoteSpecific(s: GameState, side: PlayerId, emptyActiveIndex: number, benchIndex: number): GameState {
  const player = { ...s.players[side] };
  const newBench = [...player.bench] as typeof player.bench;
  const newActives = [...player.actives] as typeof player.actives;
  const promoted = newBench[benchIndex];
  if (!promoted) return promoteFromBench(s, side, emptyActiveIndex); // fallback
  newBench[benchIndex] = null;
  newActives[emptyActiveIndex] = promoted;
  return { ...s, players: { ...s.players, [side]: { ...player, actives: newActives, bench: newBench } } };
}

export function applyDamageToFighter(
  s: GameState,
  side: PlayerId,
  slot: 'active' | 'bench',
  index: number,
  damage: number,
  attackerSide?: PlayerId,
  attackerIndex?: number
): GameState {
  const player = { ...s.players[side] };
  const slots = slot === 'active' ? [...player.actives] : [...player.bench];
  const fighter = slots[index];
  if (!fighter) return s;

  // Check Barrier Field: prevent up to 2000 damage
  let actualDamage = damage;
  const barrierIdx = fighter.equipment.findIndex(id => id === 'barrier_field');
  let newEquipment = [...fighter.equipment];
  if (barrierIdx !== -1) {
    const prevented = Math.min(actualDamage, 2000);
    actualDamage -= prevented;
    newEquipment = newEquipment.filter((_, i) => i !== barrierIdx);
    s = { ...s, discard: [...s.discard, 'barrier_field'] };
  }

  const newHp = Math.max(0, fighter.currentHp - actualDamage);
  const updatedFighter = { ...fighter, currentHp: newHp, equipment: newEquipment };

  const updatedSlots = [...(slot === 'active' ? s.players[side].actives : s.players[side].bench)] as typeof player.actives;
  updatedSlots[index] = updatedFighter;

  const updatedPlayer = slot === 'active'
    ? { ...s.players[side], actives: updatedSlots }
    : { ...s.players[side], bench: updatedSlots as typeof player.bench };

  s = { ...s, players: { ...s.players, [side]: updatedPlayer } };

  // Trigger on-deal-damage heals (Android #19, Dr. Gero)
  if (attackerSide !== undefined && attackerIndex !== undefined && actualDamage > 0) {
    s = triggerOnDealDamage(s, attackerSide, attackerIndex, actualDamage);
  }

  // Check if fighter is KO'd
  if (newHp <= 0 && attackerSide !== undefined) {
    s = resolveKo(s, side, slot, index, attackerSide, attackerIndex);
  }

  return s;
}

function triggerOnDealDamage(s: GameState, attackerSide: PlayerId, attackerIndex: number, damageDealt: number): GameState {
  if (damageDealt <= 0) return s;
  const player = s.players[attackerSide];
  const f = player.actives[attackerIndex];
  if (!f) return s;

  const card = getCard(f.cardId);
  let heal = 0;

  for (const ab of card.abilities) {
    if (ab.kind === 'triggered_on_deal_damage') {
      heal += (ab.params as any).heal ?? 0;
    }
  }
  // Equipment: Energy Absorption
  for (const itemId of f.equipment) {
    const item = getCard(itemId);
    for (const ab of item.abilities) {
      if (ab.kind === 'attach_trigger') {
        const p = ab.params as any;
        if (p.grants === 'triggered_on_deal_damage') {
          heal += p.heal ?? 0;
        }
      }
    }
  }

  if (heal > 0) {
    const newHp = Math.min(f.currentHp + heal, f.maxHp);
    const newActives = [...player.actives] as typeof player.actives;
    newActives[attackerIndex] = { ...f, currentHp: newHp };
    s = { ...s, players: { ...s.players, [attackerSide]: { ...player, actives: newActives } } };
  }
  return s;
}

export function resolveBasicAttack(
  s: GameState,
  attackerSide: PlayerId,
  attackerIndex: number,
  targetSide: PlayerId,
  targetIndex: number,
  options?: { useKaioken?: boolean; useIgnoreDef?: boolean; extraDamage?: number }
): GameState {
  const player = s.players[attackerSide];
  const attacker = player.actives[attackerIndex];
  if (!attacker) return s;

  const targetPlayer = s.players[targetSide];
  const target = targetPlayer.actives[targetIndex];
  if (!target) return s;

  const attackerStats = getEffectiveStats(attacker, 'active', attackerIndex, attackerSide, s);
  const targetStats = getEffectiveStats(target, 'active', targetIndex, targetSide, s);

  let atkValue = attackerStats.atk;

  // Raditz/Dodoria "target_tier_is_basic" conditional
  const targetCard = getCard(target.cardId);
  for (const ab of getCard(attacker.cardId).abilities) {
    if (ab.kind === 'conditional') {
      const p = ab.params as any;
      if (p.condition === 'target_tier_is_basic' && targetCard.tier === 'basic') {
        atkValue += p.atk ?? 0;
      }
    }
  }

  const defValue = options?.useIgnoreDef ? 0 : targetStats.def;

  // Field flat damage bonus
  let fieldBonus = 0;
  if (s.field) {
    const fieldCard = getCard(s.field);
    for (const ab of fieldCard.abilities) {
      if (ab.kind === 'field_flat_damage') {
        fieldBonus += (ab.params as any).allAttacksBonusDamage ?? 0;
      }
    }
  }

  const rawDamage = atkValue - defValue;
  let damage = Math.max(rawDamage, 500) + fieldBonus + (options?.extraDamage ?? 0);

  // First attack of the game: 50% damage rounded up to nearest 500
  if (!s.firstAttackDone) {
    damage = Math.ceil(damage * 0.5 / 500) * 500;
    s = { ...s, firstAttackDone: true };
  }

  // Mark fighter as having attacked
  const newActives = [...player.actives] as typeof player.actives;
  newActives[attackerIndex] = { ...attacker, hasAttackedThisTurn: true };
  s = { ...s, players: { ...s.players, [attackerSide]: { ...player, actives: newActives } } };

  // Spend Ki (unless Android #17's endless_energy)
  const kiCost = attackerStats.attackKiCost;
  if (kiCost > 0) {
    const pl = s.players[attackerSide];
    s = { ...s, players: { ...s.players, [attackerSide]: { ...pl, kiCurrent: pl.kiCurrent - kiCost } } };
  }

  // Apply damage
  s = applyDamageToFighter(s, targetSide, 'active', targetIndex, damage, attackerSide, attackerIndex);

  s = checkWinLoss(s);

  return s;
}
