'use client';

import React, { useState, useEffect } from 'react';
import type { PlayerId } from '@/lib/engine/types';
import type { Difficulty } from '@/lib/engine/aiTypes';
import { DECKS, getCard } from '@/lib/engine/cards';
import RulebookModal from './RulebookModal';

export type GameMode = 'hotseat' | 'vs_ai';

interface SetupScreenProps {
  onStart: (p1Deck: string, p2Deck: string, firstPlayer: PlayerId, mode: GameMode, difficulty: Difficulty) => void;
  userEmail?: string | null;
  isGuest?: boolean;
  onOpenFriends?: () => void;
  onPowerLevel?: () => void;
  onVsFriend?: () => void;
  onSignOut?: () => void;
  onCacheImages?: () => void;
  pendingFriendCount?: number;
  onlineFriendCount?: number;
}

const DECK_IDS = ['saiyan', 'namekian', 'android', 'human', 'frieza_force', 'majin'];

const DECK_OPTIONS = [
  { id: 'saiyan', name: 'Saiyan', color: '#ff7a18' },
  { id: 'namekian', name: 'Namekian', color: '#34c759' },
  { id: 'android', name: 'Android', color: '#3aa6ff' },
  { id: 'human', name: 'Human', color: '#ffb648' },
  { id: 'frieza_force', name: 'Frieza Force', color: '#b44dff' },
  { id: 'majin', name: 'Majin', color: '#f03fcc' },
];

function getDeckImages(deckId: string): string[] {
  const deck = DECKS[deckId];
  if (!deck) return [];
  return [...deck.heroes, ...deck.items].flatMap(id => {
    try {
      const card = getCard(id);
      return card.image ? [`/${card.image}`] : [];
    } catch {
      return [];
    }
  });
}

function DeckPicker({
  label,
  selected,
  onSelect,
  showRandom = false,
}: {
  label: string;
  selected: string | null;
  onSelect: (id: string) => void;
  showRandom?: boolean;
}) {
  return (
    <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 8 }}>
      <span style={{
        fontFamily: 'Bangers, sans-serif',
        fontSize: 13,
        color: 'var(--muted)',
        letterSpacing: 1,
        textTransform: 'uppercase',
        textAlign: 'center',
      }}>
        {label}
      </span>
      {showRandom && (
        <button
          onClick={() => onSelect('random')}
          style={{
            background: selected === 'random' ? 'rgba(140,151,168,0.18)' : 'rgba(255,255,255,0.04)',
            border: selected === 'random' ? '2px solid var(--muted)' : '1.5px solid rgba(255,255,255,0.1)',
            borderRadius: 8,
            padding: '10px 8px',
            cursor: 'pointer',
            display: 'flex',
            alignItems: 'center',
            gap: 8,
            transition: 'all 0.15s',
            boxShadow: selected === 'random' ? '0 0 10px rgba(140,151,168,0.25)' : 'none',
          }}
        >
          <div style={{
            width: 10,
            height: 10,
            borderRadius: '50%',
            background: 'conic-gradient(#ff7a18 0% 16.67%, #34c759 16.67% 33.33%, #3aa6ff 33.33% 50%, #ffb648 50% 66.67%, #b44dff 66.67% 83.33%, #f03fcc 83.33% 100%)',
            flexShrink: 0,
          }} />
          <span style={{
            fontFamily: 'Saira Condensed, sans-serif',
            fontSize: 13,
            color: selected === 'random' ? 'var(--ink)' : 'var(--muted)',
            fontWeight: selected === 'random' ? 700 : 400,
            letterSpacing: 0.5,
            textTransform: 'uppercase',
          }}>
            Random
          </span>
        </button>
      )}
      {DECK_OPTIONS.map((deck) => {
        const isSelected = selected === deck.id;
        return (
          <button
            key={deck.id}
            onClick={() => onSelect(deck.id)}
            style={{
              background: isSelected ? `${deck.color}22` : 'rgba(255,255,255,0.04)',
              border: isSelected ? `2px solid ${deck.color}` : '1.5px solid rgba(255,255,255,0.1)',
              borderRadius: 8,
              padding: '10px 8px',
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              gap: 8,
              transition: 'all 0.15s',
              boxShadow: isSelected ? `0 0 12px ${deck.color}55` : 'none',
            }}
          >
            <div style={{
              width: 10,
              height: 10,
              borderRadius: '50%',
              background: deck.color,
              flexShrink: 0,
              boxShadow: isSelected ? `0 0 6px ${deck.color}` : 'none',
            }} />
            <span style={{
              fontFamily: 'Saira Condensed, sans-serif',
              fontSize: 13,
              color: isSelected ? deck.color : 'var(--ink)',
              fontWeight: isSelected ? 700 : 400,
              letterSpacing: 0.5,
              textTransform: 'uppercase',
            }}>
              {deck.name}
            </span>
          </button>
        );
      })}
    </div>
  );
}

