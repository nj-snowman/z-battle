import { GameState, PlayerId, Intent } from './types';
import { Difficulty, DIFFICULTY_PRESETS } from './aiTypes';
import { chooseMoveHeuristic, chooseDrawPile } from './aiHeuristic';
import { chooseMoveSearch, choosePromotion } from './aiSearch';

export type { Difficulty } from './aiTypes';

export function chooseMove(state: GameState, player: PlayerId, difficulty: Difficulty = 'hard'): Intent | null {
  // Which pile to draw from is a policy call, not a tactical one — there's nothing to
  // search, since the drawn card is unknown to a fair player either way. Handling it here
  // keeps every difficulty on the same rule; left to the search, the static evaluation's
  // flat "a hero in hand is worth double an item" would take the hero pile ~90% of the
  // time and strip it bare by turn 5.
  if (state.phase === 'draw' && state.turnPlayer === player && state.pendingPromotions.length === 0) {
    const draw = chooseDrawPile(state, player);
    if (draw) return draw;
  }
  if (difficulty === 'medium') return chooseMoveHeuristic(state, player);
  return chooseMoveSearch(state, player, DIFFICULTY_PRESETS[difficulty]);
}

// Which bench fighter to promote when this player's active is KO'd.
export function chooseAiPromotion(state: GameState, player: PlayerId, difficulty: Difficulty): number {
  if (difficulty === 'medium') {
    return state.players[player].bench.findIndex(f => f !== null);
  }
  return choosePromotion(state, player);
}
