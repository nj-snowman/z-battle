import { GameState, PlayerId, Intent } from './types';
import { legalMoves } from './legalMoves';
import { getCard } from './cards';
import { getEffectiveStats } from './buffs';
import { hasGhost } from './combat';

// How much of a fighter's own HP an unspent Gotenks ghost is worth in evaluation terms:
// swinging with it turns the attacker's whole ATK into damage spread across its own side.
function ghostLiability(atk: number, ownFighterCount: number): number {
  return ownFighterCount > 0 ? atk : 0;
}

// ---- Draw-phase policy -------------------------------------------------------
//
// A card's Ki cost is the "stars" printed on it; 6 is the ultimate hero. Items are the
// default draw — the hero pile is only 5 cards deep after the opening hand, and a hand
// full of heroes you have no slot for is dead weight. A hero is only worth taking when
// the board would otherwise stop growing:
//
//   * the hand can't improve on what's already deployed (nothing bigger than your best
//     fighter), so drawing items just stalls the curve; or
//   * you hold a 6-star but nothing in the 4-5 band to bridge to it, which is a real risk
//     — the top-end body may be several turns of Ki away with nothing to play meanwhile.
//
// Holding a 6-star with a healthy mid-curve means you're not desperate: take the item.

const TOP_TIER_KI = 6;
// Highest "next best" Ki cost that still counts as a hole under a 6-star. A 3 and a 6 with
// nothing between them is the gap the rule is aimed at; a 4 or 5 bridges it fine.
const CURVE_GAP_CEILING = 3;
// Board capacity: 2 Actives + 2 Bench. Below this many bodies between hand and field
// there's somewhere to put another hero, so keep feeding the board.
const BOARD_CAPACITY = 4;

function wantsHeroDraw(state: GameState, player: PlayerId): boolean {
  const ps = state.players[player];
  const handHeroes = ps.hand.map(getCard).filter(c => c.cardType === 'hero');
  const inPlay = [...ps.actives, ...ps.bench]
    .filter((f): f is NonNullable<typeof f> => f !== null)
    .map(f => getCard(f.cardId));

  // Safety net that outranks the whole policy: an empty Active with no hero in hand to
  // fill it is how a player loses outright, so never pass up the hero pile there.
  if (handHeroes.length === 0 && ps.actives.some(f => f === null)) return true;

  // "Don't stunt the field" applies to breadth, not just height. The rules below compare
  // the BEST hero in hand against the BEST one deployed, which is a question about how
  // tall your board is — a deck that wants several specific bodies out at once (the
  // Goten/Kid Trunks pair, anything keyed off a full bench) reads as "fine, stop drawing"
  // the moment one good fighter lands. While there are still slots to fill and nothing to
  // fill them with, take the hero.
  if (handHeroes.length + inPlay.length < BOARD_CAPACITY) return true;

  const kiCosts = [...handHeroes, ...inPlay].map(c => c.kiCost);
  const top = kiCosts.length ? Math.max(...kiCosts) : 0;

  if (top >= TOP_TIER_KI) {
    // Already have the ceiling covered — only reach for another hero to patch a hole
    // underneath it.
    const below = kiCosts.filter(k => k < TOP_TIER_KI);
    const nextBelow = below.length ? Math.max(...below) : 0;
    return nextBelow <= CURVE_GAP_CEILING;
  }

  const bestInHand = handHeroes.length ? Math.max(...handHeroes.map(c => c.kiCost)) : 0;
  const bestInPlay = inPlay.length ? Math.max(...inPlay.map(c => c.kiCost)) : 0;
  // Nothing in hand outclasses what's already on the field — the board has stopped
  // growing, so go looking for a bigger body.
  return bestInHand <= bestInPlay;
}

/**
 * Which pile to draw from, shared by every difficulty so the policy can't drift between
 * the heuristic and the search AI. Returns null when neither pile has cards.
 */
export function chooseDrawPile(state: GameState, player: PlayerId): Intent | null {
  const ps = state.players[player];
  const heroLeft = ps.piles.hero.length > 0;
  const itemLeft = ps.piles.item.length > 0;
  if (!heroLeft && !itemLeft) return null;
  if (!heroLeft) return { type: 'draw', pile: 'item' };
  if (!itemLeft) return { type: 'draw', pile: 'hero' };
  return { type: 'draw', pile: wantsHeroDraw(state, player) ? 'hero' : 'item' };
}

