'use client';

import React, { useState, useEffect, useRef } from 'react';
import type { User } from '@supabase/supabase-js';
import { supabase } from '@/lib/supabase/client';
import type { Friendship, Profile } from '@/lib/supabase/types';

const DECK_OPTIONS = [
  { id: 'saiyan', name: 'Saiyan', color: '#ff7a18' },
  { id: 'namekian', name: 'Namekian', color: '#34c759' },
  { id: 'android', name: 'Android', color: '#3aa6ff' },
  { id: 'human', name: 'Human', color: '#ffb648' },
  { id: 'frieza_force', name: 'Frieza Force', color: '#b44dff' },
];

interface FriendsScreenProps {
  user: User;
  onChallenge: (matchId: string) => void;
  onBack: () => void;
}

interface FriendEntry {
  friendshipId: string;
  userId: string;
  displayName: string;
  isOnline: boolean;
}

interface PendingEntry {
  friendshipId: string;
  userId: string;
  displayName: string;
}

export default function FriendsScreen({ user, onChallenge, onBack }: FriendsScreenProps) {
  const [friends, setFriends] = useState<FriendEntry[]>([]);
  const [pendingReceived, setPendingReceived] = useState<PendingEntry[]>([]);
  const [pendingSent, setPendingSent] = useState<PendingEntry[]>([]);
  const [onlineIds, setOnlineIds] = useState<Set<string>>(new Set());
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState<Profile[]>([]);
  const [searchLoading, setSearchLoading] = useState(false);
  const [challengingFriend, setChallengingFriend] = useState<FriendEntry | null>(null);
  const [challengeDeck, setChallengeDeck] = useState<string | null>(null);
  const [challengeLoading, setChallengeLoading] = useState(false);
  const [loading, setLoading] = useState(true);
  const searchTimeout = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    loadFriends();

    // Remove any stale channels from a previous mount (React StrictMode fires effects twice in dev)
    ['realtime:friendships-watch', 'realtime:presence-lobby'].forEach(topic => {
      const stale = supabase.getChannels().find(c => c.topic === topic);
      if (stale) supabase.removeChannel(stale);
    });

    const friendChannel = supabase.channel('friendships-watch')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'friendships' }, loadFriends)
      .subscribe();

    const presenceChannel = supabase.channel('presence-lobby');
    presenceChannel
      .on('presence', { event: 'sync' }, () => {
        const state = presenceChannel.presenceState<{ userId: string }>();
        const ids = new Set(Object.values(state).flat().map(p => p.userId));
        setOnlineIds(ids);
      })
      .subscribe(async (status) => {
        if (status === 'SUBSCRIBED') {
          await presenceChannel.track({ userId: user.id });
        }
      });

    return () => {
      supabase.removeChannel(friendChannel);
      presenceChannel.untrack().then(() => supabase.removeChannel(presenceChannel));
    };
  }, [user.id]);

  // Sync online status into friend entries whenever presence changes
  useEffect(() => {
    setFriends(prev => prev.map(f => ({ ...f, isOnline: onlineIds.has(f.userId) })));
  }, [onlineIds]);

  async function loadFriends() {
    const { data: rows } = await supabase
      .from('friendships')
      .select('*')
      .or(`requester.eq.${user.id},addressee.eq.${user.id}`);

    if (!rows) { setLoading(false); return; }

    const all = rows as Friendship[];
    const accepted = all.filter(f => f.status === 'accepted');
    const sentPending = all.filter(f => f.status === 'pending' && f.requester === user.id);
    const receivedPending = all.filter(f => f.status === 'pending' && f.addressee === user.id);

    const allIds = [
      ...accepted.map(f => f.requester === user.id ? f.addressee : f.requester),
      ...sentPending.map(f => f.addressee),
      ...receivedPending.map(f => f.requester),
    ].filter((id, i, arr) => arr.indexOf(id) === i);

    const profileMap: Record<string, string> = {};
    if (allIds.length > 0) {
      const { data: profiles } = await supabase.from('profiles').select('id, display_name').in('id', allIds);
      profiles?.forEach(p => { profileMap[p.id] = p.display_name; });
    }

    setFriends(accepted.map(f => {
      const friendId = f.requester === user.id ? f.addressee : f.requester;
      return { friendshipId: f.id, userId: friendId, displayName: profileMap[friendId] ?? '…', isOnline: onlineIds.has(friendId) };
    }));
    setPendingSent(sentPending.map(f => ({
      friendshipId: f.id, userId: f.addressee, displayName: profileMap[f.addressee] ?? '…',
    })));
    setPendingReceived(receivedPending.map(f => ({
      friendshipId: f.id, userId: f.requester, displayName: profileMap[f.requester] ?? '…',
    })));
    setLoading(false);
  }

  function handleSearchChange(q: string) {
    setSearchQuery(q);
    if (searchTimeout.current) clearTimeout(searchTimeout.current);
    if (!q.trim()) { setSearchResults([]); return; }
    searchTimeout.current = setTimeout(async () => {
      setSearchLoading(true);
      const { data } = await supabase
        .from('profiles')
        .select('*')
        .ilike('display_name', `%${q.trim()}%`)
        .neq('id', user.id)
        .limit(10);
      setSearchResults((data ?? []) as Profile[]);
      setSearchLoading(false);
    }, 400);
  }

  async function handleAddFriend(addresseeId: string) {
    await supabase.from('friendships').insert({ requester: user.id, addressee: addresseeId });
    setSearchResults([]);
    setSearchQuery('');
  }

  async function handleAccept(friendshipId: string) {
    await supabase.from('friendships').update({ status: 'accepted' }).eq('id', friendshipId);
  }

  async function handleDecline(friendshipId: string) {
    await supabase.from('friendships').delete().eq('id', friendshipId);
  }

  async function handleChallenge() {
    if (!challengingFriend || !challengeDeck) return;
    setChallengeLoading(true);
    const { data, error } = await supabase.from('matches').insert({
      player1: user.id,
      player2: challengingFriend.userId,
      player1_deck: challengeDeck,
      status: 'invited',
    }).select().single();
    setChallengeLoading(false);
    if (!error && data) {
      setChallengingFriend(null);
      onChallenge(data.id);
    }
  }

  const relatedIds = new Set([
    ...friends.map(f => f.userId),
    ...pendingSent.map(f => f.userId),
    ...pendingReceived.map(f => f.userId),
  ]);

  const panel: React.CSSProperties = {
    background: 'var(--panel)', border: '1px solid var(--line)', borderRadius: 12, padding: 16,
  };

  const inputStyle: React.CSSProperties = {
    width: '100%', background: 'rgba(255,255,255,0.06)', border: '1.5px solid rgba(255,255,255,0.1)',
    borderRadius: 8, padding: '10px 12px', color: 'var(--ink)',
    fontFamily: 'Saira Condensed, sans-serif', fontSize: 13, outline: 'none', boxSizing: 'border-box',
  };

  return (
    <div style={{
      width: '100%', maxWidth: 430, minHeight: '100dvh', margin: '0 auto',
      background: 'var(--bg)', display: 'flex', flexDirection: 'column',
      padding: 'max(16px, env(safe-area-inset-top)) 16px max(48px, env(safe-area-inset-bottom))', gap: 16, fontFamily: 'Saira, sans-serif',
    }}>
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
        <button onClick={onBack} style={{
          background: 'transparent', border: '1px solid var(--line)', borderRadius: 8,
          padding: '6px 12px', cursor: 'pointer', fontFamily: 'Saira Condensed, sans-serif',
          fontSize: 11, color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: 1,
        }}>← BACK</button>
        <h1 style={{ fontFamily: 'Bangers, sans-serif', fontSize: 24, color: 'var(--ki)', margin: 0, letterSpacing: 2 }}>
          FRIENDS
        </h1>
      </div>

      {/* Search / Add */}
      <div style={panel}>
        <p style={{ fontFamily: 'Bangers, sans-serif', fontSize: 12, color: 'var(--muted)', letterSpacing: 1, textTransform: 'uppercase', margin: '0 0 10px' }}>
          Add Friend
        </p>
        <input
          placeholder="Search by display name…"
          value={searchQuery}
          onChange={e => handleSearchChange(e.target.value)}
          style={inputStyle}
        />
        {searchLoading && (
          <p style={{ fontFamily: 'Saira Condensed, sans-serif', fontSize: 11, color: 'var(--muted)', margin: '8px 0 0', textTransform: 'uppercase', letterSpacing: 1 }}>
            Searching…
          </p>
        )}
        {searchResults.length > 0 && (
          <div style={{ marginTop: 8, display: 'flex', flexDirection: 'column', gap: 6 }}>
            {searchResults.map(p => {
              const already = relatedIds.has(p.id);
              return (
                <div key={p.id} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
                  <span style={{ fontFamily: 'Saira Condensed, sans-serif', fontSize: 13, color: 'var(--ink)', textTransform: 'uppercase', letterSpacing: 0.5 }}>
                    {p.display_name}
                  </span>
                  {already ? (
                    <span style={{ fontFamily: 'Saira Condensed, sans-serif', fontSize: 10, color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: 1 }}>ADDED</span>
                  ) : (
                    <button onClick={() => handleAddFriend(p.id)} style={{
                      background: 'rgba(255,122,24,0.15)', border: '1px solid var(--ki)',
                      borderRadius: 6, padding: '5px 10px', cursor: 'pointer',
                      fontFamily: 'Bangers, sans-serif', fontSize: 10, color: 'var(--ki)', letterSpacing: 1, textTransform: 'uppercase',
                    }}>ADD</button>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Pending requests received */}
      {pendingReceived.length > 0 && (
        <div style={panel}>
          <p style={{ fontFamily: 'Bangers, sans-serif', fontSize: 12, color: 'var(--muted)', letterSpacing: 1, textTransform: 'uppercase', margin: '0 0 10px' }}>
            Friend Requests
          </p>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {pendingReceived.map(p => (
              <div key={p.friendshipId} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
                <span style={{ fontFamily: 'Saira Condensed, sans-serif', fontSize: 13, color: 'var(--ink)', textTransform: 'uppercase', letterSpacing: 0.5 }}>
                  {p.displayName}
                </span>
                <div style={{ display: 'flex', gap: 6 }}>
                  <button onClick={() => handleAccept(p.friendshipId)} style={{
                    background: 'linear-gradient(135deg, var(--ki), var(--ki2))', border: 'none',
                    borderRadius: 6, padding: '6px 10px', cursor: 'pointer',
                    fontFamily: 'Bangers, sans-serif', fontSize: 10, color: '#0d0f14', letterSpacing: 1, textTransform: 'uppercase',
                  }}>ACCEPT</button>
                  <button onClick={() => handleDecline(p.friendshipId)} style={{
                    background: 'transparent', border: '1px solid rgba(255,255,255,0.15)',
                    borderRadius: 6, padding: '6px 10px', cursor: 'pointer',
                    fontFamily: 'Saira Condensed, sans-serif', fontSize: 10, color: 'var(--muted)', letterSpacing: 1, textTransform: 'uppercase',
                  }}>DECLINE</button>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Friends list */}
      {!loading && (
        <div style={panel}>
          <p style={{ fontFamily: 'Bangers, sans-serif', fontSize: 12, color: 'var(--muted)', letterSpacing: 1, textTransform: 'uppercase', margin: '0 0 10px' }}>
            Friends {friends.length > 0 ? `(${friends.length})` : ''}
          </p>
          {friends.length === 0 ? (
            <p style={{ fontFamily: 'Saira Condensed, sans-serif', fontSize: 11, color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: 1, margin: 0, textAlign: 'center' }}>
              No friends yet — search above to add some
            </p>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              {friends.map(f => (
                <div key={f.friendshipId} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <div style={{
                      width: 7, height: 7, borderRadius: '50%', flexShrink: 0,
                      background: f.isOnline ? '#34c759' : 'rgba(255,255,255,0.2)',
                      boxShadow: f.isOnline ? '0 0 6px #34c759' : 'none',
                    }} />
                    <span style={{ fontFamily: 'Saira Condensed, sans-serif', fontSize: 13, color: 'var(--ink)', textTransform: 'uppercase', letterSpacing: 0.5 }}>
                      {f.displayName}
                    </span>
                  </div>
                  <button onClick={() => { setChallengingFriend(f); setChallengeDeck(null); }} style={{
                    background: 'rgba(255,122,24,0.15)', border: '1px solid var(--ki)',
                    borderRadius: 6, padding: '6px 10px', cursor: 'pointer',
                    fontFamily: 'Bangers, sans-serif', fontSize: 10, color: 'var(--ki)', letterSpacing: 1, textTransform: 'uppercase',
                  }}>CHALLENGE</button>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Sent requests */}
      {pendingSent.length > 0 && (
        <div style={panel}>
          <p style={{ fontFamily: 'Bangers, sans-serif', fontSize: 12, color: 'var(--muted)', letterSpacing: 1, textTransform: 'uppercase', margin: '0 0 8px' }}>
            Sent Requests
          </p>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            {pendingSent.map(p => (
              <div key={p.friendshipId} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                <span style={{ fontFamily: 'Saira Condensed, sans-serif', fontSize: 12, color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: 0.5 }}>
                  {p.displayName}
                </span>
                <span style={{ fontFamily: 'Saira Condensed, sans-serif', fontSize: 10, color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: 1, opacity: 0.6 }}>
                  Pending
                </span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Challenge deck picker */}
      {challengingFriend && (
        <div style={{
          position: 'fixed', inset: 0, background: 'rgba(13,15,20,0.85)',
          display: 'flex', alignItems: 'flex-end', zIndex: 200,
        }} onClick={() => setChallengingFriend(null)}>
          <div style={{
            width: '100%', maxWidth: 430, margin: '0 auto',
            background: 'var(--bg)', borderRadius: '16px 16px 0 0',
            padding: 20, display: 'flex', flexDirection: 'column', gap: 12,
          }} onClick={e => e.stopPropagation()}>
            <p style={{ fontFamily: 'Bangers, sans-serif', fontSize: 13, color: 'var(--ki)', margin: 0, letterSpacing: 1, textTransform: 'uppercase', textAlign: 'center' }}>
              Challenge {challengingFriend.displayName}
            </p>
            <p style={{ fontFamily: 'Saira Condensed, sans-serif', fontSize: 11, color: 'var(--muted)', margin: 0, textAlign: 'center', textTransform: 'uppercase', letterSpacing: 1 }}>
              Pick your deck
            </p>
            {DECK_OPTIONS.map(deck => (
              <button key={deck.id} onClick={() => setChallengeDeck(deck.id)} style={{
                background: challengeDeck === deck.id ? `${deck.color}22` : 'rgba(255,255,255,0.04)',
                border: challengeDeck === deck.id ? `2px solid ${deck.color}` : '1.5px solid rgba(255,255,255,0.1)',
                borderRadius: 8, padding: '10px 12px', cursor: 'pointer',
                display: 'flex', alignItems: 'center', gap: 8,
              }}>
                <div style={{ width: 8, height: 8, borderRadius: '50%', background: deck.color, flexShrink: 0 }} />
                <span style={{ fontFamily: 'Saira Condensed, sans-serif', fontSize: 13, color: challengeDeck === deck.id ? deck.color : 'var(--ink)', textTransform: 'uppercase', letterSpacing: 0.5 }}>
                  {deck.name}
                </span>
              </button>
            ))}
            <button onClick={handleChallenge} disabled={!challengeDeck || challengeLoading} style={{
              background: challengeDeck && !challengeLoading ? 'linear-gradient(135deg, var(--ki), var(--ki2))' : 'rgba(255,255,255,0.06)',
              border: 'none', borderRadius: 10, padding: '14px',
              cursor: challengeDeck && !challengeLoading ? 'pointer' : 'not-allowed',
              fontFamily: 'Bangers, sans-serif', fontSize: 15,
              color: challengeDeck && !challengeLoading ? '#0d0f14' : 'var(--muted)',
              letterSpacing: 1, textTransform: 'uppercase',
            }}>
              {challengeLoading ? '...' : 'SEND CHALLENGE'}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
