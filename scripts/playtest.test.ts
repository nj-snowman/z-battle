/**
 * Deck playtest harness — NOT part of the default test suite (jest's testMatch only picks
 * up files under __tests__/). Run it with:
 *
 *   npm run playtest                 # default sample size
 *   PLAYTEST_GAMES=12 npm run playtest
 *   PLAYTEST_FOCUS=rascals npm run playtest
 *   PLAYTEST_DIFFICULTY=medium npm run playtest
 *
 * It plays a full round-robin (every deck against every other, plus mirrors, in both
 * seats to cancel out first-player advantage) and reports two things:
 *
 *   1. Win rate per deck, so an outlier deck is visible against the rest of the field
 *      rather than judged in isolation.
 *   2. How often each of the FOCUS deck's signature mechanics actually fired, so a
 *      "balanced" result can't be hiding a mechanic that silently never triggers.
 */
import { createInitialState } from '../src/lib/engine/setup';
import { applyIntent } from '../src/lib/engine/engine';
import { legalMoves } from '../src/lib/engine/legalMoves';
import { chooseMove, chooseAiPromotion } from '../src/lib/engine/ai';
import { DECKS, getCard } from '../src/lib/engine/cards';
import { heroPlayCost } from '../src/lib/engine/buffs';
import { GameState, PlayerId, Intent, FighterInstance } from '../src/lib/engine/types';
import type { Difficulty } from '../src/lib/engine/aiTypes';

const DECK_IDS = Object.keys(DECKS);
const FOCUS = process.env.PLAYTEST_FOCUS ?? 'rascals';
const GAMES_PER_SEAT = Number(process.env.PLAYTEST_GAMES ?? 4);
const DIFFICULTY = (process.env.PLAYTEST_DIFFICULTY ?? 'hard') as Difficulty;
const MAX_INTENTS = 900;

// ---- Mechanic instrumentation -------------------------------------------------

const MECHANICS = [
  'pair_both_active',      // Goten + Kid Trunks both Active (stat borrowing live)
  'borrow_changed_stat',   // ...and the borrow actually moved a number
  'fusion_discount',       // Gotenks played for less than its printed 6
  'ghost_placed',
  'ghost_discharged',
  'hidden_power',
  'ninja_dog',
  'reincarnation',
  'power_pole_strike',
  'tutor',
  'prank_kit',
  'pan_solo',              // Pan on an otherwise empty board (Feisty live)
  'capsule_corp_yard',
  'pilafs_castle',
  'pilaf_scheming',
  // "offered" counters separate "the engine never made this legal" (a bug) from
  // "the AI was offered it and declined" (a judgement call).
  'OFFERED_tutor',
  'OFFERED_power_pole',
  'OFFERED_prank_kit',
] as const;
type Mechanic = typeof MECHANICS[number];

type Counts = Record<Mechanic, number>;
const zeroCounts = (): Counts =>
  Object.fromEntries(MECHANICS.map(m => [m, 0])) as Counts;

const allFighters = (s: GameState, side: PlayerId): FighterInstance[] =>
  [...s.players[side].actives, ...s.players[side].bench].filter((f): f is FighterInstance => !!f);

const ghostKeys = (s: GameState): Map<string, string> => {
  const m = new Map<string, string>();
  for (const side of ['p1', 'p2'] as PlayerId[]) {
    (['actives', 'bench'] as const).forEach(zone => {
      s.players[side][zone].forEach((f, i) => {
        if (f && (f.counters['ghost'] ?? 0) > 0) m.set(`${side}-${zone}-${i}`, f.cardId);
      });
    });
  }
  return m;
};

const usedFlags = (s: GameState): Set<string> => {
  const out = new Set<string>();
  for (const side of ['p1', 'p2'] as PlayerId[]) {
    for (const f of allFighters(s, side)) {
      for (const [k, v] of Object.entries(f.oncePerGameUsed)) {
        if (v) out.add(`${f.cardId}:${k}`);
      }
    }
  }
  return out;
};

/** Mechanics observable from the state itself, checked continuously. */
function observeState(s: GameState, focusSide: PlayerId | null, hit: (m: Mechanic) => void) {
  if (!focusSide) return;
  const ps = s.players[focusSide];
  const actives = ps.actives;
  const hasGoten = actives.some(f => f?.cardId === 'goten');
  const hasTrunks = actives.some(f => f?.cardId === 'kid_trunks');
  if (hasGoten && hasTrunks) {
    hit('pair_both_active');
    // Confirm the borrow moved a real number rather than just being "eligible":
    // Goten's printed ATK is 4,500 and Trunks's is 5,500, so a live borrow reads 5,500+.
    const gotenIdx = actives.findIndex(f => f?.cardId === 'goten');
    if (gotenIdx !== -1) {
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      const { getEffectiveStats } = require('../src/lib/engine/buffs');
      const st = getEffectiveStats(actives[gotenIdx]!, 'active', gotenIdx, focusSide, s);
      if (st.atk !== (getCard('goten').atk ?? 0)) hit('borrow_changed_stat');
    }
  }
  const inPlay = allFighters(s, focusSide);
  if (inPlay.length === 1 && inPlay[0].cardId === 'pan') hit('pan_solo');
  if (s.field === 'capsule_corp_yard') hit('capsule_corp_yard');
  if (s.field === 'pilafs_castle') hit('pilafs_castle');
}

