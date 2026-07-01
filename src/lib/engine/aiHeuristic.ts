import { GameState, PlayerId, Intent } from './types';
import { legalMoves } from './legalMoves';
import { getCard } from './cards';
import { getEffectiveStats } from './buffs';

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
  ): number {
    const atkStats = getEffectiveStats(attacker, 'active', attackerIdx, player, state);
    const defStats = getEffectiveStats(target, 'active', targetIdx, opp, state);
    return Math.max(500, atkStats.atk + extraAtk - defStats.def);
  }

  const readyAttackers = ps.actives
    .map((f, i) => (f && !f.hasAttackedThisTurn && !f.summoningSick ? { f, i } : null))
    .filter(Boolean) as { f: NonNullable<typeof ps.actives[0]>; i: number }[];

  const oppActives = oppState.actives
    .map((f, i) => (f ? { f, i } : null))
    .filter(Boolean) as { f: NonNullable<typeof oppState.actives[0]>; i: number }[];

  const canKillNow = readyAttackers.some(({ f, i }) =>
    oppActives.some(({ f: t, i: ti }) => estimateDamage(f, i, t, ti) >= t.currentHp)
  );

  switch (state.phase) {
    case 'draw': {
      const heroesInHand = ps.hand.filter(id => getCard(id).cardType === 'hero').length;
      const emptyActives = ps.actives.filter(f => f === null).length;

      // No heroes in hand and active slot is empty — must draw a hero
      if (emptyActives > 0 && heroesInHand === 0) {
        const m = moves.find(m => m.type === 'draw' && m.pile === 'hero');
        if (m) return m;
      }

      // Active slots are all filled — prefer item over more heroes
      if (emptyActives === 0) {
        for (const pile of ['item', 'hero'] as const) {
          const m = moves.find(m => m.type === 'draw' && m.pile === pile);
          if (m) return m;
        }
      }

      // Default: draw hero to keep board filled
      for (const pile of ['hero', 'item'] as const) {
        const m = moves.find(m => m.type === 'draw' && m.pile === pile);
        if (m) return m;
      }
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
        return kind === 'draw' || kind === 'reveal_and_draw' || kind === 'recur_from_discard';
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
      const baseAttacks = moves
        .filter((m): m is Extract<Intent, { type: 'attack' }> => m.type === 'attack')
        .filter(m => !m.useKaioken && !m.useOneShotAbility && !m.useTriBeam);
      const kaiokenAttacks = moves
        .filter((m): m is Extract<Intent, { type: 'attack' }> => m.type === 'attack' && !!m.useKaioken);
      const ultimates = moves.filter(m => m.type === 'ultimate');

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

  function estimateDamage(attackerIdx: number, targetIdx: number, extraAtk = 0): number {
    const attacker = ps.actives[attackerIdx];
    const target = state.players[opp].actives[targetIdx];
    if (!attacker || !target) return 0;
    const atkStats = getEffectiveStats(attacker, 'active', attackerIdx, player, state);
    const defStats = getEffectiveStats(target, 'active', targetIdx, opp, state);
    return Math.max(500, atkStats.atk + extraAtk - defStats.def);
  }

  switch (intent.type) {
    case 'sacrifice':
      // Sacrificing an active always gifts the opponent a KO point — never voluntarily correct.
      return -1_000_000;

    case 'attack': {
      const target = state.players[opp].actives[intent.targetIndex];
      if (!target) return -1000;
      const dmg = estimateDamage(intent.attackerIndex, intent.targetIndex, intent.useKaioken ? 3000 : 0);
      let score = 500 + dmg / 10;
      if (dmg >= target.currentHp) score += 100000; // lethal this attack
      return score;
    }

    case 'ultimate':
      return 20000; // high-impact, often once-per-game — prioritize using it

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

    case 'retreat':
      return -50; // situational, rarely the best move but not self-harming

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
