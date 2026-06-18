'use client';

import React, { useState, useEffect, useRef, useCallback } from 'react';
import type { User } from '@supabase/supabase-js';
import type { RealtimeChannel } from '@supabase/supabase-js';
import { supabase } from '@/lib/supabase/client';
import type { Match } from '@/lib/supabase/types';
import type { GameState, Intent, PlayerId } from '@/lib/engine/types';
import { applyIntent } from '@/lib/engine';
import GameBoard from '@/components/game/GameBoard';

interface OnlineGameScreenProps {
  matchId: string;
  myRole: PlayerId;
  user: User;
  onGameEnd: (winner: PlayerId, winnerDeck: string, myDeck: string) => void;
  onLeave: () => void;
}

export default function OnlineGameScreen({ matchId, myRole, user, onGameEnd, onLeave }: OnlineGameScreenProps) {
  const [gameState, setGameState] = useState<GameState | null>(null);
  const [matchData, setMatchData] = useState<Match | null>(null);
  const [loading, setLoading] = useState(true);
  const [pendingEnemyAttack, setPendingEnemyAttack] = useState<Intent | null>(null);
  const [pendingEnemyPlay, setPendingEnemyPlay] = useState<Intent | null>(null);
  const channelRef = useRef<RealtimeChannel | null>(null);

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
          setGameState(incoming);
          if (incoming.winner) {
            onGameEnd(incoming.winner, incoming.players[incoming.winner].deck, incoming.players[myRole].deck);
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
  }, [matchId, myRole, onGameEnd]);

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

    await supabase.from('matches').update({
      state: newState,
      status: newState.winner ? 'finished' : 'active',
      winner: winnerUuid,
      updated_at: new Date().toISOString(),
    }).eq('id', matchId);

    if (newState.winner) {
      onGameEnd(newState.winner, newState.players[newState.winner].deck, newState.players[myRole].deck);
    }
  }, [gameState, matchData, matchId, myRole, onGameEnd]);

  if (loading) {
    return (
      <div style={{ width: '100%', maxWidth: 430, minHeight: '100dvh', margin: '0 auto', background: 'var(--bg)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <span style={{ fontFamily: 'Bangers, sans-serif', fontSize: 14, color: 'var(--muted)', letterSpacing: 2, textTransform: 'uppercase' }}>
          LOADING…
        </span>
      </div>
    );
  }

  if (!gameState) {
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
