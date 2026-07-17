// Self-play fuzzer: plays many full games end-to-end (AI vs AI, real engine — no mocking)
// and asserts structural invariants after every move. This is a broad, cheap safety net
// for "impossible state" bugs (the kind unit tests for one specific ability tend to miss):
// turns changing only when they should, fighters KO'd exactly when their HP hits 0, and
// the game ending exactly when the win condition is actually met.
import { createInitialState } from '../setup';
import { applyIntent } from '../engine';
import { legalMoves } from '../legalMoves';
import { chooseMove, chooseAiPromotion } from '../ai';
import { DECKS } from '../cards';
import { GameState, PlayerId, Intent, Phase } from '../types';
import type { Difficulty } from '../aiTypes';

const DECK_IDS = Object.keys(DECKS);
const MAX_INTENTS_PER_GAME = 800; // guards against a genuine softlock hanging the test run
const LOSS_KO_THRESHOLD = 7; // mirrors utils.ts checkWinLoss

interface Violation {
  game: string;
  step: number;
  message: string;
}

function boardIsEmpty(state: GameState, side: PlayerId): boolean {
  const ps = state.players[side];
  return ps.actives.every(f => f === null) && ps.bench.every(f => f === null);
}

// ---- Invariant checks, run after every applied intent ----

function checkNoUnkoedZeroHp(state: GameState, v: Violation[], game: string, step: number) {
  for (const side of ['p1', 'p2'] as PlayerId[]) {
    for (const slotName of ['actives', 'bench'] as const) {
      for (const f of state.players[side][slotName]) {
        if (f && f.currentHp <= 0) {
          v.push({ game, step, message: `${side} ${slotName} fighter "${f.cardId}" has ${f.currentHp} HP but was never KO'd/removed from the board` });
        }
      }
    }
  }
}

function checkStatBounds(state: GameState, v: Violation[], game: string, step: number) {
  for (const side of ['p1', 'p2'] as PlayerId[]) {
    const ps = state.players[side];
    if (ps.kiCurrent < 0) v.push({ game, step, message: `${side} kiCurrent went negative: ${ps.kiCurrent}` });
    if (ps.kiCurrent > ps.kiMax) v.push({ game, step, message: `${side} kiCurrent (${ps.kiCurrent}) exceeds kiMax (${ps.kiMax})` });
    if (ps.kiMax > 8) v.push({ game, step, message: `${side} kiMax exceeded the 8 cap: ${ps.kiMax}` });
    for (const slotName of ['actives', 'bench'] as const) {
      for (const f of ps[slotName]) {
        if (f && f.currentHp > f.maxHp) {
          v.push({ game, step, message: `${side} ${slotName} fighter "${f.cardId}" currentHp (${f.currentHp}) exceeds maxHp (${f.maxHp})` });
        }
      }
    }
  }
}

function checkWinCondition(state: GameState, v: Violation[], game: string, step: number, everDeployed: Record<PlayerId, boolean>) {
  for (const side of ['p1', 'p2'] as PlayerId[]) {
    if (!boardIsEmpty(state, side)) everDeployed[side] = true;
  }
  if (state.winner) return; // already ended — nothing to check going forward
  for (const side of ['p1', 'p2'] as PlayerId[]) {
    const other: PlayerId = side === 'p1' ? 'p2' : 'p1';
    if (state.players[side].koScoredAgainst >= LOSS_KO_THRESHOLD) {
      v.push({ game, step, message: `${side} has ${state.players[side].koScoredAgainst} KOs scored against them (>= ${LOSS_KO_THRESHOLD}) but the game has no winner yet` });
    }
    // A side's board is legitimately empty before they've ever deployed a first hero
    // (start of the game) — only a loss once they've had a fighter in play and lost it.
    if (everDeployed[side] && boardIsEmpty(state, side)) {
      v.push({ game, step, message: `${side}'s board (actives + bench) is completely empty but the game has no winner yet (expected ${other} to win)` });
    }
  }
}

function checkTurnProgression(
  before: { turnPlayer: PlayerId; phase: Phase; turnNumber: number },
  after: GameState,
  intent: Intent,
  v: Violation[],
  game: string,
  step: number
) {
  if (after.turnPlayer === before.turnPlayer) return; // no turn change — nothing to verify here

  // The only ways turnPlayer legitimately changes: 'advance_phase' while already in the
  // 'end' phase, or 'end_turn' (which forces 'end' then does the same switch internally).
  if (intent.type !== 'advance_phase' && intent.type !== 'end_turn') {
    v.push({ game, step, message: `turnPlayer switched from ${before.turnPlayer} to ${after.turnPlayer} via a "${intent.type}" intent, not advance_phase/end_turn` });
    return;
  }
  if (intent.type === 'advance_phase' && before.phase !== 'end') {
    v.push({ game, step, message: `turnPlayer switched via advance_phase but the prior phase was "${before.phase}", not "end"` });
  }
  if (after.phase !== 'draw') {
    v.push({ game, step, message: `after a turn switch, phase is "${after.phase}" instead of "draw"` });
  }
  const newTp = after.players[after.turnPlayer];
  if (newTp.kiCurrent !== newTp.kiMax) {
    v.push({ game, step, message: `after a turn switch, ${after.turnPlayer}'s kiCurrent (${newTp.kiCurrent}) doesn't match kiMax (${newTp.kiMax})` });
  }
}