interface PendingGame {
  p1Deck: string;
  p2Deck: string;
  firstPlayer: PlayerId;
  mode: GameMode;
  difficulty: Difficulty;
}

function LoadingScreen({ pending, onReady }: { pending: PendingGame; onReady: () => void }) {
  useEffect(() => {
    const srcs = [...new Set([...getDeckImages(pending.p1Deck), ...getDeckImages(pending.p2Deck)])];
    if (srcs.length === 0) { onReady(); return; }
    let done = 0;
    let settled = false;
    const ready = () => { if (!settled) { settled = true; onReady(); } };
    const finish = () => { done++; if (done >= srcs.length) ready(); };
    for (const src of srcs) {
      const img = new window.Image();
      img.src = src;
      if (typeof img.decode === 'function') {
        img.decode().then(finish).catch(finish);
      } else {
        img.onload = img.onerror = finish;
      }
    }
    // A stalled offline fetch can leave decode()/onload/onerror unresolved —
    // never let that leave the player stuck on this screen.
    const timeout = setTimeout(ready, 4000);
    return () => clearTimeout(timeout);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div style={{
      width: '100%',
      maxWidth: 430,
      minHeight: '100dvh',
      margin: '0 auto',
      background: 'var(--bg)',
      display: 'flex',
      flexDirection: 'column',
      alignItems: 'center',
      justifyContent: 'center',
      gap: 28,
    }}>
      <h1 style={{
        fontFamily: 'Bangers, sans-serif',
        fontSize: 52,
        background: 'linear-gradient(135deg, var(--ki), var(--ki2))',
        WebkitBackgroundClip: 'text',
        WebkitTextFillColor: 'transparent',
        backgroundClip: 'text',
        margin: 0,
        letterSpacing: 3,
      }}>
        Z-BATTLE
      </h1>
      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 14 }}>
        <div style={{ display: 'flex', gap: 8 }}>
          {[0, 1, 2].map(i => (
            <div
              key={i}
              style={{
                width: 8,
                height: 8,
                borderRadius: '50%',
                background: 'var(--ki)',
                animation: `loading-dot 1.2s ease-in-out ${i * 0.18}s infinite`,
              }}
            />
          ))}
        </div>
        <span style={{
          fontFamily: 'Bangers, sans-serif',
          fontSize: 13,
          letterSpacing: 4,
          color: 'var(--muted)',
          textTransform: 'uppercase',
        }}>
          INITIALISING
        </span>
      </div>
    </div>
  );
}

