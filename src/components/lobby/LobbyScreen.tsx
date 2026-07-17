'use client';

import React, { useState, useEffect } from 'react';
import type { User } from '@supabase/supabase-js';
import { supabase } from '@/lib/supabase/client';
import type { Match, Profile } from '@/lib/supabase/types';
import type { PlayerId } from '@/lib/engine/types';

const DECK_OPTIONS = [
  { id: 'saiyan', name: 'Saiyan', color: '#ff7a18' },
  { id: 'namekian', name: 'Namekian', color: '#34c759' },
  { id: 'android', name: 'Android', color: '#3aa6ff' },
  { id: 'human', name: 'Earthling', color: '#ffb648' },
  { id: 'frieza_force', name: 'Frieza Force', color: '#b44dff' },
  { id: 'majin', name: 'Majin', color: '#f03fcc' },
  { id: 'kai', name: 'Kai', color: '#7de2e0' },
];

interface LobbyScreenProps {
  user: User;
  presenceIds: Set<string>;
  onCreateMatch: (matchId: string) => void;
  onJoinMatch: (matchId: string, myRole: PlayerId) => void;
  onBack: () => void;
  onSignOut: () => void;
}

export default function LobbyScreen({ user, presenceIds, onCreateMatch, onJoinMatch, onBack, onSignOut }: LobbyScreenProps) {
  const [profile, setProfile] = useState<Profile | null>(null);
  const [openMatches, setOpenMatches] = useState<Match[]>([]);
  const [myMatches, setMyMatches] = useState<Match[]>([]);
  const [opponentNames, setOpponentNames] = useState<Record<string, string>>({});
  const [createDeck, setCreateDeck] = useState<string | null>(null);
  const [joiningMatch, setJoiningMatch] = useState<Match | null>(null);
  const [joinDeck, setJoinDeck] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    // Load profile
    supabase.from('profiles').select('*').eq('id', user.id).single()
      .then(({ data }) => { if (data) setProfile(data); });

    fetchMatches();

    // Realtime: update lobby when matches change
    // Remove any stale channel from a previous mount (React StrictMode fires effects twice in dev)
    const stale = supabase.getChannels().find(c => c.topic === 'realtime:lobby');
    if (stale) supabase.removeChannel(stale);

    const channel = supabase.channel('lobby')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'matches' }, fetchMatches)
      .subscribe();

    return () => { supabase.removeChannel(channel); };
  }, [user.id]);

  async function fetchMatches() {
    const [open, mine] = await Promise.all([
      supabase.from('matches').select('*').eq('status', 'waiting').neq('player1', user.id),
      supabase.from('matches').select('*').in('status', ['waiting', 'invited', 'active']).or(`player1.eq.${user.id},player2.eq.${user.id}`),
    ]);
    const myMatchData = (mine.data ?? []) as Match[];
    setOpenMatches((open.data ?? []) as Match[]);
    setMyMatches(myMatchData);

    const opponentIds = [...new Set(
      myMatchData
        .map(m => (m.player1 === user.id ? m.player2 : m.player1))
        .filter((id): id is string => !!id)
    )];
    if (opponentIds.length > 0) {
      const { data: profiles } = await supabase.from('profiles').select('id, display_name').in('id', opponentIds);
      const map: Record<string, string> = {};
      profiles?.forEach((p: { id: string; display_name: string }) => { map[p.id] = p.display_name; });
      setOpponentNames(map);
    }
  }

  async function handleCreateMatch() {
    if (!createDeck) return;
    setLoading(true);
    const { data, error } = await supabase.from('matches').insert({
      player1: user.id,
      player1_deck: createDeck,
      status: 'waiting',
    }).select().single();
    setLoading(false);
    if (!error && data) onCreateMatch(data.id);
  }

  async function handleJoinMatch() {
    if (!joiningMatch || !joinDeck) return;
    setLoading(true);

    // Player2 initialises the game state
    const { createInitialState } = await import('@/lib/engine');
    const firstPlayer: PlayerId = Math.random() < 0.5 ? 'p1' : 'p2';
    const gameState = createInitialState(joiningMatch.player1_deck!, joinDeck, firstPlayer);

    const { error } = await supabase.from('matches').update({
      player2: user.id,
      player2_deck: joinDeck,
      state: gameState,
      status: 'active',
      turn_player: gameState.turnPlayer === 'p1' ? joiningMatch.player1 : user.id,
    }).eq('id', joiningMatch.id);

    setLoading(false);
    if (!error) onJoinMatch(joiningMatch.id, 'p2');
  }

  async function handleResumeMatch(match: Match) {
    const myRole: PlayerId = match.player1 === user.id ? 'p1' : 'p2';
    if (match.status === 'waiting') {
      onCreateMatch(match.id);
    } else {
      onJoinMatch(match.id, myRole);
    }
  }

  const panel: React.CSSProperties = {
    background: 'var(--panel)', border: '1px solid var(--line)',
    borderRadius: 12, padding: 16,
  };

  return (
    <div style={{
      width: '100%', maxWidth: 430, minHeight: '100dvh', margin: '0 auto',
      background: 'var(--bg)', display: 'flex', flexDirection: 'column',
      padding: 'max(16px, env(safe-area-inset-top)) 16px max(32px, env(safe-area-inset-bottom))', gap: 16, fontFamily: 'Saira, sans-serif',
    }}>
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
        <button onClick={onBack} style={{
          background: 'transparent', border: '1px solid var(--line)',
          borderRadius: 8, padding: '6px 12px', cursor: 'pointer',
          fontFamily: 'Saira Condensed, sans-serif', fontSize: 11,
          color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: 1, flexShrink: 0,
        }}>← BACK</button>
        <div style={{ flex: 1 }}>
          <h1 style={{ fontFamily: 'Bangers, sans-serif', fontSize: 24, color: 'var(--ki)', margin: 0, letterSpacing: 2 }}>ONLINE</h1>
          <p style={{ fontFamily: 'Saira Condensed, sans-serif', fontSize: 10, color: 'var(--muted)', margin: 0, letterSpacing: 1, textTransform: 'uppercase' }}>
            {profile?.display_name ?? user.email}
          </p>
        </div>
        <button onClick={onSignOut} style={{
          background: 'transparent', border: '1px solid var(--line)',
          borderRadius: 8, padding: '6px 12px', cursor: 'pointer',
          fontFamily: 'Saira Condensed, sans-serif', fontSize: 11,
          color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: 1,
        }}>
          SIGN OUT
        </button>
      </div>

      {/* Create Online Match */}
      <div style={panel}>
        <p style={{ fontFamily: 'Bangers, sans-serif', fontSize: 13, color: 'var(--muted)', letterSpacing: 1, textTransform: 'uppercase', margin: '0 0 12px', textAlign: 'center' }}>
          Create Online Match
        </p>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          {DECK_OPTIONS.map(deck => (
            <button key={deck.id} onClick={() => setCreateDeck(deck.id)} style={{
              background: createDeck === deck.id ? `${deck.color}22` : 'rgba(255,255,255,0.04)',
              border: createDeck === deck.id ? `2px solid ${deck.color}` : '1.5px solid rgba(255,255,255,0.1)',
              borderRadius: 8, padding: '10px 12px', cursor: 'pointer',
              display: 'flex', alignItems: 'center', gap: 8,
            }}>
              <div style={{ width: 8, height: 8, borderRadius: '50%', background: deck.color, flexShrink: 0 }} />
              <span style={{ fontFamily: 'Saira Condensed, sans-serif', fontSize: 13, color: createDeck === deck.id ? deck.color : 'var(--ink)', textTransform: 'uppercase', letterSpacing: 0.5 }}>
                {deck.name}
              </span>
            </button>
          ))}
        </div>
        <button onClick={handleCreateMatch} disabled={!createDeck || loading} style={{
          marginTop: 12, width: '100%',
          background: createDeck && !loading ? 'linear-gradient(135deg, var(--ki), var(--ki2))' : 'rgba(255,255,255,0.06)',
          border: 'none', borderRadius: 10, padding: '12px',
          cursor: createDeck && !loading ? 'pointer' : 'not-allowed',
          fontFamily: 'Bangers, sans-serif', fontSize: 14,
          color: createDeck && !loading ? '#0d0f14' : 'var(--muted)',
          letterSpacing: 1, textTransform: 'uppercase',
        }}>
          {loading ? '...' : 'CREATE MATCH'}
        </button>
      </div>

      {/* My active matches */}
      {myMatches.length > 0 && (
        <div style={panel}>
          <p style={{ fontFamily: 'Bangers, sans-serif', fontSize: 13, color: 'var(--muted)', letterSpacing: 1, textTransform: 'uppercase', margin: '0 0 10px' }}>
            Your Matches
          </p>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {myMatches.map(m => {
              const opponentId = m.player1 === user.id ? m.player2 : m.player1;
              const opponentName = opponentId ? opponentNames[opponentId] : undefined;
              const isOpponentOnline = opponentId ? presenceIds.has(opponentId) : false;
              return (
                <div key={m.id} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
                  <div>
                    {opponentName && (
                      <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 2 }}>
                        <div style={{
                          width: 7, height: 7, borderRadius: '50%', flexShrink: 0,
                          background: isOpponentOnline ? '#34c759' : 'rgba(255,255,255,0.2)',
                          boxShadow: isOpponentOnline ? '0 0 6px #34c759' : 'none',
                        }} />
                        <span style={{ fontFamily: 'Saira Condensed, sans-serif', fontSize: 12, color: 'var(--ink)', textTransform: 'uppercase', letterSpacing: 0.5 }}>
                          {opponentName}
                        </span>
                      </div>
                    )}
                    <span style={{ fontFamily: 'Saira Condensed, sans-serif', fontSize: 11, color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: 0.5 }}>
                      {m.status === 'waiting' ? 'Waiting for opponent…' : m.status === 'invited' ? 'Challenge sent…' : 'Active'}
                    </span>
                    <p style={{ fontFamily: 'Saira Condensed, sans-serif', fontSize: 9, color: 'var(--muted)', margin: 0, textTransform: 'uppercase', letterSpacing: 1 }}>
                      {m.player1 === user.id ? m.player1_deck : m.player2_deck} deck
                    </p>
                  </div>
                  <button onClick={() => handleResumeMatch(m)} style={{
                    background: 'linear-gradient(135deg, var(--ki), var(--ki2))', border: 'none',
                    borderRadius: 8, padding: '8px 14px', cursor: 'pointer',
                    fontFamily: 'Bangers, sans-serif', fontSize: 11, color: '#0d0f14', letterSpacing: 1, textTransform: 'uppercase',
                  }}>
                    {m.status === 'waiting' ? 'WAITING' : 'RESUME'}
                  </button>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Open matches to join */}
      {openMatches.length > 0 && (
        <div style={panel}>
          <p style={{ fontFamily: 'Bangers, sans-serif', fontSize: 13, color: 'var(--muted)', letterSpacing: 1, textTransform: 'uppercase', margin: '0 0 10px' }}>
            Open Matches
          </p>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {openMatches.map(m => (
              <div key={m.id} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
                <span style={{ fontFamily: 'Saira Condensed, sans-serif', fontSize: 11, color: 'var(--ink)', textTransform: 'uppercase', letterSpacing: 0.5 }}>
                  {m.player1_deck} deck
                </span>
                <button onClick={() => { setJoiningMatch(m); setJoinDeck(null); }} style={{
                  background: 'rgba(255,122,24,0.15)', border: '1px solid var(--ki)',
                  borderRadius: 8, padding: '8px 14px', cursor: 'pointer',
                  fontFamily: 'Bangers, sans-serif', fontSize: 11, color: 'var(--ki)', letterSpacing: 1, textTransform: 'uppercase',
                }}>
                  JOIN
                </button>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Join deck picker overlay */}
      {joiningMatch && (
        <div style={{
          position: 'fixed', inset: 0, background: 'rgba(13,15,20,0.85)',
          display: 'flex', alignItems: 'flex-end', zIndex: 200,
        }} onClick={() => setJoiningMatch(null)}>
          <div style={{
            width: '100%', maxWidth: 430, margin: '0 auto',
            background: 'var(--bg)', borderRadius: '16px 16px 0 0',
            padding: 20, display: 'flex', flexDirection: 'column', gap: 12,
          }} onClick={e => e.stopPropagation()}>
            <p style={{ fontFamily: 'Bangers, sans-serif', fontSize: 14, color: 'var(--ki)', margin: 0, letterSpacing: 1, textTransform: 'uppercase', textAlign: 'center' }}>
              Pick Your Deck
            </p>
            {DECK_OPTIONS.map(deck => (
              <button key={deck.id} onClick={() => setJoinDeck(deck.id)} style={{
                background: joinDeck === deck.id ? `${deck.color}22` : 'rgba(255,255,255,0.04)',
                border: joinDeck === deck.id ? `2px solid ${deck.color}` : '1.5px solid rgba(255,255,255,0.1)',
                borderRadius: 8, padding: '10px 12px', cursor: 'pointer',
                display: 'flex', alignItems: 'center', gap: 8,
              }}>
                <div style={{ width: 8, height: 8, borderRadius: '50%', background: deck.color, flexShrink: 0 }} />
                <span style={{ fontFamily: 'Saira Condensed, sans-serif', fontSize: 13, color: joinDeck === deck.id ? deck.color : 'var(--ink)', textTransform: 'uppercase', letterSpacing: 0.5 }}>
                  {deck.name}
                </span>
              </button>
            ))}
            <button onClick={handleJoinMatch} disabled={!joinDeck || loading} style={{
              background: joinDeck && !loading ? 'linear-gradient(135deg, var(--ki), var(--ki2))' : 'rgba(255,255,255,0.06)',
              border: 'none', borderRadius: 10, padding: '14px',
              cursor: joinDeck && !loading ? 'pointer' : 'not-allowed',
              fontFamily: 'Bangers, sans-serif', fontSize: 15, color: joinDeck && !loading ? '#0d0f14' : 'var(--muted)',
              letterSpacing: 1, textTransform: 'uppercase',
            }}>
              {loading ? '...' : 'JOIN MATCH'}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
