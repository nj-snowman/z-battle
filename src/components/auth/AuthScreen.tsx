'use client';

import React, { useState } from 'react';
import { supabase } from '@/lib/supabase/client';

const inputStyle: React.CSSProperties = {
  width: '100%',
  background: 'rgba(255,255,255,0.06)',
  border: '1.5px solid rgba(255,255,255,0.1)',
  borderRadius: 8,
  padding: '12px 14px',
  color: 'var(--ink)',
  fontFamily: 'Saira Condensed, sans-serif',
  fontSize: 16,
  outline: 'none',
  boxSizing: 'border-box',
};

export default function AuthScreen({ onPlayOffline }: { onPlayOffline?: () => void }) {
  const [tab, setTab] = useState<'signin' | 'signup'>('signin');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSignIn() {
    setLoading(true);
    setError(null);
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    if (error) setError(error.message);
    setLoading(false);
  }

  async function handleSignUp() {
    if (!displayName.trim()) { setError('Display name is required'); return; }
    setLoading(true);
    setError(null);
    const { data, error } = await supabase.auth.signUp({ email, password });
    if (error) { setError(error.message); setLoading(false); return; }
    if (data.user) {
      await supabase.from('profiles').insert({ id: data.user.id, display_name: displayName.trim() });
    }
    setLoading(false);
  }

  return (
    <div style={{
      width: '100%', maxWidth: 430, minHeight: '100dvh', margin: '0 auto',
      background: 'var(--bg)', display: 'flex', flexDirection: 'column',
      alignItems: 'center', justifyContent: 'center', padding: '24px 20px',
      gap: 24, fontFamily: 'Saira, sans-serif',
    }}>
      {/* Title */}
      <div style={{ textAlign: 'center' }}>
        <h1 style={{
          fontFamily: 'Bangers, sans-serif', fontSize: 48,
          background: 'linear-gradient(135deg, var(--ki), var(--ki2))',
          WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent',
          backgroundClip: 'text', margin: 0, letterSpacing: 2,
        }}>Z-BATTLE</h1>
        <p style={{ fontFamily: 'Saira Condensed, sans-serif', fontSize: 11, color: 'var(--muted)', letterSpacing: 2, textTransform: 'uppercase', margin: '4px 0 0' }}>
          Sign in to play
        </p>
      </div>

      {/* Tab toggle */}
      <div style={{ display: 'flex', gap: 0, background: 'var(--panel)', borderRadius: 10, padding: 4, width: '100%', border: '1px solid var(--line)' }}>
        {(['signin', 'signup'] as const).map(t => (
          <button key={t} onClick={() => { setTab(t); setError(null); }}
            style={{
              flex: 1, padding: '10px', borderRadius: 8, border: 'none', cursor: 'pointer',
              background: tab === t ? 'linear-gradient(135deg, var(--ki), var(--ki2))' : 'transparent',
              color: tab === t ? '#0d0f14' : 'var(--muted)',
              fontFamily: 'Bangers, sans-serif', fontSize: 13, letterSpacing: 1, textTransform: 'uppercase',
            }}>
            {t === 'signin' ? 'SIGN IN' : 'SIGN UP'}
          </button>
        ))}
      </div>

      {/* Form */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 12, width: '100%' }}>
        {tab === 'signup' && (
          <input
            placeholder="Display name"
            value={displayName}
            onChange={e => setDisplayName(e.target.value)}
            style={inputStyle}
          />
        )}
        <input
          type="email"
          placeholder="Email"
          value={email}
          onChange={e => setEmail(e.target.value)}
          style={inputStyle}
        />
        <input
          type="password"
          placeholder="Password"
          value={password}
          onChange={e => setPassword(e.target.value)}
          onKeyDown={e => e.key === 'Enter' && (tab === 'signin' ? handleSignIn() : handleSignUp())}
          style={inputStyle}
        />
      </div>

      {error && (
        <p style={{ fontFamily: 'Saira Condensed, sans-serif', fontSize: 12, color: '#ff6b6b', textAlign: 'center', margin: 0 }}>
          {error}
        </p>
      )}

      <button
        onClick={tab === 'signin' ? handleSignIn : handleSignUp}
        disabled={loading}
        style={{
          width: '100%', background: loading ? 'rgba(255,255,255,0.06)' : 'linear-gradient(135deg, var(--ki), var(--ki2))',
          border: 'none', borderRadius: 12, padding: '16px',
          cursor: loading ? 'not-allowed' : 'pointer',
          fontFamily: 'Bangers, sans-serif', fontSize: 18,
          color: loading ? 'var(--muted)' : '#0d0f14',
          letterSpacing: 2, textTransform: 'uppercase',
          boxShadow: loading ? 'none' : '0 4px 24px rgba(255,122,24,0.5)',
        }}
      >
        {loading ? '...' : (tab === 'signin' ? 'SIGN IN' : 'CREATE ACCOUNT')}
      </button>

      {onPlayOffline && (
        <button
          onClick={onPlayOffline}
          style={{
            width: '100%', background: 'transparent',
            border: '1px solid rgba(255,255,255,0.12)', borderRadius: 12, padding: '14px',
            cursor: 'pointer', fontFamily: 'Bangers, sans-serif', fontSize: 15,
            color: 'var(--muted)', letterSpacing: 2, textTransform: 'uppercase',
          }}
        >
          PLAY OFFLINE
        </button>
      )}
    </div>
  );
}
