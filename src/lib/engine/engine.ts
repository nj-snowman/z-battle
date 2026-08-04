import { GameState, Intent, PlayerId, SlotType, FighterInstance, CardDef } from './types';
import { getCard } from './cards';
import { getEffectiveStats, cardTypesOf, classOf, isAbilityLocked, buuEvolveCost, heroPlayCost } from './buffs';
import { resolveKo, applyDamageToFighter, resolveBasicAttack, promoteFromBench, promoteSpecific, boostedAbilityDamage, findFriezaWrathOwner, GHOST_COUNTER } from './combat';
import { checkWinLoss, checkTie } from './utils';
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
        // Clear attacked flags and summoning sickness for next player's fighters
        nextPlayerState.actives = nextPlayerState.actives.map(f => {
          if (!f) return null;
          // If fighter has cannotAttackNextTurn (e.g. Frieza post-Supernova), mark as fully stunned
          // for their next turn: can't attack, can't retreat, stun badge shows.
          // processEndOfTurn clears the stun status + cannotRetreatThisTurn at the end of that turn.
          if (f.cannotAttackNextTurn) {
            return {
              ...f,
              hasAttackedThisTurn: true,
              cannotAttackNextTurn: false,
              cannotRetreatThisTurn: true,
              statuses: [...f.statuses, { key: 'stun', until: 'their_next_turn' as const }],
              summoningSick: false,
            };
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
        // Catches the 10-turns-each no-KO tie the instant it's reached, rather than
        // waiting for some later damage-dealing intent to happen to re-check it. Uses
        // the narrow tie-only check, not the full checkWinLoss — its empty-board rule
        // would misfire here against a board that's simply not deployed yet.
        s = checkTie(s);
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
      // Board-state cost reduction (Gotenks's Fusion) — normally just the printed cost.
      const playCost = heroPlayCost(card, tp, s);
      if (player.kiCurrent < playCost) throw new Error('Not enough Ki');
      const handIdx = player.hand.indexOf(intent.cardId);
      if (handIdx === -1) throw new Error('Card not in hand');

      const slots = intent.slot === 'active' ? [...player.actives] : [...player.bench];
      if (slots[intent.index] !== null) throw new Error('Slot occupied');
      if (intent.slot === 'bench' && !player.actives.every(f => f !== null)) {
        throw new Error('Both active slots must be filled before benching a hero');
      }

      player.hand = player.hand.filter((_, i) => i !== handIdx);
      player.kiCurrent -= playCost;

      let fighter = makeFighterInstance(intent.cardId);

      // Apply active field HP bonus to newly summoned fighter (e.g. Frieza's Spaceship)
      const fieldHpBonus = activeFieldHpBonusFor(s, card);
      if (fieldHpBonus) {
        fighter = { ...fighter, maxHp: fighter.maxHp + fieldHpBonus, currentHp: fighter.currentHp + fieldHpBonus };
      }

      // triggered_on_play effects — disabled if this hero's class is locked out by the active field
      if (!isAbilityLocked(card, s)) {
        for (const ab of card.abilities) {
          if (ab.kind === 'triggered_on_play') {
            const p = ab.params as any;
            if (p.bonusMaxHp) {
              // Giant Namekian: +2000 max HP and current HP on entry
              fighter = { ...fighter, maxHp: fighter.maxHp + p.bonusMaxHp, currentHp: fighter.currentHp + p.bonusMaxHp };
            }
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

      // Chiaotzu psychic_hold: stun one enemy Active on play — disabled while locked out
      for (const ab of (isAbilityLocked(card, s) ? [] : card.abilities)) {
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

    case 'evolve': {
      if (s.phase !== 'main1' && s.phase !== 'main2') throw new Error('Cannot evolve now');
      const card = getCard(intent.cardId);
      if (card.cardType !== 'hero' || card.subtype !== 'buu') throw new Error('Not a Buu card');
      const player = { ...s.players[tp] };
      const handIdx = player.hand.indexOf(intent.cardId);
      if (handIdx === -1) throw new Error('Card not in hand');

      const slots = intent.slotSide === 'active' ? player.actives : player.bench;
      const prev = slots[intent.slotIndex];
      if (!prev) throw new Error('Slot is empty');
      const prevCard = getCard(prev.cardId);
      if (prevCard.subtype !== 'buu') throw new Error('Slot does not hold a Buu');
      if ((card.buuStage ?? 0) <= (prevCard.buuStage ?? 0)) throw new Error('Must evolve to a higher Buu stage');

      const cost = buuEvolveCost(card, prevCard);
      if (player.kiCurrent < cost) throw new Error('Not enough Ki');

      player.hand = player.hand.filter((_, i) => i !== handIdx);
      player.kiCurrent -= cost;

      // Re-apply carried equipment's HP bonus and the active field's HP bonus to the
      // new base HP — don't double-count against prev.maxHp.
      let maxHp = card.hp!;
      for (const itemId of prev.equipment) {
        const item = getCard(itemId);
        for (const ab of item.abilities) {
          if (ab.kind === 'attach_stat') {
            const ip = ab.params as any;
            if (ip.hp) maxHp += ip.hp;
          }
        }
      }
      maxHp += activeFieldHpBonusFor(s, card);
      const damageTaken = prev.maxHp - prev.currentHp;
      const currentHp = Math.max(1, maxHp - damageTaken);

      // Counters: equipment-granted own-KO counters (e.g. Assimilate) carry; intrinsic counters (e.g. Absorb) reset.
      const counters: Record<string, number> = {};
      for (const itemId of prev.equipment) {
        const item = getCard(itemId);
        for (const ab of item.abilities) {
          if (ab.kind === 'attach_trigger') {
            const ip = ab.params as any;
            if (ip.grants === 'triggered_on_ko' && ip.onlyOnOwnKo && prev.counters[ab.key] !== undefined) {
              counters[ab.key] = prev.counters[ab.key];
            }
          }
        }
      }

      const oncePerGameUsed: Record<string, boolean> = {};
      for (const ab of card.abilities) {
        if (ab.oncePerGame) oncePerGameUsed[ab.key] = false;
      }

      const newFighter: FighterInstance = {
        cardId: intent.cardId,
        maxHp,
        currentHp,
        equipment: prev.equipment,
        summoningSick: true,
        hasAttackedThisTurn: false,
        oncePerGameUsed,
        counters,
        statuses: [],
      };

      if (intent.slotSide === 'active') {
        const newActives = [...player.actives] as typeof player.actives;
        newActives[intent.slotIndex] = newFighter;
        player.actives = newActives;
      } else {
        const newBench = [...player.bench] as typeof player.bench;
        newBench[intent.slotIndex] = newFighter;
        player.bench = newBench;
      }

      // Not a KO — no score, no on-KO triggers. The old card just goes to discard.
      s = { ...s, discard: [...s.discard, { cardId: prev.cardId, owner: tp }], players: { ...s.players, [tp]: player } };
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
        s = applyItemAbility(s, tp, opponent, card.id, ab, intent.targetSide, intent.targetIndex, intent.pileChoice, intent.drawChoices, intent.enemyTargetIndex, intent.promotionIndex, intent.discardIndex, intent.tutorCardId);
      }

      // Consumables go to discard (unless already discarded by the ability)
      if (card.itemClass === 'consumable') {
        // Only add to discard if not already there from ability processing
        if (!s.discard.some((e) => e.cardId === intent.cardId)) {
          s = { ...s, discard: [...s.discard, { cardId: intent.cardId, owner: tp }] };
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
      if (oldField) s = { ...s, discard: [...s.discard, { cardId: oldField, owner: tp }] };

      // Remove the outgoing field's HP bonus before granting the new field's — HP
      // buffs are baked into maxHp/currentHp directly, unlike ATK/DEF which are
      // recomputed live from state.field and vanish on their own.
      if (oldField) s = removeFieldExitEffects(s, oldField);

      // Apply HP-granting field effects
      s = applyFieldEntryEffects(s, intent.cardId);
      break;
    }

    case 'retreat': {
      if (s.phase !== 'main1') throw new Error('Can only retreat in Main Phase 1');
      const player = { ...s.players[tp] };
      if (player.kiCurrent < 1) throw new Error('Not enough Ki');
      const active = player.actives[intent.activeIndex];
      const bench = player.bench[intent.benchIndex];
      if (!active || !bench) throw new Error('Invalid retreat: slot empty');
      if (active.cannotRetreatThisTurn) throw new Error('Fighter cannot retreat this turn');

      player.kiCurrent -= 1;
      const newActives = [...player.actives] as typeof player.actives;
      const newBench = [...player.bench] as typeof player.bench;
      // The fighter coming in off the bench takes over the slot's one retreat for
      // the turn — it can't immediately retreat back out (cleared at end of turn).
      newActives[intent.activeIndex] = { ...bench, cannotRetreatThisTurn: true };
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
      const attackerCardForLock = getCard(attacker.cardId);
      const attackerLocked = isAbilityLocked(attackerCardForLock, s);

      let kiNeeded = attackerStats.attackKiCost;
      let extraDamage = 0;
      let ignoreDef = false;

      // Kaioken: pay 2 extra Ki for +3000 damage — disabled while locked out
      if (intent.useKaioken && !attackerLocked) {
        const card = getCard(attacker.cardId);
        const ab = card.abilities.find(a => a.key === 'kaioken');
        if (ab) {
          kiNeeded += 2;
          extraDamage += 3000;
        }
      }

      // One-shot on-attack ability (Krillin, Future Trunks, Recoome): ignore DEF — disabled while locked out
      if (intent.useOneShotAbility && !attackerLocked) {
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

      // Tri-Beam (Tien): pay 1000 HP, deal +2000 damage — disabled while locked out
      if (intent.useTriBeam && !attackerLocked) {
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
      const player = s.players[tp];
      const fighter = player.actives[intent.fighterIndex];
      if (!fighter) throw new Error('No fighter in that slot');

      const card = getCard(fighter.cardId);
      if (isAbilityLocked(card, s)) throw new Error('Ability is locked by the active field');
      const ultAb = card.abilities.find(ab => ab.kind === 'ultimate' || ab.kind === 'activated_one_shot');
      if (!ultAb) throw new Error('Fighter has no ultimate');
      const ultParams = ultAb.params as any;

      // Abilities flagged usableInMainPhase (e.g. Bibidi's Creation) can also be used
      // outside Battle; everything else remains battle-only.
      if (s.phase !== 'battle' && !(ultParams.usableInMainPhase && (s.phase === 'main1' || s.phase === 'main2'))) {
        throw new Error('Not in battle phase');
      }
      // doesNotConsumeAttack abilities don't count as the fighter's action for the turn,
      // so using one neither requires nor blocks a subsequent attack.
      if (fighter.hasAttackedThisTurn && !ultParams.doesNotConsumeAttack) {
        throw new Error('Fighter already acted this turn');
      }
      if (fighter.statuses.some(st => st.key === 'stun')) throw new Error('Fighter is stunned');
      if (fighter.summoningSick && !ultParams.ignoresSummoningSickness) {
        throw new Error('Fighter is summoning sick');
      }
      if (fighter.oncePerGameUsed[ultAb.key]) throw new Error('Ultimate already used');
      // Abilities are 1 Ki unless the card prints otherwise (Uub's Reincarnation is free).
      const ultKiCost: number = ultParams.kiCost ?? 1;
      if (player.kiCurrent < ultKiCost) throw new Error('Not enough Ki');

      // Mark as used (and attacked, unless this ability doesn't consume the attack), spend the Ki
      const newActives = [...player.actives] as typeof player.actives;
      newActives[intent.fighterIndex] = {
        ...fighter,
        hasAttackedThisTurn: fighter.hasAttackedThisTurn || !ultParams.doesNotConsumeAttack,
        oncePerGameUsed: { ...fighter.oncePerGameUsed, [ultAb.key]: true },
      };
      s = { ...s, players: { ...s.players, [tp]: { ...player, actives: newActives, kiCurrent: player.kiCurrent - ultKiCost } } };

      // Apply ultimate effect
      s = applyUltimate(s, tp, opponent, ultAb, intent.fighterIndex, intent.targetIndex, intent.secondTargetIndex, intent.targetSide);
      s = checkWinLoss(s);
      break;
    }

    case 'promote_from_bench': {
      const pending = s.pendingPromotions[0];
      if (!pending) throw new Error('No pending promotion');
      const { side, activeIndex, friezaWrathPending, daburaStunPending } = pending;
      s = { ...s, pendingPromotions: s.pendingPromotions.slice(1) };
      s = promoteSpecific(s, side, activeIndex, intent.benchIndex);
      if (friezaWrathPending) {
        const promoted = s.players[side].actives[activeIndex];
        if (promoted) {
          const wrathOwner = pending.attackerSide !== undefined ? findFriezaWrathOwner(s, pending.attackerSide) : null;
          const dmg = boostedAbilityDamage(s, wrathOwner, 2000);
          // Must credit attackerSide so this can KO the freshly-promoted fighter in turn
          // (otherwise its HP can hit 0 without ever being removed from the board).
          s = applyDamageToFighter(s, side, 'active', activeIndex, dmg, pending.attackerSide);
        }
      }
      if (daburaStunPending) {
        const promoted = s.players[side].actives[activeIndex];
        if (promoted) {
          const player = { ...s.players[side] };
          const newActives = [...player.actives] as typeof player.actives;
          newActives[activeIndex] = {
            ...promoted,
            cannotAttackNextTurn: true,
            statuses: [...promoted.statuses, { key: 'stun', until: 'their_next_turn' as const }],
          };
          player.actives = newActives;
          s = { ...s, players: { ...s.players, [side]: player } };
        }
      }
      // If multiple promotions were queued this turn but the bench didn't have enough
      // fighters for all of them, drop whatever's left rather than leaving it stuck forever.
      if (s.pendingPromotions.some(p => p.side === side) && !s.players[side].bench.some(b => b !== null)) {
        s = { ...s, pendingPromotions: s.pendingPromotions.filter(p => p.side !== side) };
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
        s = {
          ...s,
          discard: [
            ...s.discard,
            ...[fighter.cardId, ...fighter.equipment].map((cardId) => ({ cardId, owner: tp })),
          ],
        };
      }

      s = checkWinLoss(s);
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

function applyUltimate(s: GameState, tp: PlayerId, opp: PlayerId, ab: any, casterIndex: number, targetIndex?: number, secondTargetIndex?: number, targetSide?: SlotType): GameState {
  const p = ab.params as any;
  const casterFighter = s.players[tp].actives[casterIndex];
  const casterCard = casterFighter ? getCard(casterFighter.cardId) : null;
  const boosted = (raw: number) => boostedAbilityDamage(s, casterCard, raw);

  switch (ab.key) {
    case 'spirit_bomb':
    case 'solar_kamehameha': {
      // Deal damage to all enemy Actives
      const targets = s.players[opp].actives
        .map((f, i) => (f ? i : null))
        .filter((i): i is number => i !== null);
      for (const i of [...targets]) {
        if (s.players[opp].actives[i]) {
          s = applyDamageToFighter(s, opp, 'active', i, boosted(p.damage), tp, casterIndex);
        }
      }
      break;
    }
    case 'final_flash':
    case 'thunder_flash':
    case 'ultimate_kamehameha': {
      if (targetIndex === undefined) throw new Error('Ultimate requires target');
      const target = s.players[opp].actives[targetIndex];
      if (!target) throw new Error('No target');
      s = applyDamageToFighter(s, opp, 'active', targetIndex, boosted(p.damage), tp, casterIndex);
      break;
    }
    case 'senzu_stock': {
      // Korin: heal a chosen friendly fighter (active or bench) by a flat amount, capped at max.
      const side = targetSide ?? 'active';
      if (targetIndex === undefined) throw new Error('Senzu Stock requires a target');
      const player = s.players[tp];
      const slots = side === 'active' ? player.actives : player.bench;
      const target = slots[targetIndex];
      if (!target) throw new Error('No target');
      const healed = { ...target, currentHp: Math.min(target.currentHp + p.heal, target.maxHp) };
      const newSlots = [...slots] as typeof slots;
      newSlots[targetIndex] = healed;
      s = {
        ...s,
        players: {
          ...s.players,
          [tp]: side === 'active' ? { ...player, actives: newSlots as typeof player.actives } : { ...player, bench: newSlots as typeof player.bench },
        },
      };
      break;
    }
    case 'reincarnation': {
      // Uub heals himself to full. The free-action part (doesNotConsumeAttack) and the
      // zero Ki cost are both handled generically by the 'ultimate' intent above, so all
      // that's left here is the heal.
      const player = s.players[tp];
      const self = player.actives[casterIndex];
      if (!self) break;
      const healed = [...player.actives] as typeof player.actives;
      healed[casterIndex] = { ...self, currentHp: self.maxHp };
      s = { ...s, players: { ...s.players, [tp]: { ...player, actives: healed } } };
      break;
    }
    case 'super_ghost_kamikaze_attack': {
      // Attach a ghost to one enemy Active. Nothing resolves now — the trap sits on that
      // specific fighter until it makes a basic attack (see resolveGhostedAttack).
      if (targetIndex === undefined) throw new Error('Ultimate requires target');
      const oppPlayer = s.players[opp];
      const victim = oppPlayer.actives[targetIndex];
      if (!victim) throw new Error('No target');
      const oppActives = [...oppPlayer.actives] as typeof oppPlayer.actives;
      oppActives[targetIndex] = {
        ...victim,
        counters: { ...victim.counters, [GHOST_COUNTER]: 1 },
      };
      s = { ...s, players: { ...s.players, [opp]: { ...oppPlayer, actives: oppActives } } };
      break;
    }
    case 'special_beam_cannon': {
      if (targetIndex === undefined) throw new Error('Ultimate requires target');
      const target = s.players[opp].actives[targetIndex];
      if (!target) throw new Error('No target');
      s = applyDamageToFighter(s, opp, 'active', targetIndex, boosted(p.damage), tp, casterIndex);
      // Chain to the bench slot directly behind the target, if occupied.
      if (s.players[opp].bench[targetIndex]) {
        s = applyDamageToFighter(s, opp, 'bench', targetIndex, boosted(p.secondaryDamage), tp, casterIndex);
      }
      break;
    }
    case 'supernova': {
      if (targetIndex === undefined) throw new Error('Ultimate requires target');
      const target = s.players[opp].actives[targetIndex];
      if (!target) throw new Error('No target');
      s = applyDamageToFighter(s, opp, 'active', targetIndex, boosted(p.damage), tp, casterIndex);
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
      const target = s.players[opp].actives[targetIndex];
      if (!target) break;

      // Full body swap: cardId, HP, equipment, statuses, counters travel with the body.
      // Action state (hasAttackedThisTurn, summoningSick) stays with the soul (the slot).
      // Ginyu's oncePerGameUsed merges onto the body going to the opponent so they can't re-use body_change.
      const ginyuNewBody = {
        ...target,
        hasAttackedThisTurn: ginyu.hasAttackedThisTurn,
        summoningSick: ginyu.summoningSick,
        oncePerGameUsed: ginyu.oncePerGameUsed,
        cannotAttackNextTurn: ginyu.cannotAttackNextTurn,
        cannotRetreatThisTurn: ginyu.cannotRetreatThisTurn,
      };
      const targetNewBody = {
        ...ginyu,
        hasAttackedThisTurn: target.hasAttackedThisTurn,
        summoningSick: target.summoningSick,
        oncePerGameUsed: { ...target.oncePerGameUsed, ...ginyu.oncePerGameUsed },
        cannotAttackNextTurn: target.cannotAttackNextTurn,
        cannotRetreatThisTurn: target.cannotRetreatThisTurn,
      };

      const newActives = [...player.actives] as typeof player.actives;
      newActives[ginyuIdx] = ginyuNewBody;
      s = { ...s, players: { ...s.players, [tp]: { ...player, actives: newActives } } };
      const oppPlayer = s.players[opp];
      const newOppActives = [...oppPlayer.actives] as typeof oppPlayer.actives;
      newOppActives[targetIndex] = targetNewBody;
      s = { ...s, players: { ...s.players, [opp]: { ...oppPlayer, actives: newOppActives } } };
      break;
    }
    case 'planet_burst': {
      // Bypasses bench protection — the only effect that damages Bench fighters.
      // Resolve bench KOs before actives so a promotion queued by an active's death sees the final bench state.
      const benchTargets = s.players[opp].bench.map((f, i) => (f ? i : -1)).filter(i => i !== -1);
      for (const i of benchTargets) {
        if (s.players[opp].bench[i]) s = applyDamageToFighter(s, opp, 'bench', i, boosted(p.damage), tp, casterIndex);
      }
      const activeTargets = s.players[opp].actives.map((f, i) => (f ? i : -1)).filter(i => i !== -1);
      for (const i of activeTargets) {
        if (s.players[opp].actives[i]) s = applyDamageToFighter(s, opp, 'active', i, boosted(p.damage), tp, casterIndex);
      }
      break;
    }
    case 'manipulation': {
      if (targetIndex === undefined || secondTargetIndex === undefined) throw new Error('Manipulation requires two targets');
      const attacker = s.players[opp].actives[targetIndex];
      const defender = s.players[opp].actives[secondTargetIndex];
      if (!attacker || !defender) break;
      const attackerStats = getEffectiveStats(attacker, 'active', targetIndex, opp, s);
      const defenderStats = getEffectiveStats(defender, 'active', secondTargetIndex, opp, s);
      const dmg = Math.max(attackerStats.atk - defenderStats.def, 1000);
      // No attackerIndex — this is a forced one-way attack, not Super Buu's own, so Absorb never triggers.
      s = applyDamageToFighter(s, opp, 'active', secondTargetIndex, dmg, tp);
      break;
    }
    case 'self_destruct_mv': {
      const player = s.players[tp];
      const fighterIdx = player.actives.findIndex(f => f && f.cardId === 'majin_vegeta');
      if (fighterIdx !== -1) {
        s = resolveKo(s, tp, 'active', fighterIdx, opp);
      }
      const targets = s.players[opp].actives
        .map((f, i) => (f ? i : null))
        .filter((i): i is number => i !== null);
      for (const i of [...targets]) {
        if (s.players[opp].actives[i]) {
          s = applyDamageToFighter(s, opp, 'active', i, boosted(p.damage), tp);
        }
      }
      break;
    }
    case 'creation': {
      // targetIndex doubles as the chosen discard-pile index for this ultimate.
      if (targetIndex === undefined) break;
      const discardIdx = targetIndex;
      if (discardIdx < 0 || discardIdx >= s.discard.length) break;
      const returned = s.discard[discardIdx];
      if (returned.owner !== tp) break; // can only revive your own KO'd cards
      const newDiscard = s.discard.filter((_, i) => i !== discardIdx);
      s = { ...s, discard: newDiscard, players: { ...s.players, [tp]: { ...s.players[tp], hand: [...s.players[tp].hand, returned.cardId] } } };
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
      s = applyDamageToFighter(s, opp, 'active', targetIndex, boosted(p.damage), tp);
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
  pileChoice?: 'hero' | 'item',
  drawChoices?: Array<'hero' | 'item'>,
  enemyTargetIndex?: number,
  promotionIndex?: number,
  discardIndex?: number,
  tutorCardId?: string
): GameState {
  const p = ab.params as any;
  switch (ab.kind) {
    case 'heal': {
      if (p.target === 'all_own_fighters') {
        // Angel's Grace: heal every friendly fighter (actives + bench) a flat amount, capped at max
        const player = { ...s.players[tp] };
        const healOne = (f: FighterInstance | null) => f ? { ...f, currentHp: Math.min(f.currentHp + p.heal, f.maxHp) } : f;
        player.actives = player.actives.map(healOne) as typeof player.actives;
        player.bench = player.bench.map(healOne) as typeof player.bench;
        s = { ...s, players: { ...s.players, [tp]: player } };
        break;
      }
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
    case 'stun': {
      if (targetIndex === undefined) break;
      const oppPlayer = { ...s.players[opp] };
      const oppActives = [...oppPlayer.actives] as typeof oppPlayer.actives;
      const target = oppActives[targetIndex];
      if (!target) break;
      oppActives[targetIndex] = {
        ...target,
        cannotAttackNextTurn: true,
        statuses: [...target.statuses, { key: 'stun', until: 'their_next_turn' as const }],
      };
      oppPlayer.actives = oppActives;
      s = { ...s, players: { ...s.players, [opp]: oppPlayer } };
      break;
    }
    case 'debuff': {
      // Prank Kit: a signed stat modifier parked on an enemy Active as a status. It uses
      // 'end_of_their_next_turn' rather than the stun-style 'their_next_turn' so it lives
      // THROUGH the victim's turn instead of being swept at the start of it.
      if (targetIndex === undefined) break;
      const oppPlayer = { ...s.players[opp] };
      const oppActives = [...oppPlayer.actives] as typeof oppPlayer.actives;
      const target = oppActives[targetIndex];
      if (!target) break;
      const statuses = [...target.statuses];
      if (p.atk) statuses.push({ key: 'atk_debuff', until: p.until ?? 'end_of_their_next_turn', value: p.atk });
      if (p.def) statuses.push({ key: 'def_debuff', until: p.until ?? 'end_of_their_next_turn', value: p.def });
      oppActives[targetIndex] = { ...target, statuses };
      oppPlayer.actives = oppActives;
      s = { ...s, players: { ...s.players, [opp]: oppPlayer } };
      break;
    }
    case 'tutor': {
      // Fusion Dance Practice: pull a named hero out of your own pile into hand. The pile
      // is not reshuffled afterwards — its order is hidden from both players, so a shuffle
      // would change nothing observable while making applyIntent non-deterministic (which
      // the search AI replays through).
      const player = { ...s.players[tp] };
      const from: 'hero' | 'item' = p.from ?? 'hero';
      const allowed: string[] = p.cardIds ?? [];
      const pile = player.piles[from];
      const pickIdx = tutorCardId !== undefined && allowed.includes(tutorCardId)
        ? pile.indexOf(tutorCardId)
        : pile.findIndex(id => allowed.includes(id));
      if (pickIdx === -1) break; // none of the named cards left in the pile — item fizzles
      player.piles = { ...player.piles, [from]: pile.filter((_, i) => i !== pickIdx) };
      player.hand = [...player.hand, pile[pickIdx]];
      s = { ...s, players: { ...s.players, [tp]: player } };
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
      if (p.heroOnly) {
        let drawn = 0;
        while (drawn < p.draw && newPiles.hero.length > 0) {
          const [drawnCard, ...rest] = newPiles.hero;
          newPiles.hero = rest;
          newHand = [...newHand, drawnCard];
          drawn++;
        }
      } else if (drawChoices && drawChoices.length > 0) {
        for (const pile of drawChoices) {
          if (newPiles[pile].length > 0) {
            const [drawnCard, ...rest] = newPiles[pile];
            newPiles[pile] = rest;
            newHand = [...newHand, drawnCard];
          }
        }
      } else {
        let drawn = 0;
        for (const pile of ['hero', 'item'] as const) {
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
      const pileOrder: Array<'hero' | 'item'> = pileChoice
        ? [pileChoice, ...(['hero', 'item'] as const).filter(p => p !== pileChoice)]
        : ['hero', 'item'];
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
      const discardIdx = discardIndex ?? s.discard.findIndex(entry => {
        if (entry.owner !== tp) return false;
        const c = getCard(entry.cardId);
        return c.cardType === 'hero' && cardTypesOf(c).has(p.type);
      });
      if (discardIdx !== -1 && discardIdx < s.discard.length && s.discard[discardIdx].owner === tp) {
        const returned = s.discard[discardIdx];
        const newDiscard = s.discard.filter((_, i) => i !== discardIdx);
        player.hand = [...player.hand, returned.cardId];
        s = { ...s, discard: newDiscard, players: { ...s.players, [tp]: player } };
      }
      break;
    }
    default:
      break;
  }
  return s;
}

// How much HP the currently active field grants a fighter of this card, if any
// (e.g. Cell Games Arena for Green, formerly Frieza's Spaceship for Frieza Force).
function activeFieldHpBonusFor(s: GameState, card: CardDef): number {
  if (!s.field) return 0;
  const fieldCard = getCard(s.field);
  let bonus = 0;
  for (const ab of fieldCard.abilities) {
    if (ab.kind === 'field_class_buff') {
      const p = ab.params as any;
      if (p.hp && classOf(card) === p.class) bonus += p.hp;
    }
  }
  return bonus;
}

function applyFieldEntryEffects(s: GameState, fieldId: string): GameState {
  const fieldCard = getCard(fieldId);
  for (const ab of fieldCard.abilities) {
    if (ab.kind === 'field_class_buff') {
      const p = ab.params as any;
      if (!p.hp) continue;
      // Apply HP buffs to existing fighters of that class
      for (const side of ['p1', 'p2'] as PlayerId[]) {
        const player = { ...s.players[side] };
        player.actives = player.actives.map(f => {
          if (!f) return null;
          const c = getCard(f.cardId);
          if (classOf(c) !== p.class) return f;
          return { ...f, maxHp: f.maxHp + p.hp, currentHp: f.currentHp + p.hp };
        }) as typeof player.actives;
        player.bench = player.bench.map(f => {
          if (!f) return null;
          const c = getCard(f.cardId);
          if (classOf(c) !== p.class) return f;
          return { ...f, maxHp: f.maxHp + p.hp, currentHp: f.currentHp + p.hp };
        }) as typeof player.bench;
        s = { ...s, players: { ...s.players, [side]: player } };
      }
    }
  }
  return s;
}

// Mirrors applyFieldEntryEffects in reverse — undoes a field's baked-in HP bonus
// when it leaves play. currentHp is floored at 1 so a passive field swap can never
// retroactively KO a fighter that's currently below the reduced max.
function removeFieldExitEffects(s: GameState, fieldId: string): GameState {
  const fieldCard = getCard(fieldId);
  for (const ab of fieldCard.abilities) {
    if (ab.kind === 'field_class_buff') {
      const p = ab.params as any;
      if (!p.hp) continue;
      for (const side of ['p1', 'p2'] as PlayerId[]) {
        const player = { ...s.players[side] };
        player.actives = player.actives.map(f => {
          if (!f) return null;
          const c = getCard(f.cardId);
          if (classOf(c) !== p.class) return f;
          return { ...f, maxHp: f.maxHp - p.hp, currentHp: Math.max(1, f.currentHp - p.hp) };
        }) as typeof player.actives;
        player.bench = player.bench.map(f => {
          if (!f) return null;
          const c = getCard(f.cardId);
          if (classOf(c) !== p.class) return f;
          return { ...f, maxHp: f.maxHp - p.hp, currentHp: Math.max(1, f.currentHp - p.hp) };
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

  // EOT heals from fighter abilities + equipment + Cooler counter.
  // Self-heals apply directly; "other_friendly_active"/"one_friendly_active" targets (Dende,
  // Mr. Popo) and "all_own_kai" (Supreme Kai) are resolved in a second pass below since they
  // need the whole board, not just the fighter's own instance.
  const processActive = (f: NonNullable<typeof player.actives[0]>): NonNullable<typeof player.actives[0]> => {
    const card = getCard(f.cardId);
    let hp = f.currentHp;
    let counters = { ...f.counters };
    const locked = isAbilityLocked(card, s);

    if (!locked) {
      for (const ab of card.abilities) {
        if (ab.kind === 'triggered_end_of_turn') {
          const p = ab.params as any;
          if (p.heal && p.target !== 'other_friendly_active' && p.target !== 'one_friendly_active' && p.target !== 'all_own_kai') {
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
    }
    // Equipment triggers — item-sourced, never locked
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

  // "Heal your other Active" abilities (Dende's Healer, Mr. Popo's Caretaker) — data-driven,
  // any hero with a triggered_end_of_turn ability targeting the other active qualifies.
  for (let i = 0; i < player.actives.length; i++) {
    const source = player.actives[i];
    if (!source) continue;
    const sourceCard = getCard(source.cardId);
    if (isAbilityLocked(sourceCard, s)) continue;
    for (const ab of sourceCard.abilities) {
      if (ab.kind !== 'triggered_end_of_turn') continue;
      const p = ab.params as any;
      if (p.target !== 'other_friendly_active' && p.target !== 'one_friendly_active') continue;
      const healTargetIdx = player.actives.findIndex((f, idx) => idx !== i && f !== null);
      if (healTargetIdx === -1) continue;
      const target = player.actives[healTargetIdx]!;
      const newActives = [...player.actives] as typeof player.actives;
      newActives[healTargetIdx] = { ...target, currentHp: Math.min(target.currentHp + p.heal, target.maxHp) };
      player.actives = newActives;
    }
  }

  // "Heal all your Kai fighters" (Supreme Kai's Divine Guidance)
  for (const f of [...player.actives, ...player.bench]) {
    if (!f) continue;
    const card = getCard(f.cardId);
    if (isAbilityLocked(card, s)) continue;
    for (const ab of card.abilities) {
      if (ab.kind !== 'triggered_end_of_turn') continue;
      const p = ab.params as any;
      if (p.target !== 'all_own_kai') continue;
      const healKai = (fx: FighterInstance | null) =>
        fx && cardTypesOf(getCard(fx.cardId)).has('kai')
          ? { ...fx, currentHp: Math.min(fx.currentHp + p.heal, fx.maxHp) }
          : fx;
      player.actives = player.actives.map(healKai) as typeof player.actives;
      player.bench = player.bench.map(healKai) as typeof player.bench;
    }
  }

  // Field EOT effects
  if (s.field) {
    const fieldCard = getCard(s.field);
    const healByClass = (heal: number, cls: string) => {
      const applyHeal = (f: FighterInstance | null) =>
        f && classOf(getCard(f.cardId)) === cls ? { ...f, currentHp: Math.min(f.currentHp + heal, f.maxHp) } : f;
      player.actives = player.actives.map(applyHeal) as typeof player.actives;
      player.bench = player.bench.map(applyHeal) as typeof player.bench;
    };
    for (const ab of fieldCard.abilities) {
      if (ab.kind === 'field_class_heal') {
        const p = ab.params as any;
        if (p.timing !== 'end_of_controller_turn') continue;
        if (p.heal) healByClass(p.heal, p.class);
        if (p.healPercent) {
          const applyPctHeal = (f: FighterInstance | null) => {
            if (!f || classOf(getCard(f.cardId)) !== p.class) return f;
            const amount = Math.round(f.maxHp * (p.healPercent / 100));
            return { ...f, currentHp: Math.min(f.currentHp + amount, f.maxHp) };
          };
          player.actives = player.actives.map(applyPctHeal) as typeof player.actives;
          player.bench = player.bench.map(applyPctHeal) as typeof player.bench;
        }
      } else if (ab.kind === 'field_tricolor_heal') {
        const p = ab.params as any;
        const distinctColors = new Set(
          [...player.actives, ...player.bench]
            .filter((f): f is FighterInstance => !!f)
            .map(f => classOf(getCard(f.cardId)))
            .filter(Boolean)
        ).size;
        if (distinctColors >= 3) {
          const applyPctHeal = (f: FighterInstance | null) => {
            if (!f) return f;
            const amount = Math.round(f.maxHp * (p.healPercent / 100));
            return { ...f, currentHp: Math.min(f.currentHp + amount, f.maxHp) };
          };
          player.actives = player.actives.map(applyPctHeal) as typeof player.actives;
          player.bench = player.bench.map(applyPctHeal) as typeof player.bench;
        }
      }
    }
  }

  // Discard to hand limit of 7 (copy hand first — shallow-clone of player doesn't deep-clone arrays)
  player.hand = [...player.hand];
  const newDiscard = [...s.discard];
  while (player.hand.length > 7) {
    const discarded = player.hand.pop()!;
    newDiscard.push({ cardId: discarded, owner: tp });
  }

  // Clear stun statuses and retreat block after the stunned player has had their turn to
  // act. 'end_of_their_next_turn' effects (Prank Kit) expire here too — this IS the end of
  // the affected player's turn, which is the only point they're allowed to lapse.
  const expired = (st: { until: string }) =>
    st.until !== 'their_next_turn' && st.until !== 'end_of_their_next_turn';
  player.actives = player.actives.map(f =>
    f ? { ...f, statuses: f.statuses.filter(expired), cannotRetreatThisTurn: undefined } : null
  ) as typeof player.actives;
  player.bench = player.bench.map(f =>
    f ? { ...f, statuses: f.statuses.filter(expired) } : null
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
