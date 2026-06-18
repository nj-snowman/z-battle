import { GameState, Intent, PlayerId, SlotType } from './types';
import { getCard } from './cards';
import { getEffectiveStats } from './buffs';
import { resolveKo, applyDamageToFighter, resolveBasicAttack, promoteFromBench, promoteSpecific } from './combat';
import { checkWinLoss } from './utils';
import { makeFighterInstance } from './setup';

export { checkWinLoss } from './utils';
export { makeFighterInstance } from './setup';

export function applyIntent(state: GameState, intent: Intent): GameState {
  if (state.winner) throw new Error('Game is already over');

  const tp = state.turnPlayer;
  const opponent: PlayerId = tp === 'p1' ? 'p2' : 'p1';
  let s = state;

  switch (intent.type) {
    case 'draw': {
      if (s.phase !== 'draw') throw new Error('Not in draw phase');
      const pile = s.players[tp].piles[intent.pile];
      if (!pile || pile.length === 0) throw new Error(`Pile ${intent.pile} is empty`);
      const [drawn, ...rest] = pile;
      const player = { ...s.players[tp] };
      player.piles = { ...player.piles, [intent.pile]: rest };
      player.hand = [...player.hand, drawn];
      s = { ...s, players: { ...s.players, [tp]: player }, phase: 'main1' };
      break;
    }

    case 'advance_phase': {
      const phaseOrder: Array<typeof s.phase> = ['draw', 'main1', 'battle', 'main2', 'end'];
      const idx = phaseOrder.indexOf(s.phase);
      if (idx === -1) throw new Error('Unknown phase');

      if (s.phase === 'end') {
        // End-of-turn: process EOT triggers, then discard to hand limit, then switch turns
        s = processEndOfTurn(s);
        // Switch turn
        const nextPlayer: PlayerId = tp === 'p1' ? 'p2' : 'p1';
        const nextPlayerState = { ...s.players[nextPlayer] };
        nextPlayerState.turnNumber = nextPlayerState.turnNumber + 1;
        nextPlayerState.kiMax = Math.min(nextPlayerState.turnNumber, 8);
        nextPlayerState.kiCurrent = nextPlayerState.kiMax;
        nextPlayerState.retreatUsedThisTurn = false;
        // Clear attacked flags and summoning sickness for next player's fighters
        nextPlayerState.actives = nextPlayerState.actives.map(f => {
          if (!f) return null;
          // If fighter has cannotAttackNextTurn, mark as hasAttackedThisTurn so they can't attack.
          // Keep 'their_next_turn' statuses (e.g. stun) alive so the badge shows during the stunned turn;
          // processEndOfTurn will clear them at the end of the stunned player's own turn.
          if (f.cannotAttackNextTurn) {
            return { ...f, hasAttackedThisTurn: true, cannotAttackNextTurn: false, summoningSick: false };
          }
          return { ...f, hasAttackedThisTurn: false, summoningSick: false, statuses: f.statuses.filter(st => st.until !== 'their_next_turn') };
        }) as typeof nextPlayerState.actives;
        nextPlayerState.bench = nextPlayerState.bench.map(f =>
          f ? { ...f, summoningSick: false } : null
        ) as typeof nextPlayerState.bench;

        s = {
          ...s,
          phase: 'draw',
          turnPlayer: nextPlayer,
          turnNumber: s.turnNumber + 1,
          players: { ...s.players, [nextPlayer]: nextPlayerState },
        };

        // Check Death Saucer follow-up damage at start of next player's turn
        s = processTurnStartEffects(s, nextPlayer);
        break;
      }

      const nextPhase = phaseOrder[idx + 1];
      s = { ...s, phase: nextPhase };
      break;
    }

    case 'play_hero': {
      if (s.phase !== 'main1' && s.phase !== 'main2') throw new Error('Cannot play hero now');
      const card = getCard(intent.cardId);
      if (card.cardType !== 'hero') throw new Error('Not a hero card');
      const player = { ...s.players[tp] };
      if (player.kiCurrent < card.kiCost) throw new Error('Not enough Ki');
      const handIdx = player.hand.indexOf(intent.cardId);
      if (handIdx === -1) throw new Error('Card not in hand');

      const slots = intent.slot === 'active' ? [...player.actives] : [...player.bench];
      if (slots[intent.index] !== null) throw new Error('Slot occupied');

      player.hand = player.hand.filter((_, i) => i !== handIdx);
      player.kiCurrent -= card.kiCost;

      let fighter = makeFighterInstance(intent.cardId);

      // Apply active field HP bonus to newly summoned fighter (e.g. Frieza's Spaceship)
      if (s.field) {
        const fieldCard = getCard(s.field);
        for (const ab of fieldCard.abilities) {
          if (ab.kind === 'field_type_buff') {
            const fp = ab.params as any;
            if (fp.hp && card.fighterType === fp.type) {
              fighter = { ...fighter, maxHp: fighter.maxHp + fp.hp, currentHp: fighter.currentHp + fp.hp };
            }
          }
        }
      }

      // triggered_on_play effects
      for (const ab of card.abilities) {
        if (ab.kind === 'triggered_on_play') {
          const p = ab.params as any;
          if (p.bonusMaxHp) {
            // Giant Namekian: +2000 max HP and current HP on entry
            fighter = { ...fighter, maxHp: fighter.maxHp + p.bonusMaxHp, currentHp: fighter.currentHp + p.bonusMaxHp };
          }
        }
      }

      if (intent.slot === 'active') {
        const newActives = [...player.actives] as typeof player.actives;
        newActives[intent.index] = fighter;
        player.actives = newActives;
      } else {
        const newBench = [...player.bench] as typeof player.bench;
        newBench[intent.index] = fighter;
        player.bench = newBench;
      }

      s = { ...s, players: { ...s.players, [tp]: player } };

      // Chiaotzu psychic_hold: stun one enemy Active on play
      for (const ab of card.abilities) {
        if (ab.kind === 'triggered_on_play') {
          const p = ab.params as any;
          if (p.effect === 'stun' && p.target === 'one_enemy_active') {
            const stunIdx = intent.stunTargetIndex ?? s.players[opponent].actives.findIndex(f => f !== null);
            if (stunIdx !== -1 && s.players[opponent].actives[stunIdx]) {
              const oppPlayer = { ...s.players[opponent] };
              const oppActives = [...oppPlayer.actives] as typeof oppPlayer.actives;
              const stunTarget = oppActives[stunIdx]!;
              oppActives[stunIdx] = {
                ...stunTarget,
                cannotAttackNextTurn: true,
                statuses: [...stunTarget.statuses, { key: 'stun', until: 'their_next_turn' as const }],
              };
              oppPlayer.actives = oppActives;
              s = { ...s, players: { ...s.players, [opponent]: oppPlayer } };
            }
          }
        }
      }
      break;
    }

    case 'play_item': {
      if (s.phase !== 'main1' && s.phase !== 'main2') throw new Error('Cannot play item now');
      const card = getCard(intent.cardId);
      if (card.cardType !== 'item') throw new Error('Not an item card');
      const player = { ...s.players[tp] };
      if (player.kiCurrent < card.kiCost) throw new Error('Not enough Ki');
      const handIdx = player.hand.indexOf(intent.cardId);
      if (handIdx === -1) throw new Error('Card not in hand');

      player.hand = player.hand.filter((_, i) => i !== handIdx);
      player.kiCurrent -= card.kiCost;
      s = { ...s, players: { ...s.players, [tp]: player } };

      // Process item abilities
      for (const ab of card.abilities) {
        s = applyItemAbility(s, tp, opponent, card.id, ab, intent.targetSide, intent.targetIndex, intent.pileChoice, intent.drawChoices, intent.enemyTargetIndex, intent.promotionIndex, intent.discardIndex);
      }

      // Consumables go to discard (unless already discarded by the ability)
      if (card.itemClass === 'consumable') {
        // Only add to discard if not already there from ability processing
        if (!s.discard.includes(intent.cardId)) {
          s = { ...s, discard: [...s.discard, intent.cardId] };
        }
      }
      break;
    }

    case 'play_field': {
      if (s.phase !== 'main1' && s.phase !== 'main2') throw new Error('Cannot play field now');
      const card = getCard(intent.cardId);
      if (card.cardType !== 'field') throw new Error('Not a field card');
      const player = { ...s.players[tp] };
      if (player.kiCurrent < 1) throw new Error('Not enough Ki');
      const handIdx = player.hand.indexOf(intent.cardId);
      if (handIdx === -1) throw new Error('Card not in hand');

      player.hand = player.hand.filter((_, i) => i !== handIdx);
      player.kiCurrent -= 1;

      // Discard old field
      const oldField = s.field;
      s = { ...s, players: { ...s.players, [tp]: player }, field: intent.cardId };
      if (oldField) s = { ...s, discard: [...s.discard, oldField] };

      // Apply HP-granting field effects
      s = applyFieldEntryEffects(s, intent.cardId);
      break;
    }

    case 'retreat': {
      if (s.phase !== 'main1') throw new Error('Can only retreat in Main Phase 1');
      const player = { ...s.players[tp] };
      if (player.retreatUsedThisTurn) throw new Error('Already retreated this turn');
      if (player.kiCurrent < 1) throw new Error('Not enough Ki');
      const active = player.actives[intent.activeIndex];
      const bench = player.bench[intent.benchIndex];
      if (!active || !bench) throw new Error('Invalid retreat: slot empty');

      player.kiCurrent -= 1;
      player.retreatUsedThisTurn = true;
      const newActives = [...player.actives] as typeof player.actives;
      const newBench = [...player.bench] as typeof player.bench;
      newActives[intent.activeIndex] = bench;
      newBench[intent.benchIndex] = active;
      player.actives = newActives;
      player.bench = newBench;
      s = { ...s, players: { ...s.players, [tp]: player } };
      break;
    }

    case 'attack': {
      if (s.phase !== 'battle') throw new Error('Not in battle phase');
      const player = s.players[tp];
      const attacker = player.actives[intent.attackerIndex];
      if (!attacker) throw new Error('No fighter in that slot');
      if (attacker.summoningSick) throw new Error('Fighter is summoning sick');
      if (attacker.hasAttackedThisTurn) throw new Error('Fighter already acted this turn');
      if (attacker.statuses.some(st => st.key === 'stun')) throw new Error('Fighter is stunned');

      const attackerStats = getEffectiveStats(attacker, 'active', intent.attackerIndex, tp, s);

      let kiNeeded = attackerStats.attackKiCost;
      let extraDamage = 0;
      let ignoreDef = false;

      // Kaioken: pay 2 extra Ki for +3000 damage
      if (intent.useKaioken) {
        const card = getCard(attacker.cardId);
        const ab = card.abilities.find(a => a.key === 'kaioken');
        if (ab) {
          kiNeeded += 2;
          extraDamage += 3000;
        }
      }

      // One-shot on-attack ability (Krillin, Future Trunks, Recoome): ignore DEF
      if (intent.useOneShotAbility) {
        const card = getCard(attacker.cardId);
        const ab = card.abilities.find(a => a.kind === 'one_shot_on_attack');
        if (ab && !attacker.oncePerGameUsed[ab.key]) {
          ignoreDef = true;
          const newActives = [...player.actives] as typeof player.actives;
          newActives[intent.attackerIndex] = {
            ...attacker,
            oncePerGameUsed: { ...attacker.oncePerGameUsed, [ab.key]: true },
          };
          s = { ...s, players: { ...s.players, [tp]: { ...player, actives: newActives } } };
        }
      }

      // Tri-Beam (Tien): pay 1000 HP, deal +2000 damage
      if (intent.useTriBeam) {
        const card = getCard(attacker.cardId);
        const ab = card.abilities.find(a => a.key === 'tri_beam');
        if (ab && !attacker.oncePerGameUsed[ab.key] && attacker.currentHp > 1000) {
          extraDamage += 2000;
          const newActives = [...player.actives] as typeof player.actives;
          const currentAttacker = (s.players[tp].actives[intent.attackerIndex])!;
          newActives[intent.attackerIndex] = {
            ...currentAttacker,
            currentHp: currentAttacker.currentHp - 1000,
            oncePerGameUsed: { ...currentAttacker.oncePerGameUsed, [ab.key]: true },
          };
          s = { ...s, players: { ...s.players, [tp]: { ...s.players[tp], actives: newActives } } };
        }
      }

      if (kiNeeded > 0 && s.players[tp].kiCurrent < kiNeeded) {
        throw new Error('Not enough Ki for attack');
      }

      s = resolveBasicAttack(s, tp, intent.attackerIndex, opponent, intent.targetIndex, {
        extraDamage,
        useIgnoreDef: ignoreDef,
      });

      s = checkWinLoss(s);
      break;
    }

    case 'ultimate': {
      if (s.phase !== 'battle') throw new Error('Not in battle phase');
      const player = s.players[tp];
      const fighter = player.actives[intent.fighterIndex];
      if (!fighter) throw new Error('No fighter in that slot');
      if (fighter.summoningSick) throw new Error('Fighter is summoning sick');
      if (fighter.hasAttackedThisTurn) throw new Error('Fighter already acted this turn');
      if (fighter.statuses.some(st => st.key === 'stun')) throw new Error('Fighter is stunned');

      const card = getCard(fighter.cardId);
      const ultAb = card.abilities.find(ab => ab.kind === 'ultimate' || ab.kind === 'activated_one_shot');
      if (!ultAb) throw new Error('Fighter has no ultimate');
      if (fighter.oncePerGameUsed[ultAb.key]) throw new Error('Ultimate already used');
      if (player.kiCurrent < 1) throw new Error('Not enough Ki');

      // Mark as used and attacked, spend 1 Ki
      const newActives = [...player.actives] as typeof player.actives;
      newActives[intent.fighterIndex] = {
        ...fighter,
        hasAttackedThisTurn: true,
        oncePerGameUsed: { ...fighter.oncePerGameUsed, [ultAb.key]: true },
      };
      s = { ...s, players: { ...s.players, [tp]: { ...player, actives: newActives, kiCurrent: player.kiCurrent - 1 } } };

      // Apply ultimate effect
      s = applyUltimate(s, tp, opponent, ultAb, intent.targetIndex);
      s = checkWinLoss(s);
      break;
    }

    case 'promote_from_bench': {
      const pending = s.pendingPromotions[0];
      if (!pending) throw new Error('No pending promotion');
      const { side, activeIndex, friezaWrathPending } = pending;
      s = { ...s, pendingPromotions: s.pendingPromotions.slice(1) };
      s = promoteSpecific(s, side, activeIndex, intent.benchIndex);
      if (friezaWrathPending) {
        const promoted = s.players[side].actives[activeIndex];
        if (promoted) s = applyDamageToFighter(s, side, 'active', activeIndex, 2000);
      }
      s = checkWinLoss(s);
      break;
    }

    case 'sacrifice': {
      if (s.turnPlayer !== tp) throw new Error('Can only sacrifice on your own turn');

      if (intent.side === 'active') {
        // Active sacrifice counts as a KO — opponent scores; bench promotion queued as pendingPromotion
        const fighter = s.players[tp].actives[intent.index];
        if (!fighter) throw new Error('No fighter in that slot');
        s = resolveKo(s, tp, 'active', intent.index, opponent);
      } else {
        // Bench sacrifice is free — no KO scored
        const player = { ...s.players[tp] };
        const benchSlots = [...player.bench];
        const fighter = benchSlots[intent.index];
        if (!fighter) throw new Error('No fighter in that slot');
        (benchSlots as Array<typeof fighter | null>)[intent.index] = null;
        player.bench = benchSlots as typeof player.bench;
        s = { ...s, players: { ...s.players, [tp]: player } };
        s = { ...s, discard: [...s.discard, fighter.cardId, ...fighter.equipment] };
      }

      break;
    }

    case 'end_turn': {
      // Advance to end phase if not already there, then process
      if (s.phase !== 'end') {
        s = { ...s, phase: 'end' };
      }
      // advance_phase from end handles EOT triggers and turn switch
      s = applyIntent(s, { type: 'advance_phase' });
      break;
    }

    default:
      throw new Error(`Unknown intent type: ${(intent as any).type}`);
  }

  return s;
}