// ---- Game driver ---------------------------------------------------------------

interface GameResult {
  winner: 'p1' | 'p2' | 'tie' | 'unfinished';
  turns: number;
  mechanics: Set<Mechanic>;
}

function playGame(p1Deck: string, p2Deck: string, difficulty: Difficulty, seed: number): GameResult {
  let s = createInitialState(p1Deck, p2Deck, seed % 2 === 0 ? 'p1' : 'p2');
  const fired = new Set<Mechanic>();
  const hit = (m: Mechanic) => fired.add(m);

  // Which seat (if either) is the deck whose mechanics we're instrumenting.
  const focusSide: PlayerId | null =
    p1Deck === FOCUS ? 'p1' : p2Deck === FOCUS ? 'p2' : null;

  let step = 0;
  let prevGhosts = ghostKeys(s);
  let prevUsed = usedFlags(s);

  while (s.winner === null && step < MAX_INTENTS) {
    step++;

    if (s.pendingPromotions.length > 0) {
      const pending = s.pendingPromotions[0];
      let benchIndex = chooseAiPromotion(s, pending.side, difficulty);
      if (benchIndex === -1 || s.players[pending.side].bench[benchIndex] == null) {
        benchIndex = s.players[pending.side].bench.findIndex(f => f !== null);
      }
      if (benchIndex === -1) break;
      s = applyIntent(s, { type: 'promote_from_bench', benchIndex });
      continue;
    }

    const moves = legalMoves(s, s.turnPlayer);
    if (moves.length === 0) break;

    // Was the option even on the table this turn?
    if (focusSide && s.turnPlayer === focusSide) {
      for (const m of moves) {
        if (m.type === 'play_item' && m.tutorCardId) hit('OFFERED_tutor');
        if (m.type === 'play_item' && m.cardId === 'prank_kit') hit('OFFERED_prank_kit');
        if (m.type === 'attack' && m.useOneShotAbility) {
          const a = s.players[focusSide].actives[m.attackerIndex];
          if (a?.cardId === 'kid_goku') hit('OFFERED_power_pole');
        }
      }
    }

    let intent = chooseMove(s, s.turnPlayer, difficulty);
    const offered = !!intent && moves.some(m => JSON.stringify(m) === JSON.stringify(intent));
    if (!offered) intent = moves[Math.floor(Math.random() * moves.length)];

    // --- intent-level instrumentation (only for the focus deck's own plays) ---
    const actingSide = s.turnPlayer;
    if (focusSide && actingSide === focusSide && intent) {
      if (intent.type === 'play_hero') {
        const card = getCard(intent.cardId);
        if (heroPlayCost(card, actingSide, s) < card.kiCost) hit('fusion_discount');
        if (intent.cardId === 'emperor_pilaf') hit('pilaf_scheming');
      }
      if (intent.type === 'play_item') {
        if (intent.tutorCardId) hit('tutor');
        if (intent.cardId === 'prank_kit') hit('prank_kit');
      }
      if (intent.type === 'attack' && intent.useOneShotAbility) {
        const a = s.players[actingSide].actives[intent.attackerIndex];
        if (a?.cardId === 'kid_goku') hit('power_pole_strike');
      }
    }

    try {
      s = applyIntent(s, intent!);
    } catch {
      break;
    }

    // --- state-diff instrumentation ---
    const nowGhosts = ghostKeys(s);
    if (focusSide) {
      // A ghost only ever exists because the focus deck's Gotenks placed it (it's the
      // only source), so counting them globally is safe.
      for (const k of nowGhosts.keys()) if (!prevGhosts.has(k)) hit('ghost_placed');
      for (const [k, cardId] of prevGhosts) {
        const [side, zone, idxStr] = k.split('-');
        const slots = zone === 'actives'
          ? s.players[side as PlayerId].actives
          : s.players[side as PlayerId].bench;
        const f = slots[Number(idxStr)];
        if (f && f.cardId === cardId && (f.counters['ghost'] ?? 0) === 0) hit('ghost_discharged');
      }

      const nowUsed = usedFlags(s);
      for (const flag of nowUsed) {
        if (prevUsed.has(flag)) continue;
        if (flag === 'kid_gohan:hidden_power') hit('hidden_power');
        if (flag === 'shu:ninja_dog') hit('ninja_dog');
        if (flag === 'uub:reincarnation') hit('reincarnation');
      }
      prevUsed = nowUsed;
    }
    prevGhosts = nowGhosts;

    observeState(s, focusSide, hit);
  }

  return {
    winner: s.winner ?? 'unfinished',
    turns: s.turnNumber,
    mechanics: fired,
  };
}

// ---- Reporting -----------------------------------------------------------------

