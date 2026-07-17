import { GameState, PlayerId, Intent } from './types';
import { getCard } from './cards';
import { getEffectiveStats, isType, cardTypesOf, isAbilityLocked } from './buffs';

// Shared by the Battle-phase ultimate handling and the Main-phase handling for abilities
// flagged usableInMainPhase (e.g. Bibidi's Creation) — offers reviving each of the
// player's own KO'd fighters of the given type currently sitting in the discard pile.
function pushCreationMoves(moves: Intent[], state: GameState, player: PlayerId, fighterIndex: number, type: string) {
  state.discard.forEach((entry, discardIdx) => {
    if (entry.owner !== player) return;
    const c = getCard(entry.cardId);
    if (c.cardType === 'hero' && cardTypesOf(c).has(type)) {
      moves.push({ type: 'ultimate', fighterIndex, targetIndex: discardIdx });
    }
  });
}

export function legalMoves(state: GameState, player: PlayerId): Intent[] {
  if (state.winner) return [];
  if (state.turnPlayer !== player) return [];
  // Opponent has a pending bench promotion — attacker must wait before acting further
  if (state.pendingPromotions.length > 0) return [];

  const moves: Intent[] = [];
  const ps = state.players[player];
  const opp: PlayerId = player === 'p1' ? 'p2' : 'p1';
  const oppState = state.players[opp];

  switch (state.phase) {
    case 'draw': {
      for (const pile of ['hero', 'item'] as const) {
        if (ps.piles[pile].length > 0) {
          moves.push({ type: 'draw', pile });
        }
      }
      // All piles exhausted — allow skipping to main1
      if (moves.length === 0) moves.push({ type: 'advance_phase' });
      break;
    }

    case 'main1':
    case 'main2': {
      // If the player has no active fighters but can afford to deploy one,
      // they must deploy a hero before playing items, fields, or advancing.
      const hasActiveHero = ps.actives.some(f => f !== null);
      const canDeployActiveHero = !hasActiveHero && ps.hand.some(id => {
        const c = getCard(id);
        return c.cardType === 'hero' && ps.kiCurrent >= c.kiCost && ps.actives.some(slot => slot === null);
      });

      // Play heroes
      const bothActivesFilled = ps.actives.every(f => f !== null);
      for (const cardId of ps.hand) {
        const card = getCard(cardId);
        if (card.cardType !== 'hero') continue;
        if (ps.kiCurrent < card.kiCost) continue;
        // Bench is only offered once both active slots are filled — an empty
        // active must be filled (or refilled after a KO) before benching a hero.
        const allowedSlots: Array<'active' | 'bench'> =
          ps.turnNumber === 1 || !bothActivesFilled ? ['active'] : ['active', 'bench'];
        for (const slot of allowedSlots) {
          const slots = slot === 'active' ? ps.actives : ps.bench;
          for (let i = 0; i < slots.length; i++) {
            if (slots[i] === null) {
              moves.push({ type: 'play_hero', cardId, slot, index: i });
            }
          }
        }
      }

      // Evolve — a Buu card cast onto a slot that already holds a lower-stage Buu, at a discount.
      // Not gated by canDeployActiveHero: evolving a benched Buu doesn't fill an empty active slot,
      // but it's also not a "workaround" for skipping active deployment, so it should stay available.
      for (const cardId of ps.hand) {
        const card = getCard(cardId);
        if (card.cardType !== 'hero' || card.subtype !== 'buu') continue;
        for (const slotSide of ['active', 'bench'] as const) {
          const slots = slotSide === 'active' ? ps.actives : ps.bench;
          const buuCounts = slotSide === 'active' ? ps.activeBuuCounts : ps.benchBuuCounts;
          for (let i = 0; i < slots.length; i++) {
            const cur = slots[i];
            if (!cur) continue;
            const curCard = getCard(cur.cardId);
            if (curCard.subtype !== 'buu') continue;
            if ((card.buuStage ?? 0) <= (curCard.buuStage ?? 0)) continue;
            const cost = Math.max(0, card.kiCost - buuCounts[i]);
            if (ps.kiCurrent >= cost) {
              moves.push({ type: 'evolve', cardId, slotSide, slotIndex: i });
            }
          }
        }
      }

      if (canDeployActiveHero) break;

      // Play items
      for (const cardId of ps.hand) {
        const card = getCard(cardId);
        if (card.cardType !== 'item') continue;
        if (ps.kiCurrent < card.kiCost) continue;

        if (card.itemClass === 'consumable') {
          const abKind = card.abilities[0]?.kind;
          if (abKind === 'heal') {
            if ((card.abilities[0].params as any).target === 'all_own_fighters') {
              moves.push({ type: 'play_item', cardId });
            } else {
              for (const slot of ['active', 'bench'] as const) {
                const slots = slot === 'active' ? ps.actives : ps.bench;
                for (let i = 0; i < slots.length; i++) {
                  if (slots[i]) moves.push({ type: 'play_item', cardId, targetSide: slot, targetIndex: i });
                }
              }
            }
          } else if (abKind === 'direct_damage' || abKind === 'delayed_damage' || abKind === 'stun') {
            for (let i = 0; i < oppState.actives.length; i++) {
              if (oppState.actives[i]) moves.push({ type: 'play_item', cardId, targetIndex: i });
            }
          } else if (abKind === 'draw' || abKind === 'reveal_and_draw') {
            moves.push({ type: 'play_item', cardId });
          } else if (abKind === 'recur_from_discard') {
            const type = (card.abilities[0].params as any).type;
            state.discard.forEach((entry, discardIndex) => {
              if (entry.owner !== player) return;
              const c = getCard(entry.cardId);
              if (c.cardType === 'hero' && cardTypesOf(c).has(type)) {
                moves.push({ type: 'play_item', cardId, discardIndex });
              }
            });
          } else if (abKind === 'sacrifice_for_damage') {
            // Self-Destruct Device: pick a friendly Android + an enemy active to damage
            const enemyTargets = oppState.actives
              .map((f, idx) => (f !== null ? idx : -1))
              .filter(idx => idx !== -1);
            if (enemyTargets.length === 0) continue;
            for (const slot of ['active', 'bench'] as const) {
              const slots = slot === 'active' ? ps.actives : ps.bench;
              for (let i = 0; i < slots.length; i++) {
                const f = slots[i];
                if (!f) continue;
                const fCard = getCard(f.cardId);
                if (!cardTypesOf(fCard).has('android')) continue;
                if (slot === 'active') {
                  // If multiple bench fighters exist, encode the promotion choice
                  const benchOptions = ps.bench
                    .map((b, bidx) => (b !== null ? bidx : -1))
                    .filter(bidx => bidx !== -1);
                  for (const eidx of enemyTargets) {
                    if (benchOptions.length <= 1) {
                      moves.push({ type: 'play_item', cardId, targetSide: slot, targetIndex: i, enemyTargetIndex: eidx });
                    } else {
                      for (const bidx of benchOptions) {
                        moves.push({ type: 'play_item', cardId, targetSide: slot, targetIndex: i, enemyTargetIndex: eidx, promotionIndex: bidx });
                      }
                    }
                  }
                } else {
                  for (const eidx of enemyTargets) {
                    moves.push({ type: 'play_item', cardId, targetSide: slot, targetIndex: i, enemyTargetIndex: eidx });
                  }
                }
              }
            }
          }
        } else {
          // Equipment
          const ab = card.abilities[0];
          if (!ab) continue;
          const p = ab.params as any;
          for (const slot of ['active', 'bench'] as const) {
            const slots = slot === 'active' ? ps.actives : ps.bench;
            for (let i = 0; i < slots.length; i++) {
              const f = slots[i];
              if (!f) continue;
              if (f.equipment.length >= 2) continue;
              const fCard = getCard(f.cardId);
              if (p.restrictType && !isType(f, p.restrictType)) continue;
              if (p.restrictSubtype && fCard.subtype !== p.restrictSubtype) continue;
              if (p.requiresTargetCondition === 'at_or_below_half_hp' && f.currentHp > f.maxHp / 2) continue;
              moves.push({ type: 'play_item', cardId, targetSide: slot, targetIndex: i });
            }
          }
        }
      }

      // Play fields
      for (const cardId of ps.hand) {
        const card = getCard(cardId);
        if (card.cardType !== 'field') continue;
        if (ps.kiCurrent < 1) continue;
        moves.push({ type: 'play_field', cardId });
      }

      // Retreat (Main 1 only) — one retreat per active slot per turn, enforced via
      // cannotRetreatThisTurn on whichever fighter currently occupies the slot.
      if (state.phase === 'main1' && ps.kiCurrent >= 1) {
        for (let ai = 0; ai < ps.actives.length; ai++) {
          const af = ps.actives[ai];
          if (!af) continue;
          if (af.cannotRetreatThisTurn) continue;
          for (let bi = 0; bi < ps.bench.length; bi++) {
            if (!ps.bench[bi]) continue;
            moves.push({ type: 'retreat', activeIndex: ai, benchIndex: bi });
          }
        }
      }

      // Sacrifice (own turn only)
      for (let i = 0; i < ps.actives.length; i++) {
        if (ps.actives[i]) moves.push({ type: 'sacrifice', side: 'active', index: i });
      }
      for (let i = 0; i < ps.bench.length; i++) {
        if (ps.bench[i]) moves.push({ type: 'sacrifice', side: 'bench', index: i });
      }

      // Abilities explicitly usable during Main phases (e.g. Bibidi's Creation) —
      // offered here in addition to the standard Battle-phase ultimate handling below.
      for (let i = 0; i < ps.actives.length; i++) {
        const f = ps.actives[i];
        if (!f) continue;
        const card = getCard(f.cardId);
        if (isAbilityLocked(card, state)) continue;
        const ult = card.abilities.find(ab => ab.kind === 'activated_one_shot');
        if (!ult) continue;
        const p = ult.params as any;
        if (!p.usableInMainPhase) continue;
        if (f.hasAttackedThisTurn && !p.doesNotConsumeAttack) continue;
        if (f.statuses.some(st => st.key === 'stun')) continue;
        if (f.summoningSick && !p.ignoresSummoningSickness) continue;
        if (f.oncePerGameUsed[ult.key]) continue;
        if (ps.kiCurrent < 1) continue;

        if (p.target === 'creation') {
          pushCreationMoves(moves, state, player, i, p.type);
        }
      }

      moves.push({ type: 'advance_phase' });
      break;
    }

    case 'battle': {
      for (let i = 0; i < ps.actives.length; i++) {
        const f = ps.actives[i];
        if (!f || f.hasAttackedThisTurn) continue;
        if (f.statuses.some(st => st.key === 'stun')) continue;

        const stats = getEffectiveStats(f, 'active', i, player, state);
        const card = getCard(f.cardId);
        const locked = isAbilityLocked(card, state);

        // Normal attacks against each enemy active — still blocked by summoning sickness
        if (!f.summoningSick) {
          for (let ti = 0; ti < oppState.actives.length; ti++) {
            if (!oppState.actives[ti]) continue;
            if (ps.kiCurrent >= stats.attackKiCost || stats.attackKiCost === 0) {
              moves.push({ type: 'attack', attackerIndex: i, targetIndex: ti });
            }
            // Kaioken option — disabled while locked out
            const kaioken = card.abilities.find(ab => ab.key === 'kaioken');
            if (kaioken && !locked && ps.kiCurrent >= stats.attackKiCost + 2) {
              moves.push({ type: 'attack', attackerIndex: i, targetIndex: ti, useKaioken: true });
            }
          }
        }

        // Ultimate (includes activated_one_shot abilities like Body Change, Self-Destruct) —
        // disabled entirely while this hero's class is locked out by the active field.
        // Summoning sickness still blocks it UNLESS the ability is flagged
        // ignoresSummoningSickness (e.g. Korin's Senzu Stock).
        const ult = locked ? undefined : card.abilities.find(ab => ab.kind === 'ultimate' || ab.kind === 'activated_one_shot');
        const ultSicknessOk = !f.summoningSick || !!(ult?.params as any)?.ignoresSummoningSickness;
        if (ult && ultSicknessOk && !f.oncePerGameUsed[ult.key] && ps.kiCurrent >= 1) {
          const p = ult.params as any;
          if (p.target === 'all_enemy_actives' || p.target === 'all_enemy_fighters_including_bench') {
            moves.push({ type: 'ultimate', fighterIndex: i });
          } else if (p.target === 'one_enemy_active') {
            for (let ti = 0; ti < oppState.actives.length; ti++) {
              if (oppState.actives[ti]) moves.push({ type: 'ultimate', fighterIndex: i, targetIndex: ti });
            }
          } else if (p.target === 'one_friendly_fighter') {
            for (const slot of ['active', 'bench'] as const) {
              const slots = slot === 'active' ? ps.actives : ps.bench;
              for (let ti = 0; ti < slots.length; ti++) {
                if (slots[ti]) moves.push({ type: 'ultimate', fighterIndex: i, targetSide: slot, targetIndex: ti });
              }
            }
          } else if (p.target === 'manipulation') {
            const activeIdxs = oppState.actives
              .map((f2, idx) => (f2 ? idx : -1))
              .filter((idx) => idx !== -1);
            if (activeIdxs.length >= (p.minEnemyActives ?? 2)) {
              for (const a of activeIdxs) {
                for (const b of activeIdxs) {
                  if (a === b) continue;
                  moves.push({ type: 'ultimate', fighterIndex: i, targetIndex: a, secondTargetIndex: b });
                }
              }
            }
          } else if (p.target === 'creation') {
            pushCreationMoves(moves, state, player, i, p.type);
          }
        }
      }

      moves.push({ type: 'advance_phase' });
      break;
    }

    case 'end': {
      moves.push({ type: 'advance_phase' });
      break;
    }
  }

  return moves;
}