export default function SetupScreen({ onStart, userEmail, isGuest = false, onOpenFriends, onPowerLevel, onVsFriend, onSignOut, onCacheImages, pendingFriendCount = 0, onlineFriendCount = 0 }: SetupScreenProps) {
  const [screen, setScreen] = useState<'home' | 'setup' | 'loading'>('home');
  const [gameMode, setGameMode] = useState<GameMode>('vs_ai');
  const [p1Deck, setP1Deck] = useState<string | null>(null);
  const [p2Deck, setP2Deck] = useState<string | null>('random');
  const [firstPlayer, setFirstPlayer] = useState<PlayerId | null>(null);
  const [difficulty, setDifficulty] = useState<Difficulty>('hard');
  const [showRulebook, setShowRulebook] = useState(false);
  const [pendingGame, setPendingGame] = useState<PendingGame | null>(null);

  function resolveP2Deck(base: string | null): string {
    if (!base || base === 'random') {
      const pool = DECK_IDS.filter(d => d !== p1Deck);
      return pool[Math.floor(Math.random() * pool.length)] ?? DECK_IDS[0];
    }
    return base;
  }

  function handleStart() {
    if (!p1Deck || !p2Deck || !firstPlayer) return;
    const resolved = resolveP2Deck(p2Deck);
    const game: PendingGame = { p1Deck, p2Deck: resolved, firstPlayer, mode: gameMode, difficulty };
    setPendingGame(game);
    setScreen('loading');
  }

  if (screen === 'loading' && pendingGame) {
    return (
      <LoadingScreen
        pending={pendingGame}
        onReady={() => onStart(pendingGame.p1Deck, pendingGame.p2Deck, pendingGame.firstPlayer, pendingGame.mode, pendingGame.difficulty)}
      />
    );
  }

  const baseStyle: React.CSSProperties = {
    width: '100%',
    maxWidth: 430,
    minHeight: '100dvh',
    margin: '0 auto',
    background: 'var(--bg)',
    display: 'flex',
    flexDirection: 'column',
    paddingTop: 'max(24px, env(safe-area-inset-top))',
    paddingRight: '16px',
    paddingBottom: 'max(24px, env(safe-area-inset-bottom))',
    paddingLeft: '16px',
    fontFamily: 'Saira, sans-serif',
  };

  /* ---- HOME ---- */
  if (screen === 'home') {
    return (
      <div style={baseStyle}>
        <div style={{ textAlign: 'center', paddingTop: 36, paddingBottom: 32, position: 'relative' }}>
          <h1 style={{
            fontFamily: 'Bangers, sans-serif',
            fontSize: 56,
            background: 'linear-gradient(135deg, var(--ki), var(--ki2))',
            WebkitBackgroundClip: 'text',
            WebkitTextFillColor: 'transparent',
            backgroundClip: 'text',
            margin: 0,
            letterSpacing: 3,
          }}>
            Z-BATTLE
          </h1>
          <p style={{
            fontFamily: 'Saira Condensed, sans-serif',
            fontSize: 11,
            color: 'var(--muted)',
            letterSpacing: 2,
            textTransform: 'uppercase',
            margin: '4px 0 0',
          }}>
            {userEmail ?? 'Power Level Over 9000'}
          </p>
          <button
            onClick={() => setShowRulebook(true)}
            style={{
              position: 'absolute',
              top: 36,
              right: 0,
              background: 'rgba(255,255,255,0.05)',
              border: '1.5px solid rgba(255,255,255,0.12)',
              borderRadius: 8,
              padding: '6px 10px',
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              gap: 5,
            }}
          >
            <span style={{ fontSize: 13 }}>📖</span>
            <span style={{
              fontFamily: 'Bangers, sans-serif',
              fontSize: 11,
              letterSpacing: 1,
              color: 'var(--muted)',
              textTransform: 'uppercase',
            }}>Rules</span>
          </button>
          {onSignOut && (
            <button
              onClick={onSignOut}
              style={{
                position: 'absolute',
                top: 36,
                left: 0,
                background: 'transparent',
                border: '1px solid var(--line)',
                borderRadius: 8,
                padding: '6px 10px',
                cursor: 'pointer',
                fontFamily: 'Saira Condensed, sans-serif',
                fontSize: 10,
                color: 'var(--muted)',
                textTransform: 'uppercase',
                letterSpacing: 1,
              }}
            >
              {isGuest ? 'SIGN IN' : 'SIGN OUT'}
            </button>
          )}
        </div>

        {/* Mode buttons — vertical */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>

          {/* VS AI */}
          <button
            onClick={() => { setGameMode('vs_ai'); setP2Deck('random'); setScreen('setup'); }}
            style={{
              background: 'rgba(255,122,24,0.07)',
              border: '1.5px solid rgba(255,122,24,0.28)',
              borderRadius: 14,
              padding: 0,
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'stretch',
              textAlign: 'left',
              overflow: 'hidden',
            }}
          >
            <div style={{ width: 4, background: 'var(--ki)', flexShrink: 0 }} />
            <div style={{ padding: '18px 16px', flex: 1 }}>
              <div style={{
                fontFamily: 'Bangers, sans-serif',
                fontSize: 24,
                letterSpacing: 2,
                color: 'var(--ki)',
                lineHeight: 1,
              }}>VS AI</div>
              <div style={{
                fontFamily: 'Saira Condensed, sans-serif',
                fontSize: 12,
                color: 'var(--muted)',
                marginTop: 4,
                letterSpacing: 0.5,
              }}>Battle against the computer</div>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', paddingRight: 18, color: 'var(--ki)', fontSize: 22, opacity: 0.55 }}>›</div>
          </button>

          {/* HOTSEAT */}
          <button
            onClick={() => { setGameMode('hotseat'); setP2Deck(null); setScreen('setup'); }}
            style={{
              background: 'rgba(58,166,255,0.07)',
              border: '1.5px solid rgba(58,166,255,0.22)',
              borderRadius: 14,
              padding: 0,
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'stretch',
              textAlign: 'left',
              overflow: 'hidden',
            }}
          >
            <div style={{ width: 4, background: '#3aa6ff', flexShrink: 0 }} />
            <div style={{ padding: '18px 16px', flex: 1 }}>
              <div style={{
                fontFamily: 'Bangers, sans-serif',
                fontSize: 24,
                letterSpacing: 2,
                color: '#3aa6ff',
                lineHeight: 1,
              }}>HOTSEAT</div>
              <div style={{
                fontFamily: 'Saira Condensed, sans-serif',
                fontSize: 12,
                color: 'var(--muted)',
                marginTop: 4,
                letterSpacing: 0.5,
              }}>Two players, one device</div>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', paddingRight: 18, color: '#3aa6ff', fontSize: 22, opacity: 0.55 }}>›</div>
          </button>

          {/* VS FRIEND */}
          {onVsFriend ? (
            <button
              onClick={onVsFriend}
              style={{
                background: 'rgba(180,77,255,0.07)',
                border: '1.5px solid rgba(180,77,255,0.28)',
                borderRadius: 14,
                padding: 0,
                cursor: 'pointer',
                display: 'flex',
                alignItems: 'stretch',
                textAlign: 'left',
                overflow: 'hidden',
                width: '100%',
              }}
            >
              <div style={{ width: 4, background: '#b44dff', flexShrink: 0 }} />
              <div style={{ padding: '18px 16px', flex: 1 }}>
                <div style={{
                  fontFamily: 'Bangers, sans-serif',
                  fontSize: 24,
                  letterSpacing: 2,
                  color: '#b44dff',
                  lineHeight: 1,
                }}>VS FRIEND</div>
                <div style={{
                  fontFamily: 'Saira Condensed, sans-serif',
                  fontSize: 12,
                  color: 'var(--muted)',
                  marginTop: 4,
                  letterSpacing: 0.5,
                }}>Online multiplayer</div>
              </div>
              <div style={{ display: 'flex', alignItems: 'center', paddingRight: 18, color: '#b44dff', fontSize: 22, opacity: 0.55 }}>›</div>
            </button>
          ) : (
            <div style={{
              background: 'rgba(255,255,255,0.025)',
              border: '1.5px solid rgba(255,255,255,0.07)',
              borderRadius: 14,
              padding: 0,
              display: 'flex',
              alignItems: 'stretch',
              overflow: 'hidden',
              opacity: 0.5,
            }}>
              <div style={{ width: 4, background: 'var(--muted)', opacity: 0.4, flexShrink: 0 }} />
              <div style={{ padding: '18px 16px', flex: 1 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 9, lineHeight: 1 }}>
                  <span style={{
                    fontFamily: 'Bangers, sans-serif',
                    fontSize: 24,
                    letterSpacing: 2,
                    color: 'var(--muted)',
                  }}>VS FRIEND</span>
                  <span style={{
                    fontFamily: 'Bangers, sans-serif',
                    fontSize: 9,
                    letterSpacing: 1,
                    color: 'var(--ki2)',
                    background: 'rgba(255,182,72,0.12)',
                    border: '1px solid rgba(255,182,72,0.28)',
                    borderRadius: 4,
                    padding: '2px 5px',
                    lineHeight: 1.5,
                  }}>SOON</span>
                </div>
                <div style={{
                  fontFamily: 'Saira Condensed, sans-serif',
                  fontSize: 12,
                  color: 'var(--muted)',
                  marginTop: 4,
                  letterSpacing: 0.5,
                }}>Online multiplayer</div>
              </div>
            </div>
          )}
        </div>

        {/* Utility row */}
        <div style={{ display: 'flex', gap: 10, marginTop: 16 }}>
          {onOpenFriends ? (
            <button onClick={onOpenFriends} style={{
              flex: 1,
              background: 'rgba(255,255,255,0.05)',
              border: '1.5px solid rgba(255,255,255,0.14)',
              borderRadius: 12,
              padding: '14px 12px',
              cursor: 'pointer',
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              gap: 5,
              position: 'relative',
            }}>
              {pendingFriendCount > 0 && (
                <div style={{
                  position: 'absolute', top: 7, right: 9,
                  background: '#ff3b30', borderRadius: '50%',
                  minWidth: 17, height: 17,
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  padding: '0 4px', boxSizing: 'border-box',
                }}>
                  <span style={{ fontFamily: 'Bangers, sans-serif', fontSize: 10, color: '#fff', letterSpacing: 0.5, lineHeight: 1 }}>
                    {pendingFriendCount}
                  </span>
                </div>
              )}
              {pendingFriendCount === 0 && onlineFriendCount > 0 && (
                <div style={{
                  position: 'absolute', top: 9, right: 11,
                  width: 8, height: 8, borderRadius: '50%',
                  background: '#34c759',
                  boxShadow: '0 0 5px #34c759aa',
                }} />
              )}
              <span style={{
                fontFamily: 'Bangers, sans-serif',
                fontSize: 14,
                letterSpacing: 1.5,
                color: 'var(--ink)',
                textTransform: 'uppercase',
              }}>Friends List</span>
            </button>
          ) : (
            <div style={{
              flex: 1,
              background: 'rgba(255,255,255,0.025)',
              border: '1.5px solid rgba(255,255,255,0.07)',
              borderRadius: 12,
              padding: '14px 12px',
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              gap: 5,
              opacity: 0.5,
            }}>
              <span style={{
                fontFamily: 'Bangers, sans-serif',
                fontSize: 14,
                letterSpacing: 1.5,
                color: 'var(--muted)',
                textTransform: 'uppercase',
              }}>Friends List</span>
              <span style={{
                fontFamily: 'Bangers, sans-serif',
                fontSize: 9,
                letterSpacing: 1,
                color: 'var(--ki2)',
                background: 'rgba(255,182,72,0.1)',
                border: '1px solid rgba(255,182,72,0.22)',
                borderRadius: 3,
                padding: '1px 5px',
              }}>SOON</span>
            </div>
          )}
          {onPowerLevel ? (
            <button onClick={onPowerLevel} style={{
              flex: 1,
              background: 'rgba(255,255,255,0.05)',
              border: '1.5px solid rgba(255,255,255,0.14)',
              borderRadius: 12,
              padding: '14px 12px',
              cursor: 'pointer',
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              gap: 5,
            }}>
              <span style={{
                fontFamily: 'Bangers, sans-serif',
                fontSize: 14,
                letterSpacing: 1.5,
                color: 'var(--ink)',
                textTransform: 'uppercase',
              }}>Power Level</span>
            </button>
          ) : (
            <div style={{
              flex: 1,
              background: 'rgba(255,255,255,0.025)',
              border: '1.5px solid rgba(255,255,255,0.07)',
              borderRadius: 12,
              padding: '14px 12px',
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              gap: 5,
              opacity: 0.5,
            }}>
              <span style={{
                fontFamily: 'Bangers, sans-serif',
                fontSize: 14,
                letterSpacing: 1.5,
                color: 'var(--muted)',
                textTransform: 'uppercase',
              }}>Power Level</span>
              <span style={{
                fontFamily: 'Bangers, sans-serif',
                fontSize: 9,
                letterSpacing: 1,
                color: 'var(--ki2)',
                background: 'rgba(255,182,72,0.1)',
                border: '1px solid rgba(255,182,72,0.22)',
                borderRadius: 3,
                padding: '1px 5px',
              }}>SOON</span>
            </div>
          )}
        </div>

        {/* Pre-load images */}
        {onCacheImages && (
          <button onClick={onCacheImages} style={{
            background: 'transparent', border: 'none', cursor: 'pointer',
            fontFamily: 'Saira Condensed, sans-serif', fontSize: 10,
            color: 'var(--line)', letterSpacing: 1, textTransform: 'uppercase',
            textDecoration: 'underline', textDecorationColor: 'var(--line)',
            padding: '2px 0', alignSelf: 'center', marginTop: 8,
          }}>
            ◈ pre-load card images
          </button>
        )}

        {showRulebook && <RulebookModal onClose={() => setShowRulebook(false)} />}
      </div>
    );
  }

  /* ---- SETUP ---- */
  const canStart = p1Deck !== null && p2Deck !== null && firstPlayer !== null;
  const p2Label = gameMode === 'vs_ai' ? 'AI Deck' : 'Player 2';

  return (
    <div style={{ ...baseStyle, gap: 24 }}>
      {/* Header with back */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, paddingTop: 8 }}>
        <button
          onClick={() => setScreen('home')}
          style={{
            background: 'rgba(255,255,255,0.06)',
            border: '1.5px solid rgba(255,255,255,0.12)',
            borderRadius: 8,
            width: 36,
            height: 36,
            cursor: 'pointer',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            flexShrink: 0,
          }}
        >
          <span style={{ fontSize: 20, color: 'var(--muted)', lineHeight: 1 }}>‹</span>
        </button>
        <div>
          <h2 style={{
            fontFamily: 'Bangers, sans-serif',
            fontSize: 26,
            letterSpacing: 2,
            color: gameMode === 'vs_ai' ? 'var(--ki)' : '#3aa6ff',
            margin: 0,
            lineHeight: 1,
          }}>
            {gameMode === 'vs_ai' ? 'VS AI' : 'HOTSEAT'}
          </h2>
          <p style={{
            fontFamily: 'Saira Condensed, sans-serif',
            fontSize: 11,
            color: 'var(--muted)',
            letterSpacing: 1.5,
            textTransform: 'uppercase',
            margin: '3px 0 0',
          }}>
            Choose Your Decks
          </p>
        </div>
      </div>

      {/* Deck pickers */}
      <div style={{ display: 'flex', gap: 12 }}>
        <DeckPicker label="Player 1" selected={p1Deck} onSelect={setP1Deck} />
        <DeckPicker
          label={p2Label}
          selected={p2Deck}
          onSelect={setP2Deck}
          showRandom={gameMode === 'vs_ai'}
        />
      </div>

      {/* First player */}
      <div style={{
        background: 'var(--panel)',
        border: '1px solid var(--line)',
        borderRadius: 12,
        padding: '16px',
        display: 'flex',
        flexDirection: 'column',
        gap: 12,
      }}>
        <span style={{
          fontFamily: 'Bangers, sans-serif',
          fontSize: 13,
          color: 'var(--muted)',
          letterSpacing: 1,
          textTransform: 'uppercase',
          textAlign: 'center',
        }}>
          Who Goes First?
        </span>
        <div style={{ display: 'flex', gap: 8 }}>
          {(['p1', 'p2'] as PlayerId[]).map((pid) => {
            const label = pid === 'p1' ? 'PLAYER 1' : (gameMode === 'vs_ai' ? 'AI' : 'PLAYER 2');
            const isSelected = firstPlayer === pid;
            return (
              <button
                key={pid}
                onClick={() => setFirstPlayer(pid)}
                style={{
                  flex: 1,
                  background: isSelected
                    ? 'linear-gradient(135deg, var(--ki), var(--ki2))'
                    : 'rgba(255,255,255,0.04)',
                  border: isSelected
                    ? '2px solid var(--ki)'
                    : '1.5px solid rgba(255,255,255,0.1)',
                  borderRadius: 8,
                  padding: '12px 8px',
                  cursor: 'pointer',
                  fontFamily: 'Bangers, sans-serif',
                  fontSize: 14,
                  color: isSelected ? '#0d0f14' : 'var(--muted)',
                  letterSpacing: 1,
                  textTransform: 'uppercase' as const,
                  transition: 'all 0.15s',
                  boxShadow: isSelected ? '0 4px 16px rgba(255,122,24,0.4)' : 'none',
                }}
              >
                {label}
              </button>
            );
          })}
        </div>
      </div>

      {/* AI difficulty */}
      {gameMode === 'vs_ai' && (
        <div style={{
          background: 'var(--panel)',
          border: '1px solid var(--line)',
          borderRadius: 12,
          padding: '16px',
          display: 'flex',
          flexDirection: 'column',
          gap: 12,
        }}>
          <span style={{
            fontFamily: 'Bangers, sans-serif',
            fontSize: 13,
            color: 'var(--muted)',
            letterSpacing: 1,
            textTransform: 'uppercase',
            textAlign: 'center',
          }}>
            Strength
          </span>
          <div style={{ display: 'flex', gap: 8 }}>
            {([
              { id: 'medium' as Difficulty, label: 'NORMAL' },
              { id: 'hard' as Difficulty, label: 'HARD' },
              { id: 'strongest' as Difficulty, label: 'CHAMPION OF THE UNIVERSE' },
            ]).map(({ id, label }) => {
              const isSelected = difficulty === id;
              return (
                <button
                  key={id}
                  onClick={() => setDifficulty(id)}
                  title={id === 'strongest' ? 'Champion of the Universe' : undefined}
                  style={{
                    flex: 1,
                    background: isSelected
                      ? 'linear-gradient(135deg, var(--ki), var(--ki2))'
                      : 'rgba(255,255,255,0.04)',
                    border: isSelected
                      ? '2px solid var(--ki)'
                      : '1.5px solid rgba(255,255,255,0.1)',
                    borderRadius: 8,
                    padding: '12px 6px',
                    cursor: 'pointer',
                    fontFamily: 'Bangers, sans-serif',
                    fontSize: 12,
                    color: isSelected ? '#0d0f14' : 'var(--muted)',
                    letterSpacing: 0.5,
                    textTransform: 'uppercase' as const,
                    transition: 'all 0.15s',
                    boxShadow: isSelected ? '0 4px 16px rgba(255,122,24,0.4)' : 'none',
                  }}
                >
                  {label}
                </button>
              );
            })}
          </div>
        </div>
      )}

      {/* Start */}
      <button
        onClick={handleStart}
        disabled={!canStart}
        style={{
          background: canStart
            ? 'linear-gradient(135deg, var(--ki), var(--ki2))'
            : 'rgba(255,255,255,0.06)',
          border: 'none',
          borderRadius: 12,
          padding: '16px',
          cursor: canStart ? 'pointer' : 'not-allowed',
          fontFamily: 'Bangers, sans-serif',
          fontSize: 18,
          color: canStart ? '#0d0f14' : 'var(--muted)',
          letterSpacing: 2,
          textTransform: 'uppercase' as const,
          boxShadow: canStart ? '0 4px 24px rgba(255,122,24,0.5)' : 'none',
          transition: 'all 0.2s',
        }}
      >
        START BATTLE
      </button>
    </div>
  );
}
