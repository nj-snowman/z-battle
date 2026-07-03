'use client';

import React from 'react';
import type { FighterInstance } from '@/lib/engine/types';
import { getCard } from '@/lib/engine/cards';

interface FighterSlotProps {
  fighter: FighterInstance | null;
  isActive: boolean;
  isOpponent: boolean;
  isCurrentTurnPlayer: boolean;
  isSelected?: boolean;
  isValidTarget?: boolean;
  isValidPlaySlot?: boolean;
  compact?: boolean;
  canAttack?: boolean;
  shaking?: boolean;
  incomingDamage?: { amount: number; seq: number };
  effectiveAtk?: number;
  effectiveDef?: number;
  onTap?: () => void;
}

const TYPE_GRADIENTS: Record<string, string> = {
  saiyan: 'linear-gradient(135deg, #2a1a0a, #5c2e0a)',
  namekian: 'linear-gradient(135deg, #0a1f0a, #143d14)',
  android: 'linear-gradient(135deg, #0d1520, #1a2d45)',
  earthling: 'linear-gradient(135deg, #1a1505, #3d3510)',
  frieza_force: 'linear-gradient(135deg, #150d20, #2d1a45)',
  majin: 'linear-gradient(135deg, #1a0820, #3d1040)',
};

const TYPE_ACCENT: Record<string, string> = {
  saiyan: '#ff7a18',
  namekian: '#34c759',
  android: '#3aa6ff',
  earthling: '#ffb648',
  frieza_force: '#b44dff',
  majin: '#f03fcc',
};

const TYPE_LABEL: Record<string, string> = {
  saiyan: 'SAIYAN',
  namekian: 'NAMEKIAN',
  android: 'ANDROID',
  earthling: 'EARTHLING',
  frieza_force: 'FRIEZA FORCE',
  majin: 'MAJIN',
};

function formatStat(n: number): string {
  if (n >= 1000) {
    const v = n / 1000;
    return v === Math.floor(v) ? `${v.toFixed(0)}k` : `${v.toFixed(1)}k`;
  }
  return String(n);
}

function equipBonuses(ids: string[]): { atk: number; def: number } {
  let atk = 0, def = 0;
  for (const id of ids) {
    let item; try { item = getCard(id); } catch { continue; }
    for (const ab of item.abilities) {
      if (ab.kind === 'attach_stat') {
        const p = ab.params as Record<string, number>;
        if (p.atk) atk += p.atk;
        if (p.def) def += p.def;
      }
    }
  }
  return { atk, def };
}