export function chooseMoveHeuristic(state: GameState, player: PlayerId): Intent | null {
  // Resolve any pending promotion for this player before anything else
  if (state.pendingPromotions.length > 0 && state.pendingPromotions[0].side === player) {
    const bench = state.players[player].bench;
    const benchIdx = bench.map((f, i) => (f ? i : -1)).filter(i => i !== -1);
    if (benchIdx.length > 0) return { type: 'promote_from_bench', benchIndex: benchIdx[0] };
  }

  const moves = legalMoves(state, player);
  if (moves.length === 0) return null;

  const ps = state.players[player];
  const opp: PlayerId = player === 'p1' ? 'p2' : 'p1';
  const oppState = state.players[opp];
  const advance = moves.find(m => m.type === 'advance_phase');

  function estimateDamage(
    attacker: NonNullable<typeof ps.actives[0]>,
    attackerIdx: number,
    target: NonNullable<typeof oppState.actives[0]>,
    targetIdx: number,
    extraAtk = 0,
    ignoreDef = false,
  ): number {
    const atkStats = getEffectiveStats(attacker, 'active', attackerIdx, player, state);
    const defStats = getEffectiveStats(target, 'active', targetIdx, opp, state);
    return Math.max(500, atkStats.atk + extraAtk - (ignoreDef ? 0 : defStats.def));
  }

  // A ghosted fighter's "attack" hits its own side, so it isn't an attacker at all as far
  // as planning goes — count it out of every offensive calculation below.
  const readyAttackers = ps.actives
    .map((f, i) => (f && !f.hasAttackedThisTurn && !f.summoningSick && !hasGhost(f) ? { f, i } : null))
    .filter(Boolean) as { f: NonNullable<typeof ps.actives[0]>; i: number }[];

  const oppActives = oppState.actives
    .map((f, i) => (f ? { f, i } : null))
    .filter(Boolean) as { f: NonNullable<typeof oppState.actives[0]>; i: number }[];

  const canKillNow = readyAttackers.some(({ f, i }) =>
    oppActives.some(({ f: t, i: ti }) => estimateDamage(f, i, t, ti) >= t.currentHp)
  );

  switch (state.phase) {
    case 'draw': {
      const draw = chooseDrawPile(state, player);
      if (draw) return draw;
      break;
    }

    case 'main1':
    case 'main2': {
      const heroes = moves.filter((m): m is Extract<Intent, { type: 'play_hero' }> => m.type === 'play_hero');
      const items = moves.filter((m): m is Extract<Intent, { type: 'play_item' }> => m.type === 'play_item');
      const activeHeroes = heroes.filter(m => m.slot === 'active');
      const benchHeroes = heroes.filter(m => m.slot === 'bench');

      // Heal a critically injured fighter (< 30% HP) before anything else
      const urgentHeals = items.filter(m => {
        if (getCard(m.cardId).abilities[0]?.kind !== 'heal') return false;
        const slots = m.targetSide === 'active' ? ps.actives : ps.bench;
        const f = m.targetIndex != null ? slots[m.targetIndex] : null;
        return f && f.currentHp < f.maxHp * 0.3;
      });
      if (urgentHeals.length > 0) return urgentHeals[0];

      // Play pre-battle equipment on active fighters (stat bonus applies this turn)
      const activeEquip = items.find(m =>
        getCard(m.cardId).itemClass === 'equipment' &&
        m.targetSide === 'active' &&
        ['attach_stat'].includes(getCard(m.cardId).abilities[0]?.kind ?? '')
      );
      if (activeEquip && state.phase === 'main1') return activeEquip;

      // --- Decide: attack first vs fill board first ---
      // Rationale: new heroes have summoning sickness, so placing one in main1 vs main2
      // gives the same attack window. If attackers are strong enough, attacking now is better.
      if (state.phase === 'main1' && readyAttackers.length > 0 && oppActives.length > 0) {
        // Total damage we can deal this turn
        const attackValue = readyAttackers.reduce((sum, { f, i }) => {
          const best = Math.max(...oppActives.map(({ f: t, i: ti }) => estimateDamage(f, i, t, ti)));
          return sum + best;
        }, 0);

        // Best hero we could play in the empty slot (ki cost as power proxy)
        const bestHeroKi = activeHeroes.length > 0
          ? Math.max(...activeHeroes.map(m => getCard(m.cardId).kiCost))
          : 0;

        const oppHasWoundedFighter = oppActives.some(({ f }) => f.currentHp < f.maxHp * 0.55);

        const shouldAttackFirst =
          // Can finish off a target — always press the advantage immediately
          canKillNow ||
          // Strong multi-attacker turn and the hero we'd fill with is a basic unit
          (readyAttackers.length >= 2 && attackValue >= 5000 && bestHeroKi <= 2) ||
          // Three or more attackers ready — the board is full enough
          (readyAttackers.length >= 3 && bestHeroKi <= 3) ||
          // Opponent has a wounded fighter and we have multiple attackers to finish the job
          (oppHasWoundedFighter && readyAttackers.length >= 2 && bestHeroKi <= 2);

        if (shouldAttackFirst && advance) return advance;
      }

      // Play Chiaotzu to stun the opponent's strongest active
      const chiaotzuMove = activeHeroes.find(m => m.cardId === 'chiaotzu');
      if (chiaotzuMove) {
        let bestIdx = -1, bestAtk = -1;
        oppActives.forEach(({ f, i }) => {
          const stats = getEffectiveStats(f, 'active', i, opp, state);
          if (stats.atk > bestAtk) { bestAtk = stats.atk; bestIdx = i; }
        });
        return bestIdx !== -1 ? { ...chiaotzuMove, stunTargetIndex: bestIdx } : chiaotzuMove;
      }

      // Fill active slots — strongest hero first
      if (activeHeroes.length > 0) {
        return activeHeroes.sort((a, b) => getCard(b.cardId).kiCost - getCard(a.cardId).kiCost)[0];
      }

      // Go to battle if nothing affordable left to play
      if (state.phase === 'main1' && readyAttackers.length > 0) {
        const affordableItems = items.filter(m => getCard(m.cardId).kiCost <= ps.kiCurrent);
        const affordableBench = benchHeroes.filter(m => getCard(m.cardId).kiCost <= ps.kiCurrent);
        if (affordableItems.length === 0 && affordableBench.length === 0) {
          if (advance) return advance;
        }
        if (ps.kiCurrent <= 1 && advance) return advance;
      }

      // Damage items — target the weakest enemy active to try to KO it
      const dmgItems = items.filter(m => {
        const kind = getCard(m.cardId).abilities[0]?.kind;
        return kind === 'direct_damage' || kind === 'delayed_damage';
      });
      if (dmgItems.length > 0) {
        return dmgItems.sort((a, b) => {
          const ta = a.targetIndex != null ? oppState.actives[a.targetIndex] : null;
          const tb = b.targetIndex != null ? oppState.actives[b.targetIndex] : null;
          if (!ta) return 1;
          if (!tb) return -1;
          return ta.currentHp - tb.currentHp;
        })[0];
      }

      // Blunt the biggest enemy attacker before going into battle (Prank Kit)
      const debuffs = items.filter(m => getCard(m.cardId).abilities[0]?.kind === 'debuff');
      if (debuffs.length > 0 && oppActives.length > 0) {
        const best = debuffs
          .filter(m => m.targetIndex != null && oppState.actives[m.targetIndex])
          .sort((a, b) => {
            const fa = oppState.actives[a.targetIndex!]!;
            const fb = oppState.actives[b.targetIndex!]!;
            return getEffectiveStats(fb, 'active', b.targetIndex!, opp, state).atk
                 - getEffectiveStats(fa, 'active', a.targetIndex!, opp, state).atk;
          })[0];
        if (best) return best;
      }

      // Heal a fighter below 60% HP
      const heals = items.filter(m => {
        if (getCard(m.cardId).abilities[0]?.kind !== 'heal') return false;
        const slots = m.targetSide === 'active' ? ps.actives : ps.bench;
        const f = m.targetIndex != null ? slots[m.targetIndex] : null;
        return f && f.currentHp < f.maxHp * 0.6;
      });
      if (heals.length > 0) {
        return heals.sort((a, b) => {
          const sa = a.targetSide === 'active' ? ps.actives : ps.bench;
          const sb = b.targetSide === 'active' ? ps.actives : ps.bench;
          const fa = a.targetIndex != null ? sa[a.targetIndex] : null;
          const fb = b.targetIndex != null ? sb[b.targetIndex] : null;
          if (!fa || !fb) return 0;
          return (fb.maxHp - fb.currentHp) - (fa.maxHp - fa.currentHp);
        })[0];
      }

      // Equipment — prefer active fighters
      const equipActive = items.find(m => getCard(m.cardId).itemClass === 'equipment' && m.targetSide === 'active');
      if (equipActive) return equipActive;
      const equipBench = items.find(m => getCard(m.cardId).itemClass === 'equipment');
      if (equipBench) return equipBench;

      // Draw/utility items
      const utilItems = items.filter(m => {
        const kind = getCard(m.cardId).abilities[0]?.kind;
        return kind === 'draw' || kind === 'reveal_and_draw' || kind === 'recur_from_discard' || kind === 'tutor';
      });
      if (utilItems.length > 0) {
        // For recur_from_discard, pick the highest-Ki-cost (most powerful) Namekian
        const recurMoves = utilItems.filter(m => getCard(m.cardId).abilities[0]?.kind === 'recur_from_discard');
        if (recurMoves.length > 0) {
          return recurMoves.reduce((best, m) => {
            const bestCard = m.discardIndex !== undefined ? getCard(state.discard[m.discardIndex].cardId) : null;
            const curCard = best.discardIndex !== undefined ? getCard(state.discard[best.discardIndex].cardId) : null;
            return (bestCard?.kiCost ?? 0) > (curCard?.kiCost ?? 0) ? m : best;
          });
        }
        return utilItems[0];
      }

      // Fill bench with strongest hero
      if (benchHeroes.length > 0) {
        return benchHeroes.sort((a, b) => getCard(b.cardId).kiCost - getCard(a.cardId).kiCost)[0];
      }

      // Play field card — type buff for our fighters
      const fields = moves.filter((m): m is Extract<Intent, { type: 'play_field' }> => m.type === 'play_field');
      if (fields.length > 0) return fields[0];

      break;
    }

    case 'battle': {
      // Never swing with a ghosted fighter — that attack deals nothing to the target and
      // splits its ATK across our own board instead.
      const notGhosted = (m: Extract<Intent, { type: 'attack' }>) => {
        const a = ps.actives[m.attackerIndex];
        return !!a && !hasGhost(a);
      };
      const baseAttacks = moves
        .filter((m): m is Extract<Intent, { type: 'attack' }> => m.type === 'attack')
        .filter(m => !m.useKaioken && !m.useOneShotAbility && !m.useTriBeam)
        .filter(notGhosted);
      const kaiokenAttacks = moves
        .filter((m): m is Extract<Intent, { type: 'attack' }> => m.type === 'attack' && !!m.useKaioken)
        .filter(notGhosted);
      const oneShotAttacks = moves
        .filter((m): m is Extract<Intent, { type: 'attack' }> => m.type === 'attack' && !!m.useOneShotAbility)
        .filter(notGhosted);
      const ultimates = moves
        .filter((m): m is Extract<Intent, { type: 'ultimate' }> => m.type === 'ultimate')
        // Don't burn a once-per-game self-heal (Uub's Reincarnation) on a healthy fighter
        .filter(m => {
          const f = ps.actives[m.fighterIndex];
          if (!f) return false;
          const ult = getCard(f.cardId).abilities.find(
            ab => ab.kind === 'ultimate' || ab.kind === 'activated_one_shot'
          );
          const p = (ult?.params ?? {}) as any;
          if (p.target === 'self' && p.healToFull) return f.currentHp <= f.maxHp * 0.5;
          return true;
        });

      // Killing blow with base attack
      for (const move of baseAttacks) {
        const attacker = ps.actives[move.attackerIndex];
        const target = oppState.actives[move.targetIndex];
        if (!attacker || !target) continue;
        if (estimateDamage(attacker, move.attackerIndex, target, move.targetIndex) >= target.currentHp) return move;
      }

      // Killing blow with Kaioken (+3,000 damage, costs extra Ki)
      for (const move of kaiokenAttacks) {
        const attacker = ps.actives[move.attackerIndex];
        const target = oppState.actives[move.targetIndex];
        if (!attacker || !target) continue;
        if (estimateDamage(attacker, move.attackerIndex, target, move.targetIndex, 3000) >= target.currentHp) return move;
      }

      // Killing blow with a once-per-game ignore-DEF attack — free to use, so only worth
      // spending when it actually converts into a KO the plain swing wouldn't get.
      for (const move of oneShotAttacks) {
        const attacker = ps.actives[move.attackerIndex];
        const target = oppState.actives[move.targetIndex];
        if (!attacker || !target) continue;
        const plain = estimateDamage(attacker, move.attackerIndex, target, move.targetIndex);
        if (plain >= target.currentHp) continue; // the normal attack already kills — save it
        if (estimateDamage(attacker, move.attackerIndex, target, move.targetIndex, 0, true) >= target.currentHp) return move;
      }

      // Use ultimate if available
      if (ultimates.length > 0) return ultimates[0];

      // Attack lowest-HP enemy, one attack per attacker
      if (baseAttacks.length > 0) {
        const byAttacker = new Map<number, Extract<Intent, { type: 'attack' }>>();
        const sorted = [...baseAttacks].sort((a, b) => {
          const ta = oppState.actives[a.targetIndex];
          const tb = oppState.actives[b.targetIndex];
          return (ta?.currentHp ?? Infinity) - (tb?.currentHp ?? Infinity);
        });
        for (const m of sorted) {
          if (!byAttacker.has(m.attackerIndex)) byAttacker.set(m.attackerIndex, m);
        }
        const first = byAttacker.values().next().value;
        if (first) return first;
        return baseAttacks[0];
      }

      break;
    }

    case 'end':
      break;
  }

  return advance ?? moves[0];
}

