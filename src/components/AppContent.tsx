'use client';

import React, { useState, useCallback, useEffect, useRef } from 'react';
import type { User } from '@supabase/supabase-js';
import type { GameState, Intent, PlayerId } from '@/lib/engine/types';
import { applyIntent, createInitialState } from '@/lib/engine';
import { chooseMove, chooseAiPromotion } from '@/lib/engine/ai';
import type { Difficulty } from '@/lib/engine/aiTypes';
import { supabase } from '@/lib/supabase/client';
import type { Match } from '@/lib/supabase/types';
import AuthScreen from '@/components/auth/AuthScreen';
import LobbyScreen from '@/components/lobby/LobbyScreen';
import FriendsScreen from '@/components/friends/FriendsScreen';
import WaitingRoomScreen from '@/components/online/WaitingRoomScreen';
import OnlineGameScreen from '@/components/online/OnlineGameScreen';
import GameBoard from '@/components/game/GameBoard';
import SetupScreen, { type GameMode } from '@/components/game/SetupScreen';
import PassScreen from '@/components/game/PassScreen';
import WinScreen from '@/components/game/WinScreen';
import PowerLevelScreen from '@/components/game/PowerLevelScreen';
import ImageCacheModal, { hasImagesCached } from '@/components/ui/ImageCacheModal';
import DeckScoutModal from '@/components/game/DeckScoutModal';

type Screen =
  | 'loading' | 'auth' | 'lobby' | 'friends'
  | 'waiting_room' | 'online_game'
  | 'setup' | 'pass' | 'game' | 'win' | 'power_level';

const AI_PLAYER: PlayerId = 'p2';

const DECK_OPTIONS = [
  { id: 'saiyan', name: 'Saiyan', color: '#ff7a18' },
  { id: 'namekian', name: 'Namekian', color: '#34c759' },
  { id: 'android', name: 'Android', color: '#3aa6ff' },
  { id: 'human', name: 'Human', color: '#ffb648' },
  { id: 'frieza_force', name: 'Frieza Force', color: '#b44dff' },
];

