import { GameState, PlayerId, Intent } from './types';
import { Difficulty, DIFFICULTY_PRESETS } from './aiTypes';
import { chooseMoveHeuristic } from './aiHeuristic';
import { chooseMoveSearch, choosePromotion } from './aiSearch';

export type { Difficulty } from './aiTypes';

export function chooseMove(state: GameState, player: PlayerId, difficulty: Difficulty = 'hard'): Intent | null {
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