// ---- Fast move-ordering heuristic used by the search AI (aiSearch.ts) ----
// Not meant to be as precise as chooseMoveHeuristic's phase-aware chain — just good
// enough to put strong moves first so alpha-beta pruning and beam selection keep the
// right candidates.
export function scoreMoveHeuristically(state: GameState, player: PlayerId, intent: Intent): number {
  const opp: PlayerId = player === 'p1' ? 'p2' : 'p1';
  const ps = state.players[player];

  function estimateDamage(attackerIdx: number, targetIdx: number, extraAtk = 0, ignoreDef = false): number {
    const attacker = ps.actives[attackerIdx];
    const target = state.players[opp].actives[targetIdx];
    if (!attacker || !target) return 0;
    const atkStats = getEffectiveStats(attacker, 'active', attackerIdx, player, state);
    const defStats = getEffectiveStats(target, 'active', targetIdx, opp, state);
    return Math.max(500, atkStats.atk + extraAtk - (ignoreDef ? 0 : defStats.def));
  }

  switch (intent.type) {
    case 'sacrifice':
      // Sacrificing an active always gifts the opponent a KO point — never voluntarily correct.
      return -1_000_000;

    case 'attack': {
      const target = state.players[opp].actives[intent.targetIndex];
      if (!target) return -1000;
      const attacker = ps.actives[intent.attackerIndex];
      // Carrying one of Gotenks's ghosts: this swing deals nothing to the target and
      // shares the attacker's ATK across our own board. Deprioritised rather than pruned
      // outright, since discharging it cheaply into a wide healthy board is occasionally
      // the right call and the search should still be free to find that.
      if (attacker && hasGhost(attacker)) {
        const own = [...ps.actives, ...ps.bench].filter(f => f !== null).length;
        const atk = getEffectiveStats(attacker, 'active', intent.attackerIndex, player, state).atk;
        return -5000 - ghostLiability(atk, own) / 10;
      }
      const dmg = estimateDamage(
        intent.attackerIndex,
        intent.targetIndex,
        intent.useKaioken ? 3000 : 0,
        !!intent.useOneShotAbility,
      );
      let score = 500 + dmg / 10;
      if (dmg >= target.currentHp) score += 100000; // lethal this attack
      // Burning a once-per-game ignore-DEF shot that a plain swing would have matched is
      // pure waste — rank it below the identical normal attack unless the DEF it skips
      // is actually buying something.
      if (intent.useOneShotAbility) {
        const plain = estimateDamage(intent.attackerIndex, intent.targetIndex);
        score -= plain >= target.currentHp ? 2000 : 200;
      }
      return score;
    }

    case 'ultimate': {
      // A free-action self-heal is worth exactly the HP it restores, not the usual
      // "fire the big once-per-game button" premium.
      const f = ps.actives[intent.fighterIndex];
      const ult = f && getCard(f.cardId).abilities.find(
        ab => ab.kind === 'ultimate' || ab.kind === 'activated_one_shot'
      );
      const p = (ult?.params ?? {}) as any;
      if (f && p.target === 'self' && p.healToFull) {
        const missing = f.maxHp - f.currentHp;
        return missing <= 0 ? -500 : 800 + missing / 10;
      }
      return 20000; // high-impact, often once-per-game — prioritize using it
    }

    case 'play_item': {
      const card = getCard(intent.cardId);
      const kind = card.abilities[0]?.kind;
      if (kind === 'heal') {
        const slots = intent.targetSide === 'active' ? ps.actives : ps.bench;
        const f = intent.targetIndex != null ? slots[intent.targetIndex] : null;
        if (!f) return 0;
        const missing = f.maxHp - f.currentHp;
        if (missing <= 0) return -500; // topping off a full-HP fighter
        if (f.currentHp < f.maxHp * 0.3) return 5000 + missing / 10;
        if (f.currentHp < f.maxHp * 0.6) return 800 + missing / 10;
        return 200 + missing / 20;
      }
      if (kind === 'direct_damage' || kind === 'delayed_damage') {
        const target = intent.targetIndex != null ? state.players[opp].actives[intent.targetIndex] : null;
        return target ? 1200 + (10000 - target.currentHp) / 20 : 0;
      }
      if (card.itemClass === 'equipment') {
        return intent.targetSide === 'active' ? 2000 : 900;
      }
      if (kind === 'debuff') {
        const target = intent.targetIndex != null ? state.players[opp].actives[intent.targetIndex] : null;
        if (!target) return 0;
        // Worth most against the biggest hitter — that's the ATK we're actually removing.
        const atk = getEffectiveStats(target, 'active', intent.targetIndex!, opp, state).atk;
        return 900 + atk / 10;
      }
      // Tutoring is card advantage AND fixes a specific hand — a touch above a raw draw.
      if (kind === 'tutor') return 500;
      if (kind === 'draw' || kind === 'reveal_and_draw' || kind === 'recur_from_discard') return 300;
      if (kind === 'sacrifice_for_damage') return -800; // still sacrifices a friendly fighter
      return 200;
    }

    case 'play_hero': {
      const card = getCard(intent.cardId);
      const base = intent.slot === 'active' ? 1500 : 700;
      return base + card.kiCost * 50;
    }

    case 'play_field':
      return 250;

    case 'retreat': {
      // Costs a Ki and gives up the tempo of acting this turn — only worth it when it fixes
      // a real problem (a dying fighter, a spent/stunned one) or swaps in a clearly stronger
      // fighter. Otherwise it should read as strictly worse than just doing nothing.
      const active = ps.actives[intent.activeIndex];
      const bench = ps.bench[intent.benchIndex];
      if (!active || !bench) return -1000;

      const activeStats = getEffectiveStats(active, 'active', intent.activeIndex, player, state);
      const benchStats = getEffectiveStats(bench, 'bench', intent.benchIndex, player, state);
      const activeHpFrac = active.currentHp / active.maxHp;
      const benchHpFrac = bench.currentHp / bench.maxHp;
      const activeSpent = active.hasAttackedThisTurn || active.statuses.some(s => s.key === 'stun');
      const benchSpent = bench.hasAttackedThisTurn || bench.statuses.some(s => s.key === 'stun');
      const powerGain = (benchStats.atk + benchStats.def) - (activeStats.atk + activeStats.def);

      let score = -600;
      if (activeHpFrac < 0.35 && benchHpFrac > activeHpFrac + 0.25) score += 1500; // pull a dying fighter to safety
      if (activeSpent && !benchSpent) score += 400; // free up a stunned/already-acted fighter
      if (powerGain > 800) score += Math.min(powerGain / 10, 300); // meaningfully stronger fighter waiting
      return score;
    }

    case 'draw':
      return intent.pile === 'hero' ? 100 : 90;

    case 'promote_from_bench':
      return 0;

    case 'advance_phase':
      return 50;

    case 'end_turn':
      return 40;

    default:
      return 0;
  }
}
