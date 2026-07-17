import { GameState, PlayerId, Intent } from './types';
import { legalMoves } from './legalMoves';
import { applyIntent } from './engine';
import { evaluate } from './aiEvaluate';
import { scoreMoveHeuristically } from './aiHeuristic';
import { AiConfig } from './aiTypes';

const WIN_SCORE = 1_000_000;
const TIME_CHECK_INTERVAL = 64;

// Sacrificing an active always gifts the opponent a KO point in this engine, and retreat/
// normal-KO alternatives always exist — it is never a correct move, so drop it up front to
// reclaim branching-factor budget for the beam search.
function filterMoves(moves: Intent[]): Intent[] {
  return moves.filter(m => m.type !== 'sacrifice');
}

function topKByHeuristic(moves: Intent[], state: GameState, mover: PlayerId, k: number): Intent[] {
  if (moves.length <= k) return moves;
  return moves
    .map(m => ({ m, s: scoreMoveHeuristically(state, mover, m) }))
    .sort((a, b) => b.s - a.s)
    .slice(0, k)
    .map(x => x.m);
}

function terminalScore(state: GameState, aiPlayer: PlayerId): number {
  if (state.winner === 'tie') return 0; // neutral — a draw is neither a win nor a loss
  return state.winner === aiPlayer ? WIN_SCORE : -WIN_SCORE;
}

interface SearchCtx {
  aiPlayer: PlayerId;
  beamWidth: number;
  deadline: number;
  nodeCount: number;
  timedOut: boolean;
}

// Checked every node, but the wall-clock read only happens every TIME_CHECK_INTERVAL nodes
// so performance.now()/Date.now() overhead doesn't itself eat into the time budget.
function timeUp(ctx: SearchCtx): boolean {
  ctx.nodeCount++;
  if (!ctx.timedOut && ctx.nodeCount % TIME_CHECK_INTERVAL === 0 && Date.now() >= ctx.deadline) {
    ctx.timedOut = true;
  }
  return ctx.timedOut;
}

function minimax(state: GameState, depth: number, alpha: number, beta: number, ctx: SearchCtx): number {
  if (state.winner) return terminalScore(state, ctx.aiPlayer);
  if (depth === 0 || timeUp(ctx)) return evaluate(state, ctx.aiPlayer);

  const mover = state.turnPlayer;
  const maximizing = mover === ctx.aiPlayer;
  const rawMoves = filterMoves(legalMoves(state, mover));
  if (rawMoves.length === 0) return evaluate(state, ctx.aiPlayer);
  const moves = topKByHeuristic(rawMoves, state, mover, ctx.beamWidth);

  let value = maximizing ? -Infinity : Infinity;
  let explored = false;
  for (const move of moves) {
    if (timeUp(ctx)) break;
    const child = applyIntent(state, move);
    const score = minimax(child, depth - 1, alpha, beta, ctx);
    explored = true;
    if (maximizing) {
      if (score > value) value = score;
      if (value > alpha) alpha = value;
    } else {
      if (score < value) value = score;
      if (value < beta) beta = value;
    }
    if (alpha >= beta) break;
  }
  return explored ? value : evaluate(state, ctx.aiPlayer);
}

function searchRoot(
  state: GameState,
  depth: number,
  ctx: SearchCtx
): { move: Intent | null; score: number } {
  const mover = state.turnPlayer;
  const rawMoves = filterMoves(legalMoves(state, mover));
  const moves = topKByHeuristic(rawMoves, state, mover, ctx.beamWidth);

  let alpha = -Infinity;
  const beta = Infinity;
  let bestMove: Intent | null = null;
  let bestScore = -Infinity;

  for (const move of moves) {
    if (timeUp(ctx)) break;
    const child = applyIntent(state, move);
    const score = minimax(child, depth - 1, alpha, beta, ctx);
    if (bestMove === null || score > bestScore) {
      bestScore = score;
      bestMove = move;
    }
    if (bestScore > alpha) alpha = bestScore;
  }
  return { move: bestMove, score: bestScore };
}

export function chooseMoveSearch(state: GameState, aiPlayer: PlayerId, config: AiConfig): Intent | null {
  const rootMoves = filterMoves(legalMoves(state, state.turnPlayer));
  if (rootMoves.length === 0) return null;
  if (rootMoves.length === 1) return rootMoves[0];

  const ctx: SearchCtx = {
    aiPlayer,
    beamWidth: config.beamWidth,
    deadline: Date.now() + config.timeBudgetMs,
    nodeCount: 0,
    timedOut: false,
  };

  let bestMove: Intent = rootMoves[0];
  let bestScore = -Infinity;

  for (let depth = 2; depth <= config.maxPly; depth += 2) {
    if (ctx.timedOut || Date.now() >= ctx.deadline) break;
    const result = searchRoot(state, depth, ctx);
    if (result.move) {
      bestMove = result.move;
      bestScore = result.score;
    }
    if (Math.abs(bestScore) >= WIN_SCORE) break; // found a forced win/loss line, no need to go deeper
    if (ctx.timedOut) break;
  }

  return bestMove;
}

// Which bench fighter should replace a KO'd active. Branching is tiny (a handful of bench
// slots at most) so an exhaustive 1-ply evaluate() comparison is enough — no search needed.
export function choosePromotion(state: GameState, player: PlayerId): number {
  const bench = state.players[player].bench;
  const candidates = bench.map((f, i) => (f ? i : -1)).filter(i => i !== -1);
  if (candidates.length === 0) return -1;
  if (candidates.length === 1) return candidates[0];

  let best = candidates[0];
  let bestScore = -Infinity;
  for (const idx of candidates) {
    const next = applyIntent(state, { type: 'promote_from_bench', benchIndex: idx });
    const score = evaluate(next, player);
    if (score > bestScore) {
      bestScore = score;
      best = idx;
    }
  }
  return best;
}