export default function FighterSlot({
  fighter,
  isActive,
  isOpponent,
  isCurrentTurnPlayer,
  isSelected = false,
  isValidTarget = false,
  isValidPlaySlot = false,
  compact = false,
  canAttack = false,
  shaking = false,
  incomingDamage,
  effectiveAtk,
  effectiveDef,
  onTap,
}: FighterSlotProps) {
  // Empty slot
  if (!fighter) {
    const w = isActive ? (compact ? 110 : 140) : compact ? 60 : 90;
    const h = isActive ? (compact ? 154 : 196) : compact ? 84 : 126;
    return (
      <div
        onClick={onTap}
        style={{
          width: w,
          height: h,
          borderRadius: 8,
          border: isValidPlaySlot ? '2px dashed var(--ki)' : '1.5px dashed var(--line)',
          background: isValidPlaySlot ? 'rgba(255,122,24,0.06)' : 'rgba(22,26,34,0.4)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          opacity: isValidPlaySlot ? 1 : 0.5,
          flexShrink: 0,
          cursor: isValidPlaySlot ? 'pointer' : 'default',
          boxShadow: isValidPlaySlot ? '0 0 8px rgba(255,122,24,0.3)' : 'none',
          WebkitTapHighlightColor: 'rgba(255,255,255,0.1)',
        }}
      >
        <span style={{
          fontFamily: 'Saira Condensed, sans-serif',
          fontSize: 9,
          color: isValidPlaySlot ? 'var(--ki)' : 'var(--line)',
          textTransform: 'uppercase',
          letterSpacing: 1,
        }}>
          {isValidPlaySlot ? 'PLAY' : 'Empty'}
        </span>
      </div>
    );
  }

  let card;
  try {
    card = getCard(fighter.cardId);
  } catch {
    card = null;
  }

  const name = card?.name ?? fighter.cardId;
  const fighterType = card?.fighterType ?? 'earthling';
  const baseAtk = card?.atk ?? 0;
  const baseDef = card?.def ?? 0;

  const gradient = TYPE_GRADIENTS[fighterType] ?? TYPE_GRADIENTS.earthling;
  const accent = TYPE_ACCENT[fighterType] ?? TYPE_ACCENT.earthling;

  const hpPct = fighter.maxHp > 0 ? fighter.currentHp / fighter.maxHp : 0;
  const isLowHp = hpPct <= 0.5;
  const isStunned = fighter.statuses.some((s) => s.key === 'stun');

  const w = isActive ? (compact ? 110 : 140) : compact ? 60 : 90;
  const h = isActive ? (compact ? 154 : 196) : compact ? 84 : 126;
  const benchOpacity = isActive ? 1 : 0.8;

  const borderColor = isSelected
    ? '#ff7a18'
    : isValidTarget
    ? '#34c759'
    : isLowHp
    ? 'var(--ki)'
    : `${accent}40`;
  const borderWidth = isSelected || isValidTarget ? '2px' : isLowHp ? '2px' : '1.5px';
  const shadowStyle = isSelected
    ? '0 0 16px rgba(255,122,24,0.7)'
    : isValidTarget
    ? '0 0 12px rgba(52,199,89,0.5)'
    : isLowHp
    ? '0 0 12px rgba(255,122,24,0.4)'
    : isCurrentTurnPlayer && !isOpponent && isActive
    ? `0 0 8px ${accent}60`
    : 'none';

  // Effective stats with equipment bonuses (respect Body Change swap)
  const bonus = equipBonuses(fighter.equipment);
  const swappedAtk = fighter.counters['swappedAtk'];
  const rawAtk = (swappedAtk !== undefined ? swappedAtk : baseAtk) + bonus.atk;
  const displayAtk = effectiveAtk !== undefined ? effectiveAtk : rawAtk;
  const displayDef = effectiveDef !== undefined ? effectiveDef : baseDef + bonus.def;
  const atkColor = (effectiveAtk !== undefined && effectiveAtk !== rawAtk)
    ? 'var(--field)'
    : swappedAtk !== undefined ? '#b44dff' : 'var(--atk)';
  const defColor = 'var(--def)';

  // Equipment cards full-size behind hero, offset so edge is visible
  const peekOffsets = [
    { right: isActive ? -10 : compact ? -6 : -8, bottom: isActive ? -9 : compact ? -5 : -7, rotate: 5 },
    { right: isActive ? -16 : compact ? -10 : -13, bottom: isActive ? -14 : compact ? -8 : -11, rotate: -3 },
  ];

  return (
    <div
      className={shaking ? 'fighter-shake' : undefined}
      style={{
        position: 'relative', width: w, height: h, flexShrink: 0,
        filter: isOpponent && fighter ? 'brightness(0.8) saturate(0.85)' : undefined,
      }}
    >

      {/* Aura ring — shown when fighter has equipment or active counters */}
      {(fighter.equipment.length > 0 || Object.values(fighter.counters).some(v => v > 0)) && (
        <div
          className="aura-ring"
          style={{
            position: 'absolute',
            inset: -4,
            borderRadius: 12,
            zIndex: 0,
            border: `2px solid ${accent}70`,
            boxShadow: `0 0 14px ${accent}80, 0 0 28px ${accent}30`,
            pointerEvents: 'none',
          }}
        />
      )}

      {/* Equipment card peeks — rendered behind the main fighter card */}
      {fighter.equipment.map((eqId, eqIdx) => {
        let eqCard; try { eqCard = getCard(eqId); } catch { eqCard = null; }
        const off = peekOffsets[eqIdx] ?? peekOffsets[0];
        return (
          <div
            key={eqIdx}
            style={{
              position: 'absolute',
              width: w,
              height: h,
              right: off.right,
              bottom: off.bottom,
              transform: `rotate(${off.rotate}deg)`,
              zIndex: eqIdx === 0 ? 0 : -1,
              borderRadius: 3,
              overflow: 'hidden',
              border: '1px solid rgba(255,255,255,0.18)',
              boxShadow: '0 2px 8px rgba(0,0,0,0.7)',
              background: 'var(--panel)',
              pointerEvents: 'none',
            }}
          >
            {eqCard?.image ? (
              <img
                src={`/${eqCard.image}`}
                alt={eqCard.name ?? eqId}
                style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', objectFit: 'cover', display: 'block' }}
              />
            ) : (
              <div style={{
                width: '100%', height: '100%',
                background: 'linear-gradient(135deg, rgba(31,184,196,0.3), rgba(31,184,196,0.1))',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
              }}>
                <span style={{
                  fontSize: compact ? 7 : 9,
                  color: 'var(--item)',
                  fontFamily: 'Bangers, sans-serif',
                }}>
                  {(eqCard?.name ?? eqId).charAt(0).toUpperCase()}
                </span>
              </div>
            )}
          </div>
        );
      })}

      {/* Main fighter card */}
      <div
        onClick={onTap}
        className={isValidTarget ? 'valid-target' : undefined}
        style={{
          position: 'relative',
          zIndex: 1,
          width: w,
          height: h,
          borderRadius: 8,
          border: `${borderWidth} solid ${borderColor}`,
          background: gradient,
          overflow: 'hidden',
          opacity: benchOpacity,
          boxShadow: canAttack ? undefined : shadowStyle,
          animation: canAttack ? 'fighter-pulse 1.8s ease-in-out infinite' : undefined,
          transform: 'none',
          display: 'flex',
          flexDirection: 'column',
          cursor: onTap ? 'pointer' : 'default',
          userSelect: 'none',
          WebkitUserSelect: 'none',
          WebkitTapHighlightColor: 'rgba(255,255,255,0.1)',
        }}
      >
        {/* Low HP glow overlay */}
        {isLowHp && (
          <div style={{
            position: 'absolute',
            inset: 0,
            background: 'radial-gradient(circle at center, rgba(255,122,24,0.1) 0%, transparent 70%)',
            pointerEvents: 'none',
            zIndex: 1,
          }} />
        )}

        {/* Artwork */}
        <div style={{
          flex: 1,
          margin: 0,
          overflow: 'hidden',
          position: 'relative',
          zIndex: 2,
          background: `${accent}18`,
        }}>
          {card?.image ? (
            <img
              src={`/${card.image}`}
              alt={name}
              style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', objectFit: 'cover', objectPosition: 'top center', display: 'block' }}
            />
          ) : (
            <div style={{
              width: '100%', height: '100%',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
            }}>
              <span style={{
                fontFamily: 'Bangers, sans-serif',
                fontSize: isActive ? 24 : 18,
                color: `${accent}60`,
                textTransform: 'uppercase',
                letterSpacing: -1,
                userSelect: 'none',
              }}>
                {name.charAt(0)}
              </span>
            </div>
          )}
        </div>

        {/* HP bar */}
        <div style={{
          height: 4,
          margin: '0 5px 3px',
          borderRadius: 2,
          background: 'rgba(0,0,0,0.4)',
          overflow: 'hidden',
          position: 'relative',
          zIndex: 2,
        }}>
          <div style={{
            width: `${Math.max(0, hpPct * 100)}%`,
            height: '100%',
            background: isLowHp ? '#ff4d4d' : 'var(--hp)',
            borderRadius: 2,
            transition: 'width 0.3s',
          }} />
        </div>

        {/* Stats row (active only, not compact) */}
        {isActive && !compact && (
          <div style={{
            display: 'flex',
            alignItems: 'flex-end',
            justifyContent: 'space-between',
            padding: '2px 5px 4px',
            position: 'relative',
            zIndex: 2,
          }}>
            {/* HP column */}
            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-start', gap: 1 }}>
              <span style={{ fontFamily: 'Saira Condensed, sans-serif', fontSize: 9, color: 'var(--muted)', letterSpacing: 0.8, textTransform: 'uppercase', lineHeight: 1 }}>HP</span>
              <span style={{ fontFamily: 'Saira Condensed, sans-serif', fontSize: 14, color: isLowHp ? '#ff4d4d' : 'var(--hp)', lineHeight: 1, textShadow: '0 1px 3px rgba(0,0,0,0.9)' }}>
                {formatStat(fighter.currentHp)}<span style={{ color: 'var(--muted)', fontSize: 10 }}>/{formatStat(fighter.maxHp)}</span>
              </span>
            </div>
            {/* ATK column */}
            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 1 }}>
              <span style={{ fontFamily: 'Saira Condensed, sans-serif', fontSize: 9, color: 'var(--muted)', letterSpacing: 0.8, textTransform: 'uppercase', lineHeight: 1 }}>ATK</span>
              <div key={displayAtk} className="power-level-flash">
                <span style={{ fontFamily: 'Bangers, sans-serif', fontSize: 19, color: atkColor, letterSpacing: 0.5, textShadow: '0 1px 3px rgba(0,0,0,0.9)' }}>
                  {formatStat(displayAtk)}
                </span>
              </div>
            </div>
            {/* DEF column */}
            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 1 }}>
              <span style={{ fontFamily: 'Saira Condensed, sans-serif', fontSize: 9, color: 'var(--muted)', letterSpacing: 0.8, textTransform: 'uppercase', lineHeight: 1 }}>DEF</span>
              <span style={{ fontFamily: 'Bangers, sans-serif', fontSize: 19, color: defColor, letterSpacing: 0.5, textShadow: '0 1px 3px rgba(0,0,0,0.9)' }}>
                {formatStat(displayDef)}
              </span>
            </div>
          </div>
        )}

        {/* Status badges */}
        <div style={{
          position: 'absolute',
          bottom: isActive ? 28 : 20,
          right: 4,
          display: 'flex',
          flexDirection: 'column',
          gap: 2,
          zIndex: 3,
          transform: 'none',
        }}>
          {fighter.summoningSick && (
            <span style={{
              fontFamily: 'Saira Condensed, sans-serif', fontSize: 7, fontWeight: 700,
              color: '#0d0f14', background: '#ffb648',
              borderRadius: 2, padding: '1px 3px',
              textTransform: 'uppercase', letterSpacing: 0.3,
            }}>SICK</span>
          )}
          {fighter.hasAttackedThisTurn && (
            <span style={{
              fontFamily: 'Saira Condensed, sans-serif', fontSize: 7, fontWeight: 700,
              color: '#0d0f14', background: 'var(--muted)',
              borderRadius: 2, padding: '1px 3px',
              textTransform: 'uppercase', letterSpacing: 0.3,
            }}>ACTED</span>
          )}
          {isStunned && (
            <span style={{
              fontFamily: 'Saira Condensed, sans-serif', fontSize: 7, fontWeight: 700,
              color: '#fff', background: 'var(--atk)',
              borderRadius: 2, padding: '1px 3px',
              textTransform: 'uppercase', letterSpacing: 0.3,
            }}>STUN</span>
          )}
        </div>

        {/* Equipment dots */}
        {fighter.equipment.length > 0 && (
          <div style={{
            position: 'absolute',
            top: 4,
            left: 4,
            display: 'flex',
            gap: 2,
            zIndex: 3,
            transform: 'none',
          }}>
            {fighter.equipment.map((eqId, i) => (
              <div
                key={i}
                title={eqId}
                style={{
                  width: 5, height: 5, borderRadius: '50%',
                  background: 'var(--item)',
                  boxShadow: '0 0 4px var(--item)',
                }}
              />
            ))}
          </div>
        )}

        {/* Dual-type badge (e.g. Majin Vegeta: Majin + Saiyan) */}
        {card?.types && card.types.length > 1 && (
          <div style={{
            position: 'absolute',
            top: 4,
            right: 4,
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'flex-end',
            gap: 1,
            zIndex: 3,
          }}>
            {card.types.map((t) => (
              <span key={t} style={{
                fontFamily: 'Saira Condensed, sans-serif', fontSize: 6, fontWeight: 700,
                color: '#fff', background: `${TYPE_ACCENT[t] ?? accent}cc`,
                borderRadius: 2, padding: '1px 3px',
                textTransform: 'uppercase', letterSpacing: 0.3,
              }}>
                {TYPE_LABEL[t] ?? t}
              </span>
            ))}
          </div>
        )}

        {/* Stacking counter badge (Broly, Cooler, Kid Buu, Super Buu, Assimilate, etc.) */}
        {card && (() => {
          const segments: string[] = [];
          for (const ab of card.abilities) {
            const p = ab.params as any;
            if (ab.kind === 'permanent_counter') {
              const count = fighter.counters[ab.key] ?? 0;
              if (count <= 0) continue;
              if (p.atkPerKo) segments.push(`+${count * p.atkPerKo / 1000}k`);
              if (p.defPerTurn) segments.push(`+${count * p.defPerTurn / 1000}k`);
              if (p.hpPerKo) segments.push(`+${count * p.hpPerKo / 1000}k`);
            } else if (ab.kind === 'triggered_on_ko' && p.onlyOnOwnKo && p.atkPerKo) {
              const count = fighter.counters[ab.key] ?? 0;
              if (count > 0) segments.push(`+${count * p.atkPerKo / 1000}k`);
            }
          }
          for (const itemId of fighter.equipment) {
            const item = getCard(itemId);
            for (const ab of item.abilities) {
              if (ab.kind !== 'attach_trigger') continue;
              const p = ab.params as any;
              if (p.grants !== 'triggered_on_ko' || !p.onlyOnOwnKo || !p.atkPerKo) continue;
              const count = fighter.counters[ab.key] ?? 0;
              if (count > 0) segments.push(`+${count * p.atkPerKo / 1000}k`);
            }
          }
          if (segments.length === 0) return null;
          return (
            <div style={{
              position: 'absolute',
              top: 4,
              left: 4,
              background: 'var(--ki)',
              borderRadius: 8,
              padding: '1px 4px',
              zIndex: 3,
              transform: 'none',
            }}>
              <span style={{
                fontFamily: 'Saira Condensed, sans-serif', fontSize: 7, fontWeight: 700, color: '#0d0f14',
              }}>
                {segments.join('/')}
              </span>
            </div>
          );
        })()}
      </div>

      {/* Floating damage number */}
      {incomingDamage && incomingDamage.amount > 0 && (
        <div key={incomingDamage.seq} className="damage-float" style={{ fontSize: isActive ? 20 : 14 }}>
          -{incomingDamage.amount.toLocaleString()}
        </div>
      )}
    </div>
  );
}
