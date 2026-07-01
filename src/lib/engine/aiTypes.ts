export type Difficulty = 'medium' | 'hard' | 'strongest';

export interface AiConfig {
  difficulty: Difficulty;
  maxPly: number; // hard ceiling on plies searched even if time remains
  beamWidth: number; // top-K moves expanded per node after heuristic ordering
  timeBudgetMs: number; // wall-clock budget for the whole chooseMove call
}

export const DIFFICULTY_PRESETS: Record<Difficulty, AiConfig> = {
  medium: { difficulty: 'medium', maxPly: 0, beamWidth: 0, timeBudgetMs: 0 },
  hard: { difficulty: 'hard', maxPly: 10, beamWidth: 6, timeBudgetMs: 150 },
  strongest: { difficulty: 'strongest', maxPly: 22, beamWidth: 10, timeBudgetMs: 900 },
};
