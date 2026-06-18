'use client';

import React from 'react';
import type { FighterInstance } from '@/lib/engine/types';
import { getCard } from '@/lib/engine/cards';

interface ZoomAction {
  label: string;
  variant?: 'primary' | 'secondary';
  onClick: () => void;
  needsConfirm?: boolean;
}

interface CardZoomOverlayProps {
  cardId: string;
  fighter?: FighterInstance;
  onClose: () => void;
  actions?: ZoomAction[];
  isOpponentFighter?: boolean;
  effectiveAtk?: number;
  effectiveDef?: number;
}

export default function CardZoomOverlay({ cardId, fighter, onClose, actions = [], isOpponentFighter = false, effectiveAtk, effectiveDef }: CardZoomOverlayProps) {
  const [confirmingIdx, setConfirmingIdx] = React.useState<number | null>(null);
  const [viewIdx, setViewIdx] = React.useState(0);

  const equipment = fighter?.equipment ?? [];
  const allCardIds = [cardId, ...equipment];
  const currentCardId = allCardIds[viewIdx] ?? cardId;
  const isViewingHero = viewIdx === 0;
  const hasEquipment = equipment.length > 0;

  let card;
  try { card = getCard(currentCardId); } catch { card = null; }

  const name = card?.name ?? currentCardId;
  const hasActions = actions.length > 0 && isViewingHero;

  const hpPct = fighter && fighter.maxHp > 0 ? fighter.currentHp / fighter.maxHp : null;
  const isLowHp = hpPct !== null && hpPct <= 0.5;
  const isStunned = fighter?.statuses.some(s => s.key === 'stun') ?? false;

  function fmt(n: number): string {
    if (n >= 1000) {
      const v = n / 1000;
      return v === Math.floor(v) ? `${v.toFixed(0)}k` : `${v.toFixed(1)}k`;
    }
    return String(n);
  }

  return (
    <div
      onClick={onClose}
      style={{
        position: 'fixed', inset: 0, zIndex: 500,
        background: 'rgba(0,0,0,0.72)',
        display: 'flex', alignItems: 'flex-end', justifyContent: 'center',
      }}
    >
      <div
        onClick={e => e.stopPropagation()}
        className="sheet-rise"
        style={{
          display: 'flex', flexDirection: 'column',
          alignItems: 'center',
          gap: 12,
          width: '100%',
          maxWidth: 430,
          maxHeight: '88dvh',
          overflowY: 'auto',
          background: '#13171f',
          borderRadius: '20px 20px 0 0',
          padding: '0 16px max(24px, env(safe-area-inset-bottom))',
          WebkitOverflowScrolling: 'touch' as React.CSSProperties['WebkitOverflowScrolling'],
        }}
      >
        {/* Handle bar */}
        <div style={{
          width: 36, height: 4, borderRadius: 2,
          background: 'rgba(255,255,255,0.2)',
          margin: '12px 0 4px', flexShrink: 0,
        }} />
        {/* Card image */}
        <div style={{ position: 'relative', display: 'inline-block' }}>
          {card?.image ? (
            <img
              src={`/${card.image}`}
              alt={name}
              style={{
                maxHeight: 'min(62dvh, 420px)',
                maxWidth: 'min(90vw, 340px)',
                borderRadius: 10,
                objectFit: 'contain',
                display: 'block',
              }}
            />
          ) : (
            <div style={{
              width: 200, height: 280,
              borderRadius: 10,
              background: 'rgba(255,255,255,0.06)',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
            }}>
              <span style={{
                fontFamily: 'Bangers, sans-serif', fontSize: 80,
                color: 'rgba(255,255,255,0.2)', userSelect: 'none',
              }}>
                {name.charAt(0).toUpperCase()}
              </span>
            </div>
          )}
          {/* Scouter scan overlay (opponent hero only) */}
          {isOpponentFighter && isViewingHero && (
            <div
              className="scouter-scan"
              style={{
                position: 'absolute',
                inset: 0,
                borderRadius: 10,
                background: 'rgba(255, 80, 0, 0.08)',
                backgroundImage: 'repeating-linear-gradient(0deg, transparent, transparent 3px, rgba(255,60,0,0.07) 3px, rgba(255,60,0,0.07) 4px)',
                pointerEvents: 'none',
              }}
            >
              <span
                className="scouter-reading"
                style={{
                  position: 'absolute',
                  bottom: 8,
                  left: 8,
                  fontFamily: 'Bangers, sans-serif',
                  fontSize: 8,
                  color: '#ff4d4d',
                  letterSpacing: 1,
                  textTransform: 'uppercase',
                }}
              >
                READING...
              </span>
            </div>
          )}
        </div>

        {/* Live stats — shown only when viewing a fighter from the field */}
        {fighter && hpPct !== null && isViewingHero && (
          <div style={{
            width: '100%',
            background: 'rgba(255,255,255,0.04)',
            border: '1px solid rgba(255,255,255,0.08)',
            borderRadius: 12,
            padding: '12px 16px',
            display: 'flex',
            flexDirection: 'column',
            gap: 10,
          }}>
            {/* HP row */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
                <span style={{ fontFamily: 'Saira Condensed, sans-serif', fontSize: 11, color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: 1 }}>HP</span>
                <span style={{ fontFamily: 'Saira Condensed, sans-serif', fontSize: 18, color: isLowHp ? '#ff4d4d' : 'var(--hp)', lineHeight: 1 }}>
                  {fmt(fighter.currentHp)}<span style={{ fontSize: 13, color: 'var(--muted)' }}>/{fmt(fighter.maxHp)}</span>
                </span>
              </div>
              <div style={{ height: 6, borderRadius: 3, background: 'rgba(0,0,0,0.4)', overflow: 'hidden' }}>
                <div style={{
                  width: `${Math.max(0, hpPct * 100)}%`,
                  height: '100%',
                  background: isLowHp ? '#ff4d4d' : 'var(--hp)',
                  borderRadius: 3,
                  transition: 'width 0.3s',
                }} />
              </div>
            </div>
            {/* ATK / DEF row */}
            {(effectiveAtk !== undefined || effectiveDef !== undefined) && (
              <div style={{ display: 'flex', gap: 8 }}>
                {effectiveAtk !== undefined && (
                  <div style={{
                    flex: 1, background: 'rgba(255,77,77,0.08)', border: '1px solid rgba(255,77,77,0.2)',
                    borderRadius: 8, padding: '8px 12px',
                    display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 2,
                  }}>
                    <span style={{ fontFamily: 'Saira Condensed, sans-serif', fontSize: 10, color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: 1 }}>ATK</span>
                    <span style={{ fontFamily: 'Bangers, sans-serif', fontSize: 28, color: 'var(--atk)', letterSpacing: 1, lineHeight: 1 }}>{fmt(effectiveAtk)}</span>
                  </div>
                )}
                {effectiveDef !== undefined && (
                  <div style={{
                    flex: 1, background: 'rgba(58,166,255,0.08)', border: '1px solid rgba(58,166,255,0.2)',
                    borderRadius: 8, padding: '8px 12px',
                    display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 2,
                  }}>
                    <span style={{ fontFamily: 'Saira Condensed, sans-serif', fontSize: 10, color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: 1 }}>DEF</span>
                    <span style={{ fontFamily: 'Bangers, sans-serif', fontSize: 28, color: 'var(--def)', letterSpacing: 1, lineHeight: 1 }}>{fmt(effectiveDef)}</span>
                  </div>
                )}
              </div>
            )}
            {/* Status badges */}
            {(fighter.summoningSick || fighter.hasAttackedThisTurn || isStunned) && (
              <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                {fighter.summoningSick && (
                  <span style={{ fontFamily: 'Saira Condensed, sans-serif', fontSize: 10, fontWeight: 700, color: '#0d0f14', background: '#ffb648', borderRadius: 4, padding: '2px 8px', textTransform: 'uppercase', letterSpacing: 0.5 }}>SUMMONING SICK</span>
                )}
                {fighter.hasAttackedThisTurn && (
                  <span style={{ fontFamily: 'Saira Condensed, sans-serif', fontSize: 10, fontWeight: 700, color: '#0d0f14', background: 'var(--muted)', borderRadius: 4, padding: '2px 8px', textTransform: 'uppercase', letterSpacing: 0.5 }}>ACTED</span>
                )}
                {isStunned && (
                  <span style={{ fontFamily: 'Saira Condensed, sans-serif', fontSize: 10, fontWeight: 700, color: '#fff', background: 'var(--atk)', borderRadius: 4, padding: '2px 8px', textTransform: 'uppercase', letterSpacing: 0.5 }}>STUNNED</span>
                )}
              </div>
            )}
          </div>
        )}

        {/* Card selector thumbnails (hero + equipment) */}
        {hasEquipment && (
          <div style={{ display: 'flex', gap: 8, justifyContent: 'center' }}>
            {allCardIds.map((cId, idx) => {
              let thumbCard; try { thumbCard = getCard(cId); } catch { thumbCard = null; }
              const isSelected = viewIdx === idx;
              return (
                <div
                  key={idx}
                  onClick={e => { e.stopPropagation(); setViewIdx(idx); setConfirmingIdx(null); }}
                  style={{
                    width: 44,
                    height: 62,
                    borderRadius: 5,
                    overflow: 'hidden',
                    border: isSelected ? '2px solid var(--ki)' : '1.5px solid rgba(255,255,255,0.15)',
                    boxShadow: isSelected ? '0 0 8px rgba(255,122,24,0.5)' : 'none',
                    cursor: 'pointer',
                    flexShrink: 0,
                    transform: isSelected ? 'scale(1.08)' : 'scale(1)',
                    transition: 'transform 0.15s',
                    background: 'var(--panel)',
                  }}
                >
                  {thumbCard?.image ? (
                    <img
                      src={`/${thumbCard.image}`}
                      alt={thumbCard.name ?? cId}
                      style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }}
                    />
                  ) : (
                    <div style={{
                      width: '100%', height: '100%',
                      display: 'flex', alignItems: 'center', justifyContent: 'center',
                      background: 'rgba(255,255,255,0.06)',
                    }}>
                      <span style={{ fontFamily: 'Bangers, sans-serif', fontSize: 16, color: 'rgba(255,255,255,0.3)' }}>
                        {(thumbCard?.name ?? cId).charAt(0).toUpperCase()}
                      </span>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}

        {/* Action buttons */}
        {hasActions && (
          <div style={{ display: 'flex', gap: 8, width: '100%' }}>
            {confirmingIdx !== null ? (
              <>
                <span style={{
                  flex: 1, display: 'flex', alignItems: 'center',
                  fontFamily: 'Saira Condensed, sans-serif', fontSize: 13,
                  color: '#ff4d4d', textTransform: 'uppercase', letterSpacing: 1,
                }}>
                  {actions[confirmingIdx].label}?
                </span>
                <button
                  onClick={e => { e.stopPropagation(); actions[confirmingIdx].onClick(); setConfirmingIdx(null); }}
                  style={{
                    padding: '10px 20px', borderRadius: 8, border: 'none',
                    background: '#ff4d4d', color: '#fff',
                    fontFamily: 'Bangers, sans-serif', fontSize: 13, letterSpacing: 1,
                    textTransform: 'uppercase', cursor: 'pointer',
                  }}
                >YES</button>
                <button
                  onClick={e => { e.stopPropagation(); setConfirmingIdx(null); }}
                  style={{
                    padding: '10px 16px', borderRadius: 8,
                    border: '1px solid rgba(255,255,255,0.18)',
                    background: 'rgba(0,0,0,0.5)', color: 'rgba(255,255,255,0.7)',
                    fontFamily: 'Saira Condensed, sans-serif', fontSize: 12, letterSpacing: 1,
                    textTransform: 'uppercase', cursor: 'pointer',
                  }}
                >NO</button>
              </>
            ) : (
              actions.map((action, i) => (
                <button
                  key={i}
                  onClick={e => {
                    e.stopPropagation();
                    if (action.needsConfirm) { setConfirmingIdx(i); } else { action.onClick(); }
                  }}
                  style={{
                    flex: 1,
                    padding: '12px 8px',
                    borderRadius: 8,
                    border: action.variant === 'primary' ? 'none' : '1px solid rgba(255,255,255,0.25)',
                    background: action.variant === 'primary'
                      ? 'linear-gradient(135deg, #ff7a18, #ffb648)'
                      : 'rgba(255,255,255,0.08)',
                    color: action.variant === 'primary' ? '#0d0f14' : 'var(--ink)',
                    fontFamily: 'Bangers, sans-serif', fontSize: 13,
                    letterSpacing: 1, textTransform: 'uppercase', cursor: 'pointer',
                  }}
                >
                  {action.label}
                </button>
              ))
            )}
          </div>
        )}

        {/* Back button */}
        <button
          onClick={e => { e.stopPropagation(); onClose(); }}
          style={{
            padding: '10px 32px',
            borderRadius: 8,
            border: '1px solid rgba(255,255,255,0.18)',
            background: 'rgba(0,0,0,0.5)',
            color: 'rgba(255,255,255,0.7)',
            fontFamily: 'Saira Condensed, sans-serif',
            fontSize: 13,
            letterSpacing: 1.5,
            textTransform: 'uppercase',
            cursor: 'pointer',
            width: '100%',
          }}
        >
          BACK
        </button>
      </div>
    </div>
  );
}
