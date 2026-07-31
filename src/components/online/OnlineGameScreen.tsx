'use client';

import React, { useState, useEffect, useRef, useCallback } from 'react';
import type { User } from '@supabase/supabase-js';
import type { RealtimeChannel } from '@supabase/supabase-js';
import { supabase } from '@/lib/supabase/client';
import type { Match } from '@/lib/supabase/types';
import type { GameState, Intent, PlayerId, GameOutcome } from '@/lib/engine/types';
import { applyIntent, getCard } from '@/lib/engine';
import GameBoard from '@/components/game/GameBoard';
import DeckScoutModal from '@/components/game/DeckScoutModal';

interface OnlineGameScreenProps {
  matchId: string;
  myRole: PlayerId;
  user: User;
  onGameEnd: (winner: GameOutcome, winnerDeck: string | undefined, myDeck: string) => void;
  onLeave: () => void;
}

// Let GameBoard's finishing-blow sequence (board shake, KO flash, narration, then the
// VICTORY/DEFEAT reveal) play out before the parent cuts away to WinScreen.
const WIN_SCREEN_DELAY_MS = 3800;

// A tie has no single winning deck to show.
function winnerDeckOf(state: GameState, winner: GameOutcome): string | undefined {
  return winner === 'tie' ? undefined : state.players[winner].deck;
}

// How long after animating a card play we still treat the other delivery path's copy of it
// as a duplicate. The broadcast and the state UPDATE for one play land within about a
// second of each other; a human can't play the same card twice inside this window.
const PLAY_ANIM_DEDUPE_MS = 4000;

// Consumables are the only plays that can leave no trace on the board — a Scouter reveals a
// hand and is gone, where equipment sticks to a fighter, a field swaps the backdrop, and
// damage moves HP. So they're the ones worth recovering from the durable state.
function isConsumable(cardId: string): boolean {
  try {
    const c = getCard(cardId);
    return c.cardType === 'item' && c.itemClass === 'consumable';
  } catch {
    return false;
  }
}

// Cards added to `owner`'s discard between two states. Compared as a multiset rather than by
// slicing the tail, because abilities like Dragon Clan Ritual and Bibidi's Creation pull
// entries back out of the pile.
function discardedSince(prev: GameState, next: GameState, owner: PlayerId): string[] {
  const remaining = new Map<string, number>();
  for (const e of prev.discard) {
    if (e.owner === owner) remaining.set(e.cardId, (remaining.get(e.cardId) ?? 0) + 1);
  }
  const added: string[] = [];
  for (const e of next.discard) {
    if (e.owner !== owner) continue;
    const n = remaining.get(e.cardId) ?? 0;
    if (n > 0) remaining.set(e.cardId, n - 1);
    else added.push(e.cardId);
  }
  return added;
}