// ---- Game driver ----

function playOneGame(p1Deck: string, p2Deck: string, difficulty: Difficulty, label: string): Violation[] {
  const v: Violation[] = [];
  let s = createInitialState(p1Deck, p2Deck, Math.random() < 0.5 ? 'p1' : 'p2');
  let step = 0;
  const everDeployed: Record<PlayerId, boolean> = { p1: false, p2: false };

  while (s.winner === null) {
    if (step >= MAX_INTENTS_PER_GAME) {
      v.push({ game: label, step, message: `game did not finish within ${MAX_INTENTS_PER_GAME} intents — possible softlock` });
      break;
    }
    step++;

    if (s.pendingPromotions.length > 0) {
      const pending = s.pendingPromotions[0];
      let benchIndex = chooseAiPromotion(s, pending.side, difficulty);
      if (benchIndex === -1 || s.players[pending.side].bench[benchIndex] == null) {
        benchIndex = s.players[pending.side].bench.findIndex(f => f !== null);
      }
      if (benchIndex === -1) {
        v.push({ game: label, step, message: `pendingPromotion queued for ${pending.side} with no bench fighter available — should have been dropped instead of left stuck` });
        break;
      }
      try {
        s = applyIntent(s, { type: 'promote_from_bench', benchIndex });
      } catch (e) {
        v.push({ game: label, step, message: `promote_from_bench threw: ${(e as Error).message}` });
        break;
      }
      checkNoUnkoedZeroHp(s, v, label, step);
      checkStatBounds(s, v, label, step);
      checkWinCondition(s, v, label, step, everDeployed);
      continue;
    }

    const moves = legalMoves(s, s.turnPlayer);
    if (moves.length === 0) {
      v.push({ game: label, step, message: `legalMoves(${s.turnPlayer}) returned no moves in phase "${s.phase}" with no pending promotion — stuck game` });
      break;
    }

    let intent = chooseMove(s, s.turnPlayer, difficulty);
    const isOffered = (i: Intent | null) => !!i && moves.some(m => JSON.stringify(m) === JSON.stringify(i));
    if (!isOffered(intent)) {
      // AI declined or (bug) suggested something illegal — fall back to a random legal move
      // so the fuzzer keeps exploring instead of stalling on an AI edge case.
      intent = moves[Math.floor(Math.random() * moves.length)];
    }

    const before = { turnPlayer: s.turnPlayer, phase: s.phase, turnNumber: s.players[s.turnPlayer].turnNumber };
    try {
      s = applyIntent(s, intent!);
    } catch (e) {
      v.push({ game: label, step, message: `applyIntent threw on a legalMoves()-offered intent ${JSON.stringify(intent)}: ${(e as Error).message}` });
      break;
    }

    checkTurnProgression(before, s, intent!, v, label, step);
    checkNoUnkoedZeroHp(s, v, label, step);
    checkStatBounds(s, v, label, step);
    checkWinCondition(s, v, label, step, everDeployed);
  }

  return v;
}

describe('Self-play fuzzer', () => {
  it('plays many full games across deck matchups without hitting an invariant violation', () => {
    const allViolations: Violation[] = [];
    let gamesPlayed = 0;

    // Every deck mirrored against itself, and against its neighbour in rotation —
    // covers every deck at least twice without the cost of the full 7x7 matrix.
    const matchups: Array<[string, string]> = [];
    for (let i = 0; i < DECK_IDS.length; i++) {
      matchups.push([DECK_IDS[i], DECK_IDS[i]]);
      matchups.push([DECK_IDS[i], DECK_IDS[(i + 1) % DECK_IDS.length]]);
    }

    for (const [p1Deck, p2Deck] of matchups) {
      for (const difficulty of ['medium', 'hard'] as Difficulty[]) {
        const label = `${p1Deck} vs ${p2Deck} (${difficulty})`;
        allViolations.push(...playOneGame(p1Deck, p2Deck, difficulty, label));
        gamesPlayed++;
      }
    }

    expect(gamesPlayed).toBeGreaterThan(0);
    if (allViolations.length > 0) {
      const summary = allViolations
        .slice(0, 25)
        .map(x => `  [${x.game} @ step ${x.step}] ${x.message}`)
        .join('\n');
      const more = allViolations.length > 25 ? `\n  ...and ${allViolations.length - 25} more` : '';
      throw new Error(`${allViolations.length} invariant violation(s) across ${gamesPlayed} self-play games:\n${summary}${more}`);
    }
  }, 60000);
});