function applyUltimate(s: GameState, tp: PlayerId, opp: PlayerId, ab: any, targetIndex?: number): GameState {
  const p = ab.params as any;
  switch (ab.key) {
    case 'spirit_bomb':
    case 'solar_kamehameha': {
      // Deal damage to all enemy Actives
      const targets = s.players[opp].actives
        .map((f, i) => (f ? i : null))
        .filter((i): i is number => i !== null);
      for (const i of [...targets]) {
        if (s.players[opp].actives[i]) {
          s = applyDamageToFighter(s, opp, 'active', i, p.damage, tp);
        }
      }
      break;
    }
    case 'final_flash':
    case 'special_beam_cannon': {
      if (targetIndex === undefined) throw new Error('Ultimate requires target');
      const target = s.players[opp].actives[targetIndex];
      if (!target) throw new Error('No target');
      s = applyDamageToFighter(s, opp, 'active', targetIndex, p.damage, tp);
      break;
    }
    case 'supernova': {
      if (targetIndex === undefined) throw new Error('Ultimate requires target');
      const target = s.players[opp].actives[targetIndex];
      if (!target) throw new Error('No target');
      s = applyDamageToFighter(s, opp, 'active', targetIndex, p.damage, tp);
      // Frieza can't attack next turn
      const player = s.players[tp];
      const friezaIdx = player.actives.findIndex(f => f && f.cardId === 'frieza');
      if (friezaIdx !== -1) {
        const f = player.actives[friezaIdx]!;
        const newActives = [...player.actives] as typeof player.actives;
        newActives[friezaIdx] = { ...f, cannotAttackNextTurn: true };
        s = { ...s, players: { ...s.players, [tp]: { ...player, actives: newActives } } };
      }
      break;
    }
    case 'body_change': {
      if (targetIndex === undefined) throw new Error('Body Change requires target');
      const player = s.players[tp];
      const ginyuIdx = player.actives.findIndex(f => f && f.cardId === 'captain_ginyu');
      if (ginyuIdx === -1) break;
      const ginyu = player.actives[ginyuIdx]!;
      const ginyuCard = getCard(ginyu.cardId);
      const target = s.players[opp].actives[targetIndex];
      if (!target) break;
      const targetCard = getCard(target.cardId);
      // Use current effective ATK (respects prior swaps)
      const ginyuAtk = ginyu.counters['swappedAtk'] ?? ginyuCard.atk ?? 0;
      const targetAtk = target.counters['swappedAtk'] ?? targetCard.atk ?? 0;
      // Write swapped values onto both fighters via counters.swappedAtk
      const newActives = [...player.actives] as typeof player.actives;
      newActives[ginyuIdx] = { ...ginyu, counters: { ...ginyu.counters, swappedAtk: targetAtk } };
      s = { ...s, players: { ...s.players, [tp]: { ...player, actives: newActives } } };
      const oppPlayer = s.players[opp];
      const newOppActives = [...oppPlayer.actives] as typeof oppPlayer.actives;
      newOppActives[targetIndex] = { ...target, counters: { ...target.counters, swappedAtk: ginyuAtk } };
      s = { ...s, players: { ...s.players, [opp]: { ...oppPlayer, actives: newOppActives } } };
      break;
    }
    case 'self_destruct_16': {
      if (targetIndex === undefined) throw new Error('Self-destruct requires target');
      // Android #16 KOs itself — opponent scores a KO point
      const player = s.players[tp];
      const fighterIdx = player.actives.findIndex(f => f && f.cardId === 'android_16');
      if (fighterIdx !== -1) {
        s = resolveKo(s, tp, 'active', fighterIdx, opp);
      }
      s = applyDamageToFighter(s, opp, 'active', targetIndex, p.damage, tp);
      break;
    }
    default:
      break;
  }
  return s;
}

