import { applyIntent } from '../engine';
import { legalMoves } from '../legalMoves';
import type { GameState, PlayerState, FighterInstance } from '../types';

function mkFighter(cardId: string, hp: number): FighterInstance {
  return {
    cardId, maxHp: hp, currentHp: hp, equipment: [], summoningSick: false,
    hasAttackedThisTurn: false, oncePerGameUsed: {}, counters: {}, statuses: [],
  };
}

function mkPlayer(actives: (FighterInstance | null)[], bench: (FighterInstance | null)[]): PlayerState {
  return {
    userId: 'u', deck: 'namekian', kiMax: 8, kiCurrent: 8, koScoredAgainst: 0,
    hand: [], piles: { hero: [], item: [] },
    actives, bench,
    turnNumber: 3, friendlySaiyanKoedThisGame: false,
  };
}

test("Special Beam Cannon KO'ing both the target active and its only bench fighter doesn't softlock the other active", () => {
  const s: GameState = {
    turnPlayer: 'p1', turnNumber: 3, phase: 'battle', firstPlayer: 'p1', field: null, discard: [],
    pendingPromotions: [], winner: null, log: [], firstDamageDone: true,
    players: {
      p1: mkPlayer([mkFighter('piccolo', 9000), mkFighter('vegeta', 5000)], [null, null]),
      p2: mkPlayer(
        [mkFighter('frieza_soldier', 5000), mkFighter('cui', 5000)],
        [mkFighter('appule', 3000), null],
      ),
    },
  };

  const after = applyIntent(s, { type: 'ultimate', fighterIndex: 0, targetIndex: 0 });

  // Both the target active and its only bench fighter are gone.
  expect(after.players.p2.actives[0]).toBeNull();
  expect(after.players.p2.bench[0]).toBeNull();

  // No promotion should be left dangling — there was nothing left to promote.
  expect(after.pendingPromotions).toEqual([]);

  // The rest of the game must still be playable for both sides.
  expect(legalMoves(after, 'p1').length).toBeGreaterThan(0);
  expect(legalMoves({ ...after, turnPlayer: 'p2' }, 'p2').length).toBeGreaterThan(0);
});
