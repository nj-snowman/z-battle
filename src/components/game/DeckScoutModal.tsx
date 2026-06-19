'use client';

import React, { useEffect, useRef, useState } from 'react';
import { DECKS, getCard } from '@/lib/engine/cards';

interface DeckScoutModalProps {
  p1Deck: string;
  p2Deck: string;
  isVsAi?: boolean;
  onDone: () => void;
}


function getDeckImages(deckId: string): string[] {
  const deck = DECKS[deckId];
  if (!deck) return [];
  const allIds = [...(deck.heroes ?? []), ...(deck.items ?? [])];
  const seen = new Set<string>();
  const images: string[] = [];
  for (const id of allIds) {
    try {
      const card = getCard(id);
      if (card.image && !seen.has(card.image)) {
        seen.add(card.image);
        images.push(card.image);
      }
    } catch { /* skip unknown */ }
  }
  return images;
}

const DECK_LABELS: Record<string, string> = {
  saiyan: 'SAIYAN',
  namekian: 'NAMEKIAN',
  android: 'ANDROID',
  human: 'EARTHLING',
  frieza_force: 'FRIEZA FORCE',
};

const MIN_DISPLAY_MS = 600;

export default function DeckScoutModal({ p1Deck, p2Deck, isVsAi = false, onDone }: DeckScoutModalProps) {
  const [loaded, setLoaded] = useState(0);
  const [total, setTotal] = useState(1);
  const [ready, setReady] = useState(false);
  const countRef = useRef(0);
  const doneRef = useRef(false);

  const storedColor = typeof window !== 'undefined'
    ? (localStorage.getItem('scouter_color') ?? 'green')
    : 'green';

  const COLORS: Record<string, { bg: string; vivid: string; muted: string }> = {
    green:  { bg: '#001a08', vivid: '#00c426', muted: '#004d15' },
    red:    { bg: '#280000', vivid: '#e82020', muted: '#5a0000' },
    purple: { bg: '#1c0028', vivid: '#b830e8', muted: '#4a0066' },
    blue:   { bg: '#001428', vivid: '#0096e8', muted: '#003566' },
  };
  const c = COLORS[storedColor] ?? COLORS.green;

  useEffect(() => {
    const startTime = Date.now();

    const allImages = [...new Set([...getDeckImages(p1Deck), ...getDeckImages(p2Deck)])];
    const n = allImages.length;
    setTotal(n || 1);
    countRef.current = 0;

    function finish(count: number) {
      if (count < n || doneRef.current) return;
      doneRef.current = true;
      const wait = Math.max(0, MIN_DISPLAY_MS - (Date.now() - startTime));
      setTimeout(() => {
        setReady(true);
        setTimeout(onDone, 400);
      }, wait);
    }

    if (n === 0) { finish(0); return; }

    for (const path of allImages) {
      const img = new window.Image();
      const done = () => {
        countRef.current += 1;
        const c = countRef.current;
        setLoaded(c);
        finish(c);
      };
      img.onload = done;
      img.onerror = done;
      img.src = `/${path}`;
    }
  // onDone is intentionally excluded — we only want this to run once on mount
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [p1Deck, p2Deck]);

  const pct = Math.round((loaded / total) * 100);
  const filled = Math.round(pct / 10);

  const p1Label = DECK_LABELS[p1Deck] ?? p1Deck.toUpperCase();
  const p2Label = DECK_LABELS[p2Deck] ?? p2Deck.toUpperCase();

  return (
    <div style={{
      position: 'fixed', inset: 0, zIndex: 600,
      background: 'rgba(0,0,0,0.92)',
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      padding: 24,
    }}>
      {/* Scanlines */}
      <div style={{
        position: 'fixed', inset: 0, pointerEvents: 'none',
        backgroundImage: `repeating-linear-gradient(0deg, transparent, transparent 2px, ${c.vivid}08 2px, ${c.vivid}08 4px)`,
      }} />

      <div style={{
        position: 'relative',
        width: '100%', maxWidth: 300,
        background: c.bg,
        border: `2px solid ${c.vivid}`,
        borderRadius: 16,
        padding: '22px 20px 20px',
        fontFamily: 'Courier New, monospace',
        fontWeight: 700,
        boxShadow: `0 0 50px ${c.vivid}25, 0 0 100px rgba(0,0,0,0.95)`,
      }}>

        {/* Corner brackets */}
        <span style={{ position: 'absolute', top: 5, left: 7, color: c.vivid, fontSize: 13, opacity: 0.5 }}>⌐</span>
        <span style={{ position: 'absolute', top: 5, right: 7, color: c.vivid, fontSize: 13, opacity: 0.5, display: 'inline-block', transform: 'scaleX(-1)' }}>⌐</span>
        <span style={{ position: 'absolute', bottom: 5, left: 7, color: c.vivid, fontSize: 13, opacity: 0.5, display: 'inline-block', transform: 'scaleY(-1)' }}>⌐</span>
        <span style={{ position: 'absolute', bottom: 5, right: 7, color: c.vivid, fontSize: 13, opacity: 0.5, display: 'inline-block', transform: 'scale(-1)' }}>⌐</span>

        {/* Header */}
        <div style={{ fontSize: 8, color: c.muted, letterSpacing: 3, marginBottom: 14, textTransform: 'uppercase' }}>
          ◈ CAPSULE CORP SCOUTER v3.1
        </div>

        {/* Title */}
        <div style={{ fontSize: 15, color: c.vivid, letterSpacing: 3, textTransform: 'uppercase', marginBottom: 6 }}>
          {ready ? 'READY' : 'SCOUTING'}
        </div>
        <div style={{ fontSize: 9, color: c.muted, letterSpacing: 1, marginBottom: 14 }}>
          {'━'.repeat(28)}
        </div>

        {/* Match info */}
        <div style={{ fontSize: 9, color: c.muted, letterSpacing: 2, marginBottom: 4 }}>
          {isVsAi ? 'OPPONENT' : 'PLAYERS'}
        </div>
        <div style={{ fontSize: 13, color: c.vivid, letterSpacing: 2, marginBottom: 14 }}>
          {p1Label}&nbsp;
          <span style={{ color: c.muted, fontSize: 11 }}>vs</span>
          &nbsp;{p2Label}
        </div>

        {/* Progress bar */}
        <div style={{ fontSize: 18, letterSpacing: 3, lineHeight: 1, marginBottom: 8 }}>
          <span style={{ color: c.vivid }}>{'█'.repeat(filled)}</span>
          <span style={{ color: c.muted }}>{'░'.repeat(10 - filled)}</span>
        </div>

        <div style={{ fontSize: 9, letterSpacing: 2 }}>
          {ready ? (
            <span style={{ color: c.vivid }}>✓ UNIT DATA ACQUIRED</span>
          ) : (
            <span className="scouter-reading" style={{ color: c.vivid }}>SCANNING UNITS</span>
          )}
          <span style={{ color: c.muted, marginLeft: 8 }}>{pct}%</span>
        </div>
      </div>
    </div>
  );
}