function applyItemAbility(
  s: GameState,
  tp: PlayerId,
  opp: PlayerId,
  itemId: string,
  ab: any,
  targetSide?: SlotType,
  targetIndex?: number,
  pileChoice?: 'hero' | 'item' | 'field',
  drawChoices?: Array<'hero' | 'item' | 'field'>,
  enemyTargetIndex?: number,
  promotionIndex?: number,
  discardIndex?: number
): GameState {
  const p = ab.params as any;
  switch (ab.kind) {
    case 'heal': {
      if (targetSide === undefined || targetIndex === undefined) break;
      const player = { ...s.players[tp] };
      const slots = targetSide === 'active' ? [...player.actives] : [...player.bench];
      const f = slots[targetIndex];
      if (!f) break;
      (slots as Array<typeof f | null>)[targetIndex] = { ...f, currentHp: f.maxHp };
      if (targetSide === 'active') player.actives = slots as typeof player.actives;
      else player.bench = slots as typeof player.bench;
      s = { ...s, players: { ...s.players, [tp]: player } };
      break;
    }
    case 'attach_stat': {
      if (targetSide === undefined || targetIndex === undefined) break;
      const player = { ...s.players[tp] };
      const slots = targetSide === 'active' ? [...player.actives] : [...player.bench];
      const f = slots[targetIndex];
      if (!f) break;
      if (f.equipment.length >= 2) throw new Error('Equipment limit reached (max 2)');
      let newMaxHp = f.maxHp;
      let newCurrentHp = f.currentHp;
      if (p.hp) {
        newMaxHp = f.maxHp + p.hp;
        newCurrentHp = f.currentHp + p.hp;
      }
      (slots as Array<typeof f | null>)[targetIndex] = { ...f, equipment: [...f.equipment, itemId], maxHp: newMaxHp, currentHp: newCurrentHp };
      if (targetSide === 'active') player.actives = slots as typeof player.actives;
      else player.bench = slots as typeof player.bench;
      s = { ...s, players: { ...s.players, [tp]: player } };
      break;
    }
    case 'attach_trigger': {
      if (targetSide === undefined || targetIndex === undefined) break;
      const player = { ...s.players[tp] };
      const slots = targetSide === 'active' ? [...player.actives] : [...player.bench];
      const f = slots[targetIndex];
      if (!f) break;
      if (f.equipment.length >= 2) throw new Error('Equipment limit reached (max 2)');
      (slots as Array<typeof f | null>)[targetIndex] = { ...f, equipment: [...f.equipment, itemId] };
      if (targetSide === 'active') player.actives = slots as typeof player.actives;
      else player.bench = slots as typeof player.bench;
      s = { ...s, players: { ...s.players, [tp]: player } };
      break;
    }
    case 'remove_summoning_sickness': {
      if (targetSide === undefined || targetIndex === undefined) break;
      const player = { ...s.players[tp] };
      const slots = targetSide === 'active' ? [...player.actives] : [...player.bench];
      const f = slots[targetIndex];
      if (!f) break;
      if (f.equipment.length >= 2) throw new Error('Equipment limit reached (max 2)');
      (slots as Array<typeof f | null>)[targetIndex] = { ...f, equipment: [...f.equipment, itemId], summoningSick: false };
      if (targetSide === 'active') player.actives = slots as typeof player.actives;
      else player.bench = slots as typeof player.bench;
      s = { ...s, players: { ...s.players, [tp]: player } };
      break;
    }
    case 'prevent_damage': {
      // Barrier Field: attach to fighter
      if (targetSide === undefined || targetIndex === undefined) break;
      const player = { ...s.players[tp] };
      const slots = targetSide === 'active' ? [...player.actives] : [...player.bench];
      const f = slots[targetIndex];
      if (!f) break;
      if (f.equipment.length >= 2) throw new Error('Equipment limit reached (max 2)');
      (slots as Array<typeof f | null>)[targetIndex] = { ...f, equipment: [...f.equipment, itemId] };
      if (targetSide === 'active') player.actives = slots as typeof player.actives;
      else player.bench = slots as typeof player.bench;
      s = { ...s, players: { ...s.players, [tp]: player } };
      break;
    }
    case 'direct_damage': {
      if (targetIndex === undefined) break;
      s = applyDamageToFighter(s, opp, 'active', targetIndex, p.damage, tp);
      s = checkWinLoss(s);
      break;
    }
    case 'delayed_damage': {
      // Death Saucer: deal damage now, if target survives, deal follow-up next turn
      if (targetIndex === undefined) break;
      s = applyDamageToFighter(s, opp, 'active', targetIndex, p.damage, tp);
      s = checkWinLoss(s);
      // If target survived, mark it for follow-up
      const target = s.players[opp].actives[targetIndex];
      if (target && !s.winner) {
        const newActives = [...s.players[opp].actives] as typeof s.players[typeof opp]['actives'];
        newActives[targetIndex] = { ...target, statuses: [...target.statuses, { key: 'death_saucer', until: 'their_next_turn' as const }] };
        s = { ...s, players: { ...s.players, [opp]: { ...s.players[opp], actives: newActives } } };
      }
      break;
    }
    case 'draw': {
      const player = { ...s.players[tp] };
      const newPiles = { ...player.piles };
      let newHand = [...player.hand];
      if (drawChoices && drawChoices.length > 0) {
        for (const pile of drawChoices) {
          if (newPiles[pile].length > 0) {
            const [drawnCard, ...rest] = newPiles[pile];
            newPiles[pile] = rest;
            newHand = [...newHand, drawnCard];
          }
        }
      } else {
        let drawn = 0;
        for (const pile of ['hero', 'item', 'field'] as const) {
          if (drawn >= p.draw) break;
          while (drawn < p.draw && newPiles[pile].length > 0) {
            const [drawnCard, ...rest] = newPiles[pile];
            newPiles[pile] = rest;
            newHand = [...newHand, drawnCard];
            drawn++;
          }
        }
      }
      player.piles = newPiles;
      player.hand = newHand;
      s = { ...s, players: { ...s.players, [tp]: player } };
      break;
    }
    case 'reveal_and_draw': {
      // Scouter/Namekian Insight/Targeting Scope: reveal opponent hand, draw 1
      const player = { ...s.players[tp] };
      const pileOrder: Array<'hero' | 'item' | 'field'> = pileChoice
        ? [pileChoice, ...(['hero', 'item', 'field'] as const).filter(p => p !== pileChoice)]
        : ['hero', 'item', 'field'];
      for (const pile of pileOrder) {
        if (player.piles[pile].length > 0) {
          const [card, ...rest] = player.piles[pile];
          player.piles = { ...player.piles, [pile]: rest };
          player.hand = [...player.hand, card];
          break;
        }
      }
      s = { ...s, players: { ...s.players, [tp]: player } };
      break;
    }
    case 'sacrifice_for_damage': {
      // Self-Destruct Device: KO a friendly Android, deal its ATK to chosen enemy Active
      if (targetSide === undefined || targetIndex === undefined) break;
      const player = s.players[tp];
      const sacrifice = targetSide === 'active' ? player.actives[targetIndex] : player.bench[targetIndex];
      if (!sacrifice) break;
      const sacrificeStats = getEffectiveStats(sacrifice, targetSide, targetIndex, tp, s);
      const dmg = sacrificeStats.atk;
      // KO the sacrificed fighter — skip auto-promote when a specific bench choice is provided
      const skipAutoPromote = targetSide === 'active' && promotionIndex !== undefined;
      s = resolveKo(s, tp, targetSide, targetIndex, opp, undefined, skipAutoPromote);
      if (skipAutoPromote && promotionIndex !== undefined) {
        s = promoteSpecific(s, tp, targetIndex, promotionIndex);
      }
      // Deal damage to the chosen enemy active (fallback to first non-null)
      const eidx = enemyTargetIndex ?? s.players[opp].actives.findIndex(f => f !== null);
      if (eidx !== -1 && s.players[opp].actives[eidx]) {
        s = applyDamageToFighter(s, opp, 'active', eidx, dmg, tp);
      }
      s = checkWinLoss(s);
      break;
    }
    case 'recur_from_discard': {
      // Dragon Clan Ritual: return chosen KO'd Namekian from discard to hand
      const player = { ...s.players[tp] };
      const discardIdx = discardIndex ?? s.discard.findIndex(id => {
        const c = getCard(id);
        return c.cardType === 'hero' && c.fighterType === p.type;
      });
      if (discardIdx !== -1 && discardIdx < s.discard.length) {
        const returned = s.discard[discardIdx];
        const newDiscard = s.discard.filter((_, i) => i !== discardIdx);
        player.hand = [...player.hand, returned];
        s = { ...s, discard: newDiscard, players: { ...s.players, [tp]: player } };
      }
      break;
    }
    default:
      break;
  }
  return s;
}

