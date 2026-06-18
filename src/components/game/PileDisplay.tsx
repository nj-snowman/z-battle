'use client';

import React from 'react';

interface PileDisplayProps {
  piles: { hero: string[]; item: string[] };
}

function PileStack({
  label,
  count,
  color,
}: {
  label: string;
  count: number;
  color: string;
}) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 2 }}>
      <div style={{ position: 'relative', width: 28, height: 36 }}>
        {[2, 1, 0].map((offset) => (
          <div
            key={offset}
            style={{
              position: 'absolute',
              width: 24,
              height: 32,
              borderRadius: 3,
              background: color,
              border: '1px solid rgba(255,255,255,0.1)',
              left: offset * 2,
              top: offset * 2,
            }}
          />
        ))}
        <div style={{
          position: 'absolute',
          inset: 0,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          zIndex: 10,
        }}>
          <span style={{
            fontFamily: 'Saira Condensed, sans-serif',
            fontSize: 10,
            fontWeight: 700,
            color: 'rgba(255,255,255,0.9)',
          }}>{count}</span>
        </div>
      </div>
      <span style={{
        fontFamily: 'Saira Condensed, sans-serif',
        fontSize: 8,
        color: 'var(--muted)',
        textTransform: 'uppercase',
        letterSpacing: 0.5,
      }}>{label}</span>
    </div>
  );
}

export default function PileDisplay({ piles }: PileDisplayProps) {
  return (
    <div style={{ display: 'flex', gap: 6, alignItems: 'flex-end' }}>
      <PileStack label="Hero" count={piles.hero.length} color="var(--panel2)" />
      <PileStack label="Item" count={piles.item.length} color="#1a2a1a" />
    </div>
  );
}
