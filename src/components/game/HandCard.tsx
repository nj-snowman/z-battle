'use client';

import React from 'react';
import Image from 'next/image';
import { getCard } from '@/lib/engine/cards';

interface HandCardProps {
  cardId: string;
  isSelected?: boolean;
  /**
   * What this card costs right now, when that's less than the cost printed on its art
   * (Gotenks's Fusion). Omitted whenever the printed cost is the real cost. The art is a
   * flat image, so without this badge a discount is invisible until you notice the card
   * has gone playable.
   */
  discountedCost?: number;
}

const TYPE_ACCENT: Record<string, string> = {
  saiyan: '#ff7a18',
  namekian: '#34c759',
  android: '#3aa6ff',
  earthling: '#ffb648',
  frieza_force: '#b44dff',
  majin: '#f03fcc',
  kai: '#7de2e0',
  rascal: '#ffd447',
};

function getArtBg(cardType: string, fighterType?: string): string {
  if (cardType === 'hero' && fighterType) return `${TYPE_ACCENT[fighterType] ?? '#ffb648'}18`;
  if (cardType === 'item') return 'rgba(31,184,196,0.12)';
  return 'rgba(76,217,100,0.12)';
}

function getFallbackColor(cardType: string, fighterType?: string): string {
  if (cardType === 'hero' && fighterType) return `${TYPE_ACCENT[fighterType] ?? '#ffb648'}60`;
  if (cardType === 'item') return 'rgba(31,184,196,0.5)';
  return 'rgba(76,217,100,0.5)';
}

export default function HandCard({ cardId, isSelected = false, discountedCost }: HandCardProps) {
  let card;
  try {
    card = getCard(cardId);
  } catch {
    card = null;
  }

  const name = card?.name ?? cardId;
  const cardType = card?.cardType ?? 'item';
  const fighterType = card?.fighterType;

  const artBg = getArtBg(cardType, fighterType);
  const fallbackColor = getFallbackColor(cardType, fighterType);

  return (
    <div
      style={{
        width: 86,
        height: 120,
        borderRadius: 8,
        border: isSelected ? '2px solid var(--ki)' : '1.5px solid var(--line)',
        background: 'var(--panel)',
        overflow: 'hidden',
        flexShrink: 0,
        boxShadow: isSelected ? '0 0 12px var(--ki)' : 'none',
        cursor: 'pointer',
        userSelect: 'none',
        WebkitUserSelect: 'none',
        transform: isSelected ? 'translateY(-8px)' : 'none',
        transition: 'transform 0.15s, box-shadow 0.15s',
        position: 'relative',
      }}
    >
      {card?.image ? (
        <Image
          fill
          src={`/${card.image}`}
          alt={name}
          sizes="86px"
          loading="eager"
          draggable={false}
          style={{ objectFit: 'cover', WebkitTouchCallout: 'none' as any }}
        />
      ) : (
        <div style={{
          width: '100%', height: '100%',
          background: artBg,
          display: 'flex', alignItems: 'center', justifyContent: 'center',
        }}>
          <span style={{
            fontFamily: 'Bangers, sans-serif',
            fontSize: 28,
            color: fallbackColor,
            userSelect: 'none',
          }}>
            {name.charAt(0)}
          </span>
        </div>
      )}

      {/* Live cost badge — only rendered when an ability is undercutting the printed cost */}
      {discountedCost !== undefined && (
        <div style={{
          position: 'absolute',
          top: 3,
          right: 3,
          minWidth: 18,
          height: 18,
          borderRadius: 9,
          background: 'linear-gradient(135deg, var(--ki), var(--ki2))',
          border: '1.5px solid rgba(0,0,0,0.55)',
          boxShadow: '0 0 10px rgba(255,122,24,0.85)',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          padding: '0 3px',
        }}>
          <span style={{
            fontFamily: 'Bangers, sans-serif',
            fontSize: 12,
            lineHeight: 1,
            color: '#0d0f14',
            letterSpacing: 0.5,
          }}>
            {discountedCost}
          </span>
        </div>
      )}
    </div>
  );
}