function applyFieldEntryEffects(s: GameState, fieldId: string): GameState {
  const fieldCard = getCard(fieldId);
  for (const ab of fieldCard.abilities) {
    if (ab.kind === 'field_type_buff') {
      const p = ab.params as any;
      if (!p.hp) continue;
      // Apply HP buffs to existing fighters of that type
      for (const side of ['p1', 'p2'] as PlayerId[]) {
        const player = { ...s.players[side] };
        player.actives = player.actives.map(f => {
          if (!f) return null;
          const c = getCard(f.cardId);
          if (c.fighterType !== p.type) return f;
          return { ...f, maxHp: f.maxHp + p.hp, currentHp: f.currentHp + p.hp };
        }) as typeof player.actives;
        player.bench = player.bench.map(f => {
          if (!f) return null;
          const c = getCard(f.cardId);
          if (c.fighterType !== p.type) return f;
          return { ...f, maxHp: f.maxHp + p.hp, currentHp: f.currentHp + p.hp };
        }) as typeof player.bench;
        s = { ...s, players: { ...s.players, [side]: player } };
      }
    }
  }
  return s;
}

function processEndOfTurn(s: GameState): GameState {
  const tp = s.turnPlayer;
  let player = { ...s.players[tp] };

  // EOT heals from fighter abilities + equipment + Cooler counter
  const processActive = (f: NonNullable<typeof player.actives[0]>): NonNullable<typeof player.actives[0]> => {
    const card = getCard(f.cardId);
    let hp = f.currentHp;
    let counters = { ...f.counters };

    for (const ab of card.abilities) {
      if (ab.kind === 'triggered_end_of_turn') {
        const p = ab.params as any;
        if (p.heal && p.target !== 'one_friendly_active') {
          hp = Math.min(hp + p.heal, f.maxHp);
        }
      }
      // Cooler: gains +500 DEF per surviving turn
      if (ab.kind === 'permanent_counter') {
        const p = ab.params as any;
        if (p.defPerTurn) {
          counters = { ...counters, fifth_form: (counters.fifth_form ?? 0) + 1 };
        }
      }
    }
    // Equipment triggers
    for (const itemId of f.equipment) {
      const item = getCard(itemId);
      for (const ab of item.abilities) {
        if (ab.kind === 'attach_trigger') {
          const p = ab.params as any;
          if (p.grants === 'triggered_end_of_turn' && p.heal) {
            hp = Math.min(hp + p.heal, f.maxHp);
          }
        }
      }
    }
    return { ...f, currentHp: hp, counters };
  };

  player.actives = player.actives.map(f => f ? processActive(f) : null) as typeof player.actives;
  player.bench = player.bench.map(f => f ? processActive(f) : null) as typeof player.bench;

  // Dende healer: heal one friendly Active 1,500 (the one that isn't Dende)
  const dendeIdx = player.actives.findIndex(f => f && f.cardId === 'dende');
  if (dendeIdx !== -1) {
    const healTargetIdx = player.actives.findIndex((f, i) => i !== dendeIdx && f !== null);
    if (healTargetIdx !== -1) {
      const target = player.actives[healTargetIdx]!;
      const newActives = [...player.actives] as typeof player.actives;
      newActives[healTargetIdx] = { ...target, currentHp: Math.min(target.currentHp + 1500, target.maxHp) };
      player.actives = newActives;
    }
  }

  // Field EOT heals
  if (s.field) {
    const fieldCard = getCard(s.field);
    for (const ab of fieldCard.abilities) {
      if (ab.kind === 'field_type_heal') {
        const p = ab.params as any;
        player.actives = player.actives.map(f => {
          if (!f) return null;
          if (getCard(f.cardId).fighterType !== p.type) return f;
          return { ...f, currentHp: Math.min(f.currentHp + p.heal, f.maxHp) };
        }) as typeof player.actives;
        player.bench = player.bench.map(f => {
          if (!f) return null;
          if (getCard(f.cardId).fighterType !== p.type) return f;
          return { ...f, currentHp: Math.min(f.currentHp + p.heal, f.maxHp) };
        }) as typeof player.bench;
      } else if (ab.kind === 'field_type_buff') {
        // Planet Namek also has healEndOfTurn
        const p = ab.params as any;
        if (p.healEndOfTurn) {
          player.actives = player.actives.map(f => {
            if (!f) return null;
            if (getCard(f.cardId).fighterType !== p.type) return f;
            return { ...f, currentHp: Math.min(f.currentHp + p.healEndOfTurn, f.maxHp) };
          }) as typeof player.actives;
          player.bench = player.bench.map(f => {
            if (!f) return null;
            if (getCard(f.cardId).fighterType !== p.type) return f;
            return { ...f, currentHp: Math.min(f.currentHp + p.healEndOfTurn, f.maxHp) };
          }) as typeof player.bench;
        }
      }
    }
  }

  // Discard to hand limit of 7
  const newDiscard = [...s.discard];
  while (player.hand.length > 7) {
    const discarded = player.hand.pop()!;
    newDiscard.push(discarded);
  }

  // Clear stun statuses after the stunned player has had their turn to act
  player.actives = player.actives.map(f =>
    f ? { ...f, statuses: f.statuses.filter(st => st.until !== 'their_next_turn') } : null
  ) as typeof player.actives;
  player.bench = player.bench.map(f =>
    f ? { ...f, statuses: f.statuses.filter(st => st.until !== 'their_next_turn') } : null
  ) as typeof player.bench;

  s = { ...s, discard: newDiscard, players: { ...s.players, [tp]: player } };
  return s;
}

