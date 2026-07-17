import { GameState, PlayerId } from './types';

// Tie: 10 full turns each (20 total) with no KOs scored by either side — a stalemate,
// not an unfinished game. Split out from checkWinLoss so it can also be checked right
// at the turn boundary (see engine.ts's advance_phase handling) without also re-running
// checkWinLoss's empty-board rule there — a board can legitimately still be undeployed
// at a turn boundary (nobody's played a hero yet), which isn't true at any of
// checkWinLoss's other call sites (they only ever fire after real combat has happened).
export function checkTie(state: GameState): GameState {
  if (state.winner) return state;
  if (
    state.turnNumber > 20 &&
    state.players.p1.koScoredAgainst === 0 &&
    state.players.p2.koScoredAgainst === 0
  ) {
    return { ...state, winner: 'tie' };
  }
  return state;
}

// ---- Win / loss check (in separate file to avoid circular deps) ----
export function checkWinLoss(state: GameState): GameState {
  if (state.winner) return state;

  // Check 7 KOs
  const p1KosScored = state.players.p2.koScoredAgainst; // KOs p1 scored = KOs against p2
  const p2KosScored = state.players.p1.koScoredAgainst;

  if (p1KosScored >= 7) return { ...state, winner: 'p1' };
  if (p2KosScored >= 7) return { ...state, winner: 'p2' };

  // Empty board check during opponent's turn
  // Check both players — if either player's board is completely empty, they lose
  for (const side of ['p1', 'p2'] as PlayerId[]) {
    const ps = state.players[side];
    const isEmpty =
      ps.actives.every(a => a === null) &&
      ps.bench.every(b => b === null);

    if (isEmpty) {
      // The other player wins
      const winner: PlayerId = side === 'p1' ? 'p2' : 'p1';
      return { ...state, winner };
    }
  }

  return checkTie(state);
}
