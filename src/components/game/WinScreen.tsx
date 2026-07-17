'use client';

import React from 'react';
import type { GameOutcome } from '@/lib/engine/types';

interface WinScreenProps {
  winner: GameOutcome;
  winnerDeck?: string;
  onPlayAgain: () => void;
}

export default function WinScreen({ winner, winnerDeck, onPlayAgain }: WinScreenProps) {
  const isTie = winner === 'tie';
  const playerLabel = winner === 'p1' ? 'PLAYER 1' : 'PLAYER 2';
  const deckDisplay = winnerDeck?.replace('_', ' ').toUpperCase();

  return (
    <div
      style={{
        width: '100%',
        maxWidth: 430,
        minHeight: '100dvh',
        margin: '0 auto',
        background: 'var(--bg)',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        gap: 32,
        paddingTop: 'max(24px, env(safe-area-inset-top))',
        paddingRight: '16px',
        paddingBottom: 'max(24px, env(safe-area-inset-bottom))',
        paddingLeft: '16px',
        fontFamily: 'Saira, sans-serif',
      }}
    >
      {/* Win title */}
      <div style={{ textAlign: 'center' }}>
        <p
          style={{
            fontFamily: 'Saira Condensed, sans-serif',
            fontSize: 13,
            color: 'var(--muted)',
            letterSpacing: 3,
            textTransform: 'uppercase',
            margin: '0 0 8px',
          }}
        >
          {isTie ? 'Draw!' : 'Victory!'}
        </p>
        <h1
          style={{
            fontFamily: 'Bangers, sans-serif',
            fontSize: 38,
            background: 'linear-gradient(135deg, var(--ki), var(--ki2))',
            WebkitBackgroundClip: 'text',
            WebkitTextFillColor: 'transparent',
            backgroundClip: 'text',
            margin: 0,
            letterSpacing: 2,
          }}
        >
          {isTie ? "IT'S A TIE!" : `${playerLabel} WINS!`}
        </h1>
        <p
          style={{
            fontFamily: 'Saira Condensed, sans-serif',
            fontSize: 13,
            color: 'var(--muted)',
            letterSpacing: 2,
            textTransform: 'uppercase',
            margin: '8px 0 0',
          }}
        >
          {isTie ? 'NO KOs IN 10 TURNS' : `${deckDisplay} DECK`}
        </p>
      </div>

      {/* Divider */}
      <div
        style={{
          width: 60,
          height: 2,
          background: 'linear-gradient(90deg, transparent, var(--ki), transparent)',
        }}
      />

      {/* Play again button */}
      <button
        onClick={onPlayAgain}
        style={{
          background: 'linear-gradient(135deg, var(--ki), var(--ki2))',
          border: 'none',
          borderRadius: 12,
          padding: '16px 48px',
          cursor: 'pointer',
          fontFamily: 'Bangers, sans-serif',
          fontSize: 16,
          color: '#0d0f14',
          letterSpacing: 2,
          textTransform: 'uppercase' as const,
          boxShadow: '0 4px 24px rgba(255,122,24,0.5)',
        }}
      >
        PLAY AGAIN
      </button>
    </div>
  );
}
