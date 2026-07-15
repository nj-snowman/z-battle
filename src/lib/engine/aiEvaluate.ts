import { GameState, PlayerId, PlayerState, FighterInstance } from './types';
import { getCard } from './cards';
import { getEffectiveStats } from './buffs';

const WIN_SCORE = 1_000_000;

function countFighters(ps: PlayerState): number {
  return ps.actives.filter((f): f is FighterInstance => f !== null).length +
    ps.bench.filter((f): f is FighterInstance => f !== null).length;
}

// Bench fighters count for less than actives — they aren't exposed to attack and can't act
// until promoted, but still represent real value (this is also what lets choosePromotion
// distinguish "which bench fighter should I send in" — without a bench discount, a fighter's
// stats count the same whether it's active or benched and the choice would score identically).
const BENCH_WEIGHT = 0.4;

function sumHpFraction(ps: PlayerState): number {
  let total = 0;
  for (const f of ps.actives) if (f) total += f.currentHp / f.maxHp;
  for (const f of ps.bench) if (f) total += (f.currentHp / f.maxHp) * BENCH_WEIGHT;
  return total;
}

function sumEffectivePower(state: GameState, side: PlayerId): number {
  const ps = state.players[side];
  let total = 0;
  ps.actives.forEach((f, i) => {
    if (!f) return;
    const stats = getEffectiveStats(f, 'active', i, side, state);
    total += stats.atk + stats.def;
  });
  ps.bench.forEach((f, i) => {
    if (!f) return;
    const stats = getEffectiveStats(f, 'bench', i, side, state);
    total += (stats.atk + stats.def) * BENCH_WEIGHT;
  });
  return total;
}

function countReadyAttackers(ps: PlayerState): number {
  return ps.actives.filter(
    f => f && !f.hasAttackedThisTurn && !f.summoningSick && !f.statuses.some(st => st.key === 'stun')
  ).length;
}

function handValue(ps: PlayerState): number {
  return ps.hand.reduce((sum, id) => sum + (getCard(id).cardType === 'hero' ? 2 : 1), 0);
}

// Static evaluation of a (non-search-terminal) GameState from `forPlayer`'s perspective.
// Weight ordering is deliberate: KO differential (the actual win condition) dominates,
// followed by board-collapse risk (an empty board is an instant auto-loss in this engine),
// then HP/fighter-count, effective stat power, tempo, hand value, and ki curve — each tier
// roughly an order of magnitude below the one before it, so no combination of the smaller
// terms can ever outweigh a real KO or near-empty-board threat.
export function evaluate(state: GameState, forPlayer: PlayerId): number {
  if (state.winner) return state.winner === forPlayer ? WIN_SCORE : -WIN_SCORE;

  const opp: PlayerId = forPlayer === 'p1' ? 'p2' : 'p1';
  const me = state.players[forPlayer];
  const them = state.players[opp];

  let score = 0;

  // 1. KO differential — koScoredAgainst on a player counts KOs THEY suffered.
  score += (them.koScoredAgainst - me.koScoredAgainst) * 20000;

  // 2. Board-collapse risk
  score -= me.actives.filter(f => f === null).length * 1500;
  score += them.actives.filter(f => f === null).length * 1500;
  score += (countFighters(me) - countFighters(them)) * 800;

  // 3. HP totals as a fraction of max HP
  score += (sumHpFraction(me) - sumHpFraction(them)) * 600;

  // 4. Effective board power (accounts for equipment/field/conditional buffs via getEffectiveStats).
  // Kept well below the HP/fighter-count tier — a single ultimate-tier fighter's atk+def can run
  // ~10,000+, so a weight much above this would let raw stats outweigh an actual KO swing.
  score += (sumEffectivePower(state, forPlayer) - sumEffectivePower(state, opp)) * 0.15;

  // 5. Tempo — fighters that can act right now
  score += (countReadyAttackers(me) - countReadyAttackers(them)) * 300;

  // 6. Hand/card advantage (heroes weighted 2x items — the scarcer resource)
  score += (handValue(me) - handValue(them)) * 150;

  // 7. Ki curve position (long-horizon economic signal, smallest weight)
  score += (me.kiMax - them.kiMax) * 50;

  // 8. Unspent Ki this turn — smallest weight of all. Without this, spending Ki on a move
  // with no other upside (e.g. a retreat that doesn't fix anything) looks completely free
  // to the search, since nothing else tracks the cost.
  score += (me.kiCurrent - them.kiCurrent) * 10;

  return score;
}
