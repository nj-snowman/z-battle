'use client';

import React, { useState, useEffect, useRef, useCallback } from 'react';
import type { User } from '@supabase/supabase-js';
import type { RealtimeChannel } from '@supabase/supabase-js';
import { supabase } from '@/lib/supabase/client';
import type { Match } from '@/lib/supabase/types';
import type { GameState, Intent, PlayerId } from '@/lib/engine/types';
import { applyIntent } from '@/lib/engine';
import GameBoard from '@/components/game/GameBoard';
import DeckScoutModal from '@/components/game/DeckScoutModal';

interface OnlineGameScreenProps {
  matchId: string;
  myRole: PlayerId;
  user: User;
  onGameEnd: (winner: PlayerId, winnerDeck: string, myDeck: string) => void;
  onLeave: () => void;
}

// Let GameBoard's finishing-blow sequence (board shake, KO flash, narration, then the
// VICTORY/DEFEAT reveal) play out before the parent cuts away to WinScreen.
const WIN_SCREEN_DELAY_MS = 2800;

export default function OnlineGameScreen({ matchId, myRole, user, onGameEnd, onLeave }: OnlineGameScreenProps) {
  const [gameState, setGameState] = useState<GameState | null>(null);
  const [matchData, setMatchData] = useState<Match | null>(null);
  const [loading, setLoading] = useState(true);
  const [scoutDone, setScoutDone] = useState(false);
  const [pendingEnemyAttack, setPendingEnemyAttack] = useState<Intent | null>(null);
  const [pendingEnemyPlay, setPendingEnemyPlay] = useState<Intent | null>(null);
  const channelRef = useRef<RealtimeChannel | null>(null);
  const lastWriteAtRef = useRef<string | null>(null);
  const isBeamActiveRef = useRef(false);
  const bufferedStateRef = useRef<GameState | null>(null);
  const gameEndTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => { if (gameEndTimerRef.current) clearTimeout(gameEndTimerRef.current); }, []);

  const scheduleGameEnd = useCallback((winner: PlayerId, winnerDeck: string, myDeck: string) => {
    if (gameEndTimerRef.current) clearTimeout(gameEndTimerRef.current);
    gameEndTimerRef.current = setTimeout(() => onGameEnd(winner, winnerDeck, myDeck), WIN_SCREEN_DELAY_MS);
  }, [onGameEnd]);

  // Load initial state
  useEffect(() => {
    supabase.from('matches').select('*').eq('id', matchId).single().then(({ data }) => {
      if (data) {
        setMatchData(data as Match);
        if (data.state) setGameState(data.state as GameState);
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
      setGameState(buffered);
      if (buffered.winner) {
        scheduleGameEnd(buffered.winner, buffered.players[buffered.winner].deck, buffered.players[myRole].deck);
      }
    }
  }, [pendingEnemyAttack, myRole, scheduleGameEnd]);

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
          setGameState(incoming);
          if (incoming.winner) {
            scheduleGameEnd(incoming.winner, incoming.players[incoming.winner].deck, incoming.players[myRole].deck);
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
          setPendingEnemyPlay(intent);
        }
      })
      .subscribe();

    channelRef.current = channel;
    return () => { supabase.removeChannel(channel); channelRef.current = null; };
  }, [matchId, myRole, scheduleGameEnd]);

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
    setGameState(newState);

    const winnerUuid = newState.winner
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
      scheduleGameEnd(newState.winner, newState.players[newState.winner].deck, newState.players[myRole].deck);
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
      onEnemyPlayDone={() => setPendingEnemyPlay(null)}
    />
  );
}