interface Tally { wins: number; losses: number; ties: number; unfinished: number }
const newTally = (): Tally => ({ wins: 0, losses: 0, ties: 0, unfinished: 0 });
const played = (t: Tally) => t.wins + t.losses + t.ties;
const winPct = (t: Tally) => (played(t) === 0 ? 0 : (t.wins / played(t)) * 100);

function bar(pct: number, width = 24): string {
  const filled = Math.round((pct / 100) * width);
  return '█'.repeat(Math.max(0, filled)) + '·'.repeat(Math.max(0, width - filled));
}

describe(`Playtest — ${FOCUS} vs the field`, () => {
  it('reports win rates and mechanic coverage', () => {
    const overall: Record<string, Tally> = {};
    const focusVs: Record<string, Tally> = {};
    const mechanicGames = zeroCounts();
    let focusGames = 0;
    let totalTurns = 0;
    let totalGames = 0;
    const started = Date.now();

    for (const id of DECK_IDS) overall[id] = newTally();

    // Every unordered pair (including mirrors), played in both seats.
    for (let i = 0; i < DECK_IDS.length; i++) {
      for (let j = i; j < DECK_IDS.length; j++) {
        const a = DECK_IDS[i];
        const b = DECK_IDS[j];
        for (let g = 0; g < GAMES_PER_SEAT; g++) {
          for (const [p1, p2] of [[a, b], [b, a]] as Array<[string, string]>) {
            if (a === b && p1 !== p2) continue; // mirror: one orientation is enough
            const r = playGame(p1, p2, DIFFICULTY, g);
            totalGames++;
            totalTurns += r.turns;

            const record = (deck: string, seat: 'p1' | 'p2') => {
              const t = overall[deck];
              if (r.winner === 'unfinished') t.unfinished++;
              else if (r.winner === 'tie') t.ties++;
              else if (r.winner === seat) t.wins++;
              else t.losses++;
            };
            if (p1 !== p2) { record(p1, 'p1'); record(p2, 'p2'); }

            // Focus-deck bookkeeping
            const focusSeat: 'p1' | 'p2' | null = p1 === FOCUS ? 'p1' : p2 === FOCUS ? 'p2' : null;
            if (focusSeat) {
              focusGames++;
              for (const m of r.mechanics) mechanicGames[m]++;
              const opponent = focusSeat === 'p1' ? p2 : p1;
              focusVs[opponent] ??= newTally();
              const t = focusVs[opponent];
              if (r.winner === 'unfinished') t.unfinished++;
              else if (r.winner === 'tie') t.ties++;
              else if (r.winner === focusSeat) t.wins++;
              else t.losses++;
            }
          }
        }
      }
    }

    const elapsed = ((Date.now() - started) / 1000).toFixed(1);
    const lines: string[] = [];
    lines.push('');
    lines.push(`=== PLAYTEST: ${totalGames} games, difficulty="${DIFFICULTY}", ${GAMES_PER_SEAT} games/seat/pair, ${elapsed}s ===`);
    lines.push(`    avg game length: ${(totalTurns / totalGames).toFixed(1)} turns`);
    lines.push('');
    lines.push('--- Overall win rate (full round-robin, both seats, mirrors excluded) ---');
    const ranked = DECK_IDS
      .map(id => ({ id, t: overall[id] }))
      .sort((x, y) => winPct(y.t) - winPct(x.t));
    for (const { id, t } of ranked) {
      const marker = id === FOCUS ? ' <<<' : '';
      lines.push(
        `  ${id.padEnd(14)} ${bar(winPct(t))} ${winPct(t).toFixed(1).padStart(5)}%  ` +
        `(${t.wins}W ${t.losses}L ${t.ties}T${t.unfinished ? ` ${t.unfinished}U` : ''})${marker}`
      );
    }
    const pcts = ranked.map(r => winPct(r.t));
    lines.push(`  spread: ${Math.min(...pcts).toFixed(1)}% – ${Math.max(...pcts).toFixed(1)}%`);
    lines.push('');
    lines.push(`--- ${FOCUS} head-to-head ---`);
    for (const opp of Object.keys(focusVs).sort()) {
      const t = focusVs[opp];
      lines.push(
        `  vs ${opp.padEnd(14)} ${bar(winPct(t))} ${winPct(t).toFixed(1).padStart(5)}%  ` +
        `(${t.wins}W ${t.losses}L ${t.ties}T${t.unfinished ? ` ${t.unfinished}U` : ''})`
      );
    }
    lines.push('');
    lines.push(`--- ${FOCUS} mechanic coverage (games where it fired at least once, of ${focusGames}) ---`);
    for (const m of MECHANICS) {
      const n = mechanicGames[m];
      const pct = focusGames ? (n / focusGames) * 100 : 0;
      const flag = n === 0 ? '  ** NEVER FIRED **' : '';
      lines.push(`  ${m.padEnd(22)} ${String(n).padStart(4)} / ${focusGames}  ${pct.toFixed(0).padStart(3)}%${flag}`);
    }
    lines.push('');

    // eslint-disable-next-line no-console
    console.log(lines.join('\n'));

    expect(totalGames).toBeGreaterThan(0);
  }, 3_600_000);
});