function processTurnStartEffects(s: GameState, tp: PlayerId): GameState {
  // Death Saucer follow-up: deal 1000 to opponents fighters that have death_saucer status
  const opp: PlayerId = tp === 'p1' ? 'p2' : 'p1';
  const oppPlayer = { ...s.players[opp] };
  const newActives = [...oppPlayer.actives] as typeof oppPlayer.actives;
  let changed = false;
  const koIndices: number[] = [];

  for (let i = 0; i < newActives.length; i++) {
    const f = newActives[i];
    if (!f) continue;
    const dsIdx = f.statuses.findIndex(st => st.key === 'death_saucer');
    if (dsIdx === -1) continue;
    const newStatuses = f.statuses.filter((_, idx) => idx !== dsIdx);
    const newHp = f.currentHp - 1000;
    changed = true;
    if (newHp <= 0) {
      newActives[i] = { ...f, currentHp: 0, statuses: newStatuses };
      koIndices.push(i);
    } else {
      newActives[i] = { ...f, currentHp: newHp, statuses: newStatuses };
    }
  }

  if (changed) {
    s = { ...s, players: { ...s.players, [opp]: { ...oppPlayer, actives: newActives } } };
    // Handle KOs from death saucer in reverse order to maintain indices
    for (const i of [...koIndices].reverse()) {
      if (s.players[opp].actives[i] && s.players[opp].actives[i]!.currentHp <= 0) {
        s = resolveKo(s, opp, 'active', i, tp);
      }
    }
    s = checkWinLoss(s);
  }
  return s;
}