export default function AppContent() {
  const [screen, setScreen] = useState<Screen>('loading');
  const [user, setUser] = useState<User | null>(null);
  const [isGuest, setIsGuest] = useState(false);
  const isGuestRef = useRef(false);
  useEffect(() => { isGuestRef.current = isGuest; }, [isGuest]);

  const [activeMatchId, setActiveMatchId] = useState<string | null>(null);
  const [myOnlineRole, setMyOnlineRole] = useState<PlayerId | null>(null);

  const [gameState, setGameState] = useState<GameState | null>(null);
  const gameStateRef = useRef<GameState | null>(null);
  useEffect(() => { gameStateRef.current = gameState; }, [gameState]);
  const [aiPlayer, setAiPlayer] = useState<PlayerId | null>(null);
  const [aiDifficulty, setAiDifficulty] = useState<Difficulty>('hard');
  const [currentGameMode, setCurrentGameMode] = useState<GameMode>('hotseat');
  const [winnerState, setWinnerState] = useState<{ winner: PlayerId; deck: string } | null>(null);
  const [showCacheModal, setShowCacheModal] = useState(false);
  const [pendingSetup, setPendingSetup] = useState<{
    p1Deck: string; p2Deck: string; firstPlayer: PlayerId; mode: GameMode; difficulty: Difficulty;
  } | null>(null);
  const [pendingAiAttack, setPendingAiAttack] = useState<Intent | null>(null);
  const [pendingAiPlay, setPendingAiPlay] = useState<Intent | null>(null);

  const [incomingChallenge, setIncomingChallenge] = useState<{
    matchId: string;
    challengerName: string;
    challengerDeck: string;
  } | null>(null);
  const [acceptDeck, setAcceptDeck] = useState<string | null>(null);
  const [acceptLoading, setAcceptLoading] = useState(false);

  const [pendingFriendCount, setPendingFriendCount] = useState(0);

  const [onlineFriendCount, setOnlineFriendCount] = useState(0);
  const [presenceIds, setPresenceIds] = useState<Set<string>>(new Set());
  const friendIdsRef = useRef<Set<string>>(new Set());

  // Auth listener
  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => {
      if (session?.user) {
        setUser(session.user);
        setScreen('setup');
        if (!hasImagesCached()) setShowCacheModal(true);
      } else {
        setScreen('auth');
      }
    });

    const { data: { subscription } } = supabase.auth.onAuthStateChange((_, session) => {
      if (session?.user) {
        setUser(session.user);
        setIsGuest(false);
        setScreen(s => {
          if (s === 'auth' || s === 'loading') {
            if (!hasImagesCached()) setShowCacheModal(true);
            return 'setup';
          }
          return s;
        });
      } else {
        setUser(null);
        setIncomingChallenge(null);
        setScreen(s => {
          if (s === 'game' || s === 'pass') return s;
          if (isGuestRef.current) return s;
          return 'auth';
        });
      }
    });

    return () => subscription.unsubscribe();
  }, []);

  // Incoming challenge listener
  useEffect(() => {
    if (!user) return;

    supabase.from('matches').select('*')
      .eq('player2', user.id).eq('status', 'invited')
      .maybeSingle()
      .then(async ({ data }) => {
        if (!data) return;
        const m = data as Match;
        const { data: profile } = await supabase.from('profiles').select('display_name').eq('id', m.player1).single();
        setIncomingChallenge({
          matchId: m.id,
          challengerName: profile?.display_name ?? 'Unknown',
          challengerDeck: m.player1_deck ?? '',
        });
      });

    const channel = supabase.channel(`challenges:${user.id}`)
      .on('postgres_changes', {
        event: '*', schema: 'public', table: 'matches',
        filter: `player2=eq.${user.id}`,
      }, async (payload) => {
        if (payload.eventType === 'INSERT') {
          const m = payload.new as Match;
          if (m.status === 'invited') {
            const { data: profile } = await supabase.from('profiles').select('display_name').eq('id', m.player1).single();
            setIncomingChallenge({
              matchId: m.id,
              challengerName: profile?.display_name ?? 'Unknown',
              challengerDeck: m.player1_deck ?? '',
            });
          }
        } else if (payload.eventType === 'DELETE') {
          const old = payload.old as { id?: string };
          if (old.id) setIncomingChallenge(prev => prev?.matchId === old.id ? null : prev);
        } else if (payload.eventType === 'UPDATE') {
          const m = payload.new as Match;
          if (m.status !== 'invited') setIncomingChallenge(prev => prev?.matchId === m.id ? null : prev);
        }
      })
      .subscribe();

    return () => { supabase.removeChannel(channel); };
  }, [user]);

  // Friend notifications: pending requests + online count
  useEffect(() => {
    if (!user) { setPendingFriendCount(0); setOnlineFriendCount(0); return; }

    async function refreshFriendships() {
      const { data: rows } = await supabase
        .from('friendships')
        .select('*')
        .or(`requester.eq.${user!.id},addressee.eq.${user!.id}`);
      if (!rows) return;
      const pending = rows.filter((r: { status: string; addressee: string }) => r.status === 'pending' && r.addressee === user!.id);
      setPendingFriendCount(pending.length);
      const accepted = rows.filter((r: { status: string }) => r.status === 'accepted');
      const ids = new Set(accepted.map((r: { requester: string; addressee: string }) =>
        r.requester === user!.id ? r.addressee : r.requester
      ));
      friendIdsRef.current = ids;
    }

    refreshFriendships();

    const fsChannel = supabase.channel('app-friendships-watch')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'friendships' }, refreshFriendships)
      .subscribe();

    // Track presence to compute online friend count
    ['realtime:app-presence-lobby'].forEach(topic => {
      const stale = supabase.getChannels().find(c => c.topic === topic);
      if (stale) supabase.removeChannel(stale);
    });
    const presenceChannel = supabase.channel('app-presence-lobby');
    presenceChannel
      .on('presence', { event: 'sync' }, () => {
        const state = presenceChannel.presenceState<{ userId: string }>();
        const ids = new Set(Object.values(state).flat().map(p => p.userId));
        const count = [...friendIdsRef.current].filter(id => ids.has(id)).length;
        setOnlineFriendCount(count);
        setPresenceIds(ids);
      })
      .subscribe(async (status) => {
        if (status === 'SUBSCRIBED') {
          await presenceChannel.track({ userId: user.id });
        }
      });

    return () => {
      supabase.removeChannel(fsChannel);
      presenceChannel.untrack().then(() => supabase.removeChannel(presenceChannel));
    };
  }, [user]);

  // AI turn runner
  const handleIntent = useCallback((intent: Intent) => {
    const gs = gameStateRef.current;
    if (!gs) return;
    if (gs.winner) return;
    const prevTurnPlayer = gs.turnPlayer;
    let newState = applyIntent(gs, intent);

    if (aiPlayer) {
      while (!newState.winner && newState.pendingPromotions.length > 0 && newState.pendingPromotions[0].side === aiPlayer) {
        const benchIdx = chooseAiPromotion(newState, aiPlayer, aiDifficulty);
        if (benchIdx === -1) break;
        newState = applyIntent(newState, { type: 'promote_from_bench', benchIndex: benchIdx });
      }
    }

    setGameState(newState);

    if (newState.winner) {
      setWinnerState({ winner: newState.winner, deck: newState.players[newState.winner].deck });
      if (user) {
        const mode = aiPlayer ? 'ai' : 'hotseat';
        supabase.from('game_results').insert({
          user_id: user.id,
          game_mode: mode,
          deck: newState.players['p1'].deck,
          won: newState.winner === 'p1',
        }).then(() => {});
      }
      setScreen('win');
      return;
    }

    if (newState.turnPlayer !== prevTurnPlayer) {
      if (aiPlayer) {
        setScreen('game');
      } else {
        setScreen('pass');
      }
    }
  }, [aiPlayer, aiDifficulty, user]);

  useEffect(() => {
    if (!aiPlayer || screen !== 'game' || !gameState) return;
    if (gameState.turnPlayer !== aiPlayer) return;
    if (gameState.winner) return;
    if (pendingAiAttack || pendingAiPlay) return;
    if (gameState.pendingPromotions.length > 0) return;
    const timer = setTimeout(() => {
      const move = chooseMove(gameState, aiPlayer, aiDifficulty);
      if (move) {
        if (move.type === 'attack') {
          setPendingAiAttack(move);
        } else if (move.type === 'play_item' || move.type === 'play_field') {
          setPendingAiPlay(move);
        } else {
          handleIntent(move);
        }
      }
    }, 500);
    return () => clearTimeout(timer);
  }, [aiPlayer, aiDifficulty, screen, gameState, handleIntent, pendingAiAttack, pendingAiPlay]);

  function handleSetupStart(p1Deck: string, p2Deck: string, firstPlayer: PlayerId, mode: GameMode, difficulty: Difficulty) {
    setPendingSetup({ p1Deck, p2Deck, firstPlayer, mode, difficulty });
  }

  function handlePlayOffline() {
    setIsGuest(true);
    setScreen('setup');
    if (!hasImagesCached()) setShowCacheModal(true);
  }

  function handleScoutDone() {
    if (!pendingSetup) return;
    const { p1Deck, p2Deck, firstPlayer, mode, difficulty } = pendingSetup;
    const state = createInitialState(p1Deck, p2Deck, firstPlayer);
    setGameState(state);
    setCurrentGameMode(mode);
    const ai = mode === 'vs_ai' ? AI_PLAYER : null;
    setAiPlayer(ai);
    setAiDifficulty(difficulty);
    setPendingSetup(null);
    setScreen(ai ? 'game' : 'pass');
  }

  async function handleAcceptChallenge() {
    if (!incomingChallenge || !acceptDeck || !user) return;
    setAcceptLoading(true);

    const { data: match } = await supabase.from('matches').select('*').eq('id', incomingChallenge.matchId).single();
    if (!match) { setAcceptLoading(false); return; }

    const m = match as Match;
    const firstPlayer: PlayerId = Math.random() < 0.5 ? 'p1' : 'p2';
    const gs = createInitialState(m.player1_deck!, acceptDeck, firstPlayer);

    await supabase.from('matches').update({
      player2_deck: acceptDeck,
      state: gs,
      status: 'active',
      turn_player: gs.turnPlayer === 'p1' ? m.player1 : user.id,
    }).eq('id', incomingChallenge.matchId);

    setIncomingChallenge(null);
    setAcceptDeck(null);
    setAcceptLoading(false);
    setActiveMatchId(incomingChallenge.matchId);
    setMyOnlineRole('p2');
    setScreen('online_game');
  }

  async function handleDeclineChallenge() {
    if (!incomingChallenge) return;
    await supabase.from('matches').delete().eq('id', incomingChallenge.matchId);
    setIncomingChallenge(null);
  }

  return (
    <main style={{ display: 'flex', justifyContent: 'center', alignItems: 'flex-start', minHeight: '100dvh', background: 'var(--bg)' }}>

      {screen === 'loading' && (
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', minHeight: '100dvh', width: '100%' }}>
          <span style={{ fontFamily: 'Bangers, sans-serif', fontSize: 14, color: 'var(--muted)', letterSpacing: 2 }}>…</span>
        </div>
      )}

      {screen === 'auth' && <AuthScreen onPlayOffline={handlePlayOffline} />}

      {screen === 'lobby' && user && (
        <LobbyScreen
          user={user}
          presenceIds={presenceIds}
          onCreateMatch={(id) => { setActiveMatchId(id); setMyOnlineRole('p1'); setScreen('waiting_room'); }}
          onJoinMatch={(id, role) => { setActiveMatchId(id); setMyOnlineRole(role); setScreen('online_game'); }}
          onBack={() => setScreen('setup')}
          onSignOut={() => supabase.auth.signOut()}
        />
      )}

      {screen === 'power_level' && user && (
        <PowerLevelScreen user={user} onBack={() => setScreen('setup')} />
      )}

      {screen === 'friends' && user && (
        <FriendsScreen
          user={user}
          onChallenge={(id) => { setActiveMatchId(id); setMyOnlineRole('p1'); setScreen('waiting_room'); }}
          onBack={() => setScreen('setup')}
        />
      )}

      {screen === 'waiting_room' && user && activeMatchId && (
        <WaitingRoomScreen
          matchId={activeMatchId}
          user={user}
          onMatchStarted={(id, role) => { setActiveMatchId(id); setMyOnlineRole(role); setScreen('online_game'); }}
          onCancel={() => { setActiveMatchId(null); setScreen('lobby'); }}
        />
      )}

      {screen === 'online_game' && user && activeMatchId && myOnlineRole && (
        <OnlineGameScreen
          matchId={activeMatchId}
          myRole={myOnlineRole}
          user={user}
          onGameEnd={(winner, deck, myDeck) => {
            setWinnerState({ winner, deck });
            setActiveMatchId(null);
            if (user && myOnlineRole) {
              supabase.from('game_results').insert({
                user_id: user.id,
                game_mode: 'online',
                deck: myDeck,
                won: winner === myOnlineRole,
              }).then(() => {});
            }
            setScreen('win');
          }}
          onLeave={() => { setActiveMatchId(null); setScreen('lobby'); }}
        />
      )}

      {screen === 'setup' && (
        <SetupScreen
          onStart={handleSetupStart}
          userEmail={user?.email}
          isGuest={isGuest}
          onOpenFriends={user ? () => setScreen('friends') : undefined}
          pendingFriendCount={pendingFriendCount}
          onlineFriendCount={onlineFriendCount}
          onPowerLevel={user ? () => setScreen('power_level') : undefined}
          onVsFriend={user ? () => setScreen('lobby') : undefined}
          onSignOut={isGuest ? () => { setIsGuest(false); setScreen('auth'); } : user ? () => supabase.auth.signOut() : undefined}
          onCacheImages={() => setShowCacheModal(true)}
        />
      )}

      {(screen === 'game' || screen === 'pass') && gameState && (
        <>
          <GameBoard
            state={gameState}
            onIntent={screen === 'pass' ? () => {} : handleIntent}
            onTurnEnd={() => {}}
            perspective={aiPlayer !== null ? 'p1' : undefined}
            pendingEnemyAttack={pendingAiAttack}
            onEnemyAttackDone={(intent) => {
              setPendingAiAttack(null);
              handleIntent(intent);
            }}
            pendingEnemyPlay={pendingAiPlay}
            onEnemyPlayDone={(intent) => {
              setPendingAiPlay(null);
              handleIntent(intent);
            }}
          />
          {screen === 'pass' && (
            <div style={{
              position: 'fixed', inset: 0, zIndex: 400,
              background: 'rgb(13,15,20)',
              display: 'flex', flexDirection: 'column',
              alignItems: 'center', justifyContent: 'center', gap: 24,
            }}>
              <p style={{ fontFamily: 'Saira Condensed, sans-serif', fontSize: 12, color: 'var(--muted)', letterSpacing: 3, textTransform: 'uppercase', margin: 0 }}>
                Up next
              </p>
              <h1 style={{
                fontFamily: 'Bangers, sans-serif', fontSize: 42, margin: 0, letterSpacing: 2,
                background: 'linear-gradient(135deg, var(--ki), var(--ki2))',
                WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent', backgroundClip: 'text',
              }}>
                {gameState.turnPlayer === 'p1' ? 'PLAYER 1' : 'PLAYER 2'}
              </h1>
              <p style={{ fontFamily: 'Saira Condensed, sans-serif', fontSize: 11, color: 'var(--muted)', letterSpacing: 2, textTransform: 'uppercase', margin: 0 }}>
                Hand the device to the other player
              </p>
              <button onClick={() => setScreen('game')} style={{
                marginTop: 8,
                background: 'linear-gradient(135deg, var(--ki), var(--ki2))',
                border: 'none', borderRadius: 12, padding: '16px 48px', cursor: 'pointer',
                fontFamily: 'Bangers, sans-serif', fontSize: 16, color: '#0d0f14',
                letterSpacing: 2, textTransform: 'uppercase',
                boxShadow: '0 4px 24px rgba(255,122,24,0.5)',
              }}>
                TAP TO REVEAL
              </button>
            </div>
          )}
        </>
      )}

      {screen === 'win' && winnerState && (
        <WinScreen
          winner={winnerState.winner}
          winnerDeck={winnerState.deck}
          onPlayAgain={() => { setGameState(null); setAiPlayer(null); setWinnerState(null); setScreen('setup'); }}
        />
      )}

      {showCacheModal && (
        <ImageCacheModal onClose={() => setShowCacheModal(false)} />
      )}

      {pendingSetup && (
        <DeckScoutModal
          p1Deck={pendingSetup.p1Deck}
          p2Deck={pendingSetup.p2Deck}
          isVsAi={pendingSetup.mode === 'vs_ai'}
          onDone={handleScoutDone}
        />
      )}

      {incomingChallenge && (
        <div style={{
          position: 'fixed', inset: 0, background: 'rgba(13,15,20,0.85)',
          display: 'flex', alignItems: 'flex-end', zIndex: 300,
        }}>
          <div style={{
            width: '100%', maxWidth: 430, margin: '0 auto',
            background: 'var(--bg)', borderRadius: '16px 16px 0 0',
            padding: '20px 20px max(20px, env(safe-area-inset-bottom))', display: 'flex', flexDirection: 'column', gap: 12,
          }}>
            <p style={{ fontFamily: 'Bangers, sans-serif', fontSize: 15, color: 'var(--ki)', margin: 0, letterSpacing: 1, textTransform: 'uppercase', textAlign: 'center' }}>
              Challenge from {incomingChallenge.challengerName}!
            </p>
            <p style={{ fontFamily: 'Saira Condensed, sans-serif', fontSize: 11, color: 'var(--muted)', margin: 0, textAlign: 'center', textTransform: 'uppercase', letterSpacing: 1 }}>
              They&apos;re playing {incomingChallenge.challengerDeck.replace('_', ' ')} — pick your deck
            </p>
            {DECK_OPTIONS.map(deck => (
              <button key={deck.id} onClick={() => setAcceptDeck(deck.id)} style={{
                background: acceptDeck === deck.id ? `${deck.color}22` : 'rgba(255,255,255,0.04)',
                border: acceptDeck === deck.id ? `2px solid ${deck.color}` : '1.5px solid rgba(255,255,255,0.1)',
                borderRadius: 8, padding: '10px 12px', cursor: 'pointer',
                display: 'flex', alignItems: 'center', gap: 8,
              }}>
                <div style={{ width: 8, height: 8, borderRadius: '50%', background: deck.color, flexShrink: 0 }} />
                <span style={{ fontFamily: 'Saira Condensed, sans-serif', fontSize: 13, color: acceptDeck === deck.id ? deck.color : 'var(--ink)', textTransform: 'uppercase', letterSpacing: 0.5 }}>
                  {deck.name}
                </span>
              </button>
            ))}
            <div style={{ display: 'flex', gap: 8 }}>
              <button onClick={handleDeclineChallenge} style={{
                flex: 1, background: 'transparent', border: '1px solid rgba(255,255,255,0.15)',
                borderRadius: 10, padding: '12px', cursor: 'pointer',
                fontFamily: 'Saira Condensed, sans-serif', fontSize: 12, color: 'var(--muted)',
                letterSpacing: 1, textTransform: 'uppercase',
              }}>DECLINE</button>
              <button onClick={handleAcceptChallenge} disabled={!acceptDeck || acceptLoading} style={{
                flex: 2,
                background: acceptDeck && !acceptLoading ? 'linear-gradient(135deg, var(--ki), var(--ki2))' : 'rgba(255,255,255,0.06)',
                border: 'none', borderRadius: 10, padding: '12px',
                cursor: acceptDeck && !acceptLoading ? 'pointer' : 'not-allowed',
                fontFamily: 'Bangers, sans-serif', fontSize: 14,
                color: acceptDeck && !acceptLoading ? '#0d0f14' : 'var(--muted)',
                letterSpacing: 1, textTransform: 'uppercase',
              }}>
                {acceptLoading ? '...' : 'ACCEPT'}
              </button>
            </div>
          </div>
        </div>
      )}

    </main>
  );
}