export default function OnlineGameScreen({ matchId, myRole, user, onGameEnd, onLeave }: OnlineGameScreenProps) {
  const [gameState, setGameState] = useState<GameState | null>(null);
  const [matchData, setMatchData] = useState<Match | null>(null);
  const [loading, setLoading] = useState(true);
  const [scoutDone, setScoutDone] = useState(false);
  const [pendingEnemyAttack, setPendingEnemyAttack] = useState<Intent | null>(null);
  const [pendingEnemyPlay, setPendingEnemyPlay] = useState<Intent | null>(null);
  const [pendingEnemyUltimate, setPendingEnemyUltimate] = useState<Intent | null>(null);
  const channelRef = useRef<RealtimeChannel | null>(null);
  const lastWriteAtRef = useRef<string | null>(null);
  const isBeamActiveRef = useRef(false);
  const bufferedStateRef = useRef<GameState | null>(null);
  const gameEndTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // The state currently on screen — the baseline the enemy-play fallback diffs against.
  const renderedStateRef = useRef<GameState | null>(null);
  // Enemy plays animate one at a time; a second arriving mid-animation waits its turn
  // instead of overwriting (and so swallowing) the one already on screen.
  const pendingEnemyPlayRef = useRef<Intent | null>(null);
  const enemyPlayQueueRef = useRef<Intent[]>([]);
  // cardId -> when we last animated it, from either delivery path, for dedupe.
  const animatedPlaysRef = useRef<Map<string, number>>(new Map());
  const oppRole: PlayerId = myRole === 'p1' ? 'p2' : 'p1';
  useEffect(() => () => { if (gameEndTimerRef.current) clearTimeout(gameEndTimerRef.current); }, []);

  // True the first time a given play is seen; the loser of the broadcast/state race is dropped.
  const claimPlayAnim = useCallback((cardId: string) => {
    const now = Date.now();
    for (const [id, at] of animatedPlaysRef.current) {
      if (now - at > PLAY_ANIM_DEDUPE_MS) animatedPlaysRef.current.delete(id);
    }
    if (animatedPlaysRef.current.has(cardId)) return false;
    animatedPlaysRef.current.set(cardId, now);
    return true;
  }, []);

  const enqueueEnemyPlay = useCallback((intent: Intent) => {
    if (pendingEnemyPlayRef.current) {
      enemyPlayQueueRef.current.push(intent);
      return;
    }
    pendingEnemyPlayRef.current = intent;
    setPendingEnemyPlay(intent);
  }, []);

  const handleEnemyPlayDone = useCallback(() => {
    const next = enemyPlayQueueRef.current.shift() ?? null;
    pendingEnemyPlayRef.current = next;
    setPendingEnemyPlay(next);
  }, []);

  // Adopt a state that came from the opponent, animating any card play the intent broadcast
  // didn't deliver. Broadcasts are fire-and-forget: a socket blip, a backgrounded tab, or a
  // channel still mid-subscribe drops one with no retry, and for a card that changes nothing
  // visible on the board that leaves the opponent with no sign it was ever played.
  const adoptRemoteState = useCallback((incoming: GameState) => {
    const prev = renderedStateRef.current;
    if (prev) {
      const played = discardedSince(prev, incoming, oppRole).filter(isConsumable);
      // On a reconnect several plays can land at once; only the latest is worth replaying.
      const latest = played[played.length - 1];
      if (latest && claimPlayAnim(latest)) {
        enqueueEnemyPlay({ type: 'play_item', cardId: latest });
      }
    }
    renderedStateRef.current = incoming;
    setGameState(incoming);
  }, [oppRole, claimPlayAnim, enqueueEnemyPlay]);

  const scheduleGameEnd = useCallback((winner: GameOutcome, winnerDeck: string | undefined, myDeck: string) => {
    if (gameEndTimerRef.current) clearTimeout(gameEndTimerRef.current);
    gameEndTimerRef.current = setTimeout(() => onGameEnd(winner, winnerDeck, myDeck), WIN_SCREEN_DELAY_MS);
  }, [onGameEnd]);

  // Load initial state
  useEffect(() => {
    supabase.from('matches').select('*').eq('id', matchId).single().then(({ data }) => {
      if (data) {
        setMatchData(data as Match);
        if (data.state) {
          renderedStateRef.current = data.state as GameState;
          setGameState(data.state as GameState);
        }
      }
      setLoading(false);
    });
  }, [matchId]);

  // Sync beam-active ref; flush buffered state when beam ends
  useEffect(() => {
    isBeamActiveRef.current = pendingEnemyAttack !== null;
    if (!pendingEnemyAttack && bufferedStateRef.current) {
      const buffered = bufferedStateRef.current;
      bufferedStateRef.current = null;
      adoptRemoteState(buffered);
      if (buffered.winner) {
        scheduleGameEnd(buffered.winner, winnerDeckOf(buffered, buffered.winner), buffered.players[myRole].deck);
      }
    }
  }, [pendingEnemyAttack, myRole, scheduleGameEnd, adoptRemoteState]);

  // Realtime subscription
  useEffect(() => {
    const channel = supabase.channel(`match:${matchId}`)
      .on('postgres_changes', {
        event: 'UPDATE', schema: 'public', table: 'matches',
        filter: `id=eq.${matchId}`,
      }, (payload) => {
        const match = payload.new as Match;
        if (match.state) {
          const incoming = match.state as GameState;
          // Skip own echo — we already applied this state locally
          if (match.updated_at && match.updated_at === lastWriteAtRef.current) return;
          // Buffer during beam animation to prevent CSS animation reset
          if (isBeamActiveRef.current) {
            bufferedStateRef.current = incoming;
            return;
          }
          adoptRemoteState(incoming);
          if (incoming.winner) {
            scheduleGameEnd(incoming.winner, winnerDeckOf(incoming, incoming.winner), incoming.players[myRole].deck);
          }
        }
      })
      .on('broadcast', { event: 'intent' }, ({ payload }) => {
        // Show animation for opponent's plays/attacks
        if (payload.by === myRole) return;
        const intent = payload.intent as Intent;
        if (intent.type === 'attack') {
          setPendingEnemyAttack(intent);
        } else if (intent.type === 'play_item' || intent.type === 'play_field') {
          // Claim it so the state-diff fallback doesn't replay the same play behind us.
          if (intent.type === 'play_field' || claimPlayAnim(intent.cardId)) enqueueEnemyPlay(intent);
        } else if (intent.type === 'ultimate') {
          setPendingEnemyUltimate(intent);
        }
      })
      .subscribe();

    channelRef.current = channel;
    return () => { supabase.removeChannel(channel); channelRef.current = null; };
  }, [matchId, myRole, scheduleGameEnd, adoptRemoteState, claimPlayAnim, enqueueEnemyPlay]);

  const handleIntent = useCallback(async (intent: Intent) => {
    if (!gameState || !matchData) return;

    // promote_from_bench is dispatched by the defending player (not the turn player)
    if (intent.type === 'promote_from_bench') {
      const pending = gameState.pendingPromotions[0];
      if (!pending || pending.side !== myRole) return;
    } else if (gameState.turnPlayer !== myRole) {
      return;
    } else if (gameState.pendingPromotions.some(p => p.side !== myRole)) {
      // Attacker must wait — opponent is still choosing their bench replacement
      return;
    }

    // Broadcast intent to opponent so they can play the animation
    channelRef.current?.send({
      type: 'broadcast',
      event: 'intent',
      payload: { intent, by: myRole },
    });

    const newState = applyIntent(gameState, intent);
    renderedStateRef.current = newState;
    setGameState(newState);

    // A tie has no single winning uuid to persist — the `matches.winner` column stays
    // null for ties, same as an in-progress match; `status: 'finished'` disambiguates.
    const winnerUuid = newState.winner && newState.winner !== 'tie'
      ? (newState.winner === 'p1' ? matchData.player1 : matchData.player2)
      : null;

    const writeAt = new Date().toISOString();
    lastWriteAtRef.current = writeAt;
    await supabase.from('matches').update({
      state: newState,
      status: newState.winner ? 'finished' : 'active',
      winner: winnerUuid,
      updated_at: writeAt,
    }).eq('id', matchId);

    if (newState.winner) {
      scheduleGameEnd(newState.winner, winnerDeckOf(newState, newState.winner), newState.players[myRole].deck);
    }
  }, [gameState, matchData, matchId, myRole, scheduleGameEnd]);

  // Brief fetch phase — show nothing while Supabase query resolves
  if (loading) {
    return <div style={{ width: '100%', minHeight: '100dvh', background: 'var(--bg)' }} />;
  }

  if (!gameState || !matchData) {
    return (
      <div style={{ width: '100%', maxWidth: 430, minHeight: '100dvh', margin: '0 auto', background: 'var(--bg)', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 16 }}>
        <span style={{ fontFamily: 'Bangers, sans-serif', fontSize: 14, color: 'var(--muted)', letterSpacing: 2, textTransform: 'uppercase' }}>
          MATCH NOT FOUND
        </span>
        <button onClick={onLeave} style={{ background: 'transparent', border: '1px solid var(--line)', borderRadius: 8, padding: '10px 20px', cursor: 'pointer', color: 'var(--muted)', fontFamily: 'Saira Condensed, sans-serif', fontSize: 12, textTransform: 'uppercase', letterSpacing: 1 }}>
          BACK TO LOBBY
        </button>
      </div>
    );
  }

  // Show scouter screen (preloads deck images) until it signals done
  if (!scoutDone && matchData.player1_deck && matchData.player2_deck) {
    return (
      <DeckScoutModal
        p1Deck={matchData.player1_deck}
        p2Deck={matchData.player2_deck}
        onDone={() => setScoutDone(true)}
      />
    );
  }

  return (
    <GameBoard
      state={gameState}
      onIntent={handleIntent}
      onTurnEnd={() => {}}
      perspective={myRole}
      pendingEnemyAttack={pendingEnemyAttack}
      onEnemyAttackDone={() => setPendingEnemyAttack(null)}
      pendingEnemyPlay={pendingEnemyPlay}
      onEnemyPlayDone={handleEnemyPlayDone}
      pendingEnemyUltimate={pendingEnemyUltimate}
      onEnemyUltimateDone={() => setPendingEnemyUltimate(null)}
    />
  );
}
