'use client';

import React from 'react';

interface RulebookModalProps {
  onClose: () => void;
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div style={{ marginBottom: 28 }}>
      <div style={{
        fontFamily: 'Bangers, sans-serif',
        fontSize: 18,
        letterSpacing: 2,
        color: 'var(--ki)',
        textTransform: 'uppercase',
        borderBottom: '1px solid rgba(255,122,24,0.25)',
        paddingBottom: 6,
        marginBottom: 12,
      }}>
        {title}
      </div>
      <div style={{
        fontFamily: 'Saira Condensed, sans-serif',
        fontSize: 13,
        color: 'var(--ink)',
        lineHeight: 1.65,
        display: 'flex',
        flexDirection: 'column',
        gap: 8,
      }}>
        {children}
      </div>
    </div>
  );
}

function Rule({ children }: { children: React.ReactNode }) {
  return (
    <div style={{ display: 'flex', gap: 8, alignItems: 'flex-start' }}>
      <span style={{ color: 'var(--ki)', flexShrink: 0, marginTop: 1 }}>▸</span>
      <span>{children}</span>
    </div>
  );
}

function Pill({ label, color }: { label: string; color: string }) {
  return (
    <span style={{
      display: 'inline-block',
      fontFamily: 'Bangers, sans-serif',
      fontSize: 11,
      letterSpacing: 1,
      color,
      background: `${color}18`,
      border: `1px solid ${color}55`,
      borderRadius: 4,
      padding: '1px 6px',
      verticalAlign: 'middle',
      marginRight: 4,
    }}>
      {label}
    </span>
  );
}

function PhaseRow({ phase, desc }: { phase: string; desc: string }) {
  return (
    <div style={{ display: 'flex', gap: 10, alignItems: 'flex-start' }}>
      <span style={{
        fontFamily: 'Bangers, sans-serif',
        fontSize: 11,
        letterSpacing: 1,
        color: 'var(--ki2)',
        background: 'rgba(255,200,24,0.12)',
        border: '1px solid rgba(255,200,24,0.3)',
        borderRadius: 4,
        padding: '1px 6px',
        flexShrink: 0,
        marginTop: 1,
      }}>
        {phase}
      </span>
      <span>{desc}</span>
    </div>
  );
}

export default function RulebookModal({ onClose }: RulebookModalProps) {
  return (
    <div style={{
      position: 'fixed',
      inset: 0,
      zIndex: 800,
      background: 'rgba(0,0,0,0.88)',
      display: 'flex',
      alignItems: 'flex-start',
      justifyContent: 'center',
      overflowY: 'auto',
      padding: '0 0 32px',
    }}>
      <div style={{
        width: '100%',
        maxWidth: 430,
        background: 'var(--bg)',
        minHeight: '100dvh',
        padding: '0 16px 40px',
        paddingTop: 'max(16px, env(safe-area-inset-top))',
        paddingBottom: 'max(40px, env(safe-area-inset-bottom))',
        position: 'relative',
      }}>

        {/* Header */}
        <div style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          marginBottom: 24,
          paddingTop: 8,
        }}>
          <div>
            <h2 style={{
              fontFamily: 'Bangers, sans-serif',
              fontSize: 32,
              margin: 0,
              letterSpacing: 2,
              background: 'linear-gradient(135deg, var(--ki), var(--ki2))',
              WebkitBackgroundClip: 'text',
              WebkitTextFillColor: 'transparent',
              backgroundClip: 'text',
            }}>
              RULEBOOK
            </h2>
            <p style={{
              fontFamily: 'Saira Condensed, sans-serif',
              fontSize: 10,
              color: 'var(--muted)',
              letterSpacing: 2,
              textTransform: 'uppercase',
              margin: '2px 0 0',
            }}>
              Z-Battle • How to Play
            </p>
          </div>
          <button
            onClick={onClose}
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
            <span style={{ fontFamily: 'Saira, sans-serif', fontSize: 16, color: 'var(--muted)', lineHeight: 1 }}>✕</span>
          </button>
        </div>

        {/* ---- OVERVIEW ---- */}
        <Section title="Overview">
          <Rule>Z-Battle is a 2-player card game where you command a squad of Dragon Ball Z warriors.</Rule>
          <Rule>Deploy fighters, use items, and battle your opponent's team. First to score <strong style={{ color: 'var(--ki)' }}>7 KOs</strong> wins — or wipe out their entire board.</Rule>
        </Section>

        {/* ---- DECKS ---- */}
        <Section title="Decks & Cards">
          <Rule>Each player picks one of seven faction decks: <Pill label="SAIYAN" color="#ff7a18" /><Pill label="NAMEKIAN" color="#34c759" /><Pill label="ANDROID" color="#3aa6ff" /><Pill label="EARTHLING" color="#ffb648" /><Pill label="FRIEZA FORCE" color="#b44dff" /><Pill label="MAJIN" color="#f03fcc" /><Pill label="KAI" color="#7de2e0" /></Rule>
          <Rule>Every deck has three separate face-down piles: <strong>10 Hero cards</strong>, <strong>8 Item cards</strong>, and <strong>2 Field cards</strong>.</Rule>
          <Rule>Cards are never shuffled together — each pile is drawn from independently.</Rule>
        </Section>

        {/* ---- SETUP ---- */}
        <Section title="Setup">
          <Rule>Both players draw an opening hand of <strong>5 hero cards</strong> from their Hero pile. Your hand is guaranteed to contain at least one 1-Ki hero so you can always play on turn 1.</Rule>
          <Rule>The <strong>second player draws one extra card</strong> to offset going second.</Rule>
          <Rule>Each player has <strong>2 active slots</strong> and <strong>2 bench slots</strong> for fighters.</Rule>
          <Rule>Ki starts at <strong>0</strong> for both players. The first player begins their opening turn with <strong>1 Ki</strong>.</Rule>
        </Section>

        {/* ---- KI ---- */}
        <Section title="Ki">
          <Rule>Ki is your resource for playing cards and attacking.</Rule>
          <Rule>At the start of each of your turns, Ki <strong>fully recharges</strong> to your current turn number — Turn 1 = 1 Ki, Turn 2 = 2 Ki, and so on up to a maximum of <strong>8 Ki</strong>.</Rule>
          <Rule>Unspent Ki does <em>not</em> carry over to the next turn.</Rule>
        </Section>

        {/* ---- TURN STRUCTURE ---- */}
        <Section title="Turn Structure">
          <PhaseRow phase="DRAW" desc="Draw 1 card from any non-empty pile (Hero, Item, or Field). The first player skips this on their very first turn." />
          <PhaseRow phase="MAIN 1" desc="Deploy heroes, play items or fields, and use retreat. You must deploy an active hero before anything else if your active row is empty." />
          <PhaseRow phase="BATTLE" desc="Active fighters that are ready can attack or use their ultimate ability." />
          <PhaseRow phase="MAIN 2" desc="Deploy more heroes or play items. No retreating in Main 2." />
          <PhaseRow phase="END" desc="Turn passes to your opponent." />
        </Section>

        {/* ---- HEROES ---- */}
        <Section title="Heroes">
          <Rule>Heroes are deployed from your hand to an active or bench slot by spending their Ki cost.</Rule>
          <Rule>Newly deployed heroes have <strong>Summoning Sickness</strong> and cannot attack until your next turn.</Rule>
          <Rule>During turn 1, you can only deploy to <strong>active slots</strong>.</Rule>
          <Rule>If your active row is <strong>empty</strong> and you can afford a hero from your hand, you must deploy one before playing items, fields, or advancing phases.</Rule>
          <Rule>Each fighter can hold up to <strong>2 equipment items</strong>.</Rule>
        </Section>

        {/* ---- COMBAT ---- */}
        <Section title="Combat">
          <Rule>Only <strong>active fighters</strong> can attack. Each fighter can attack once per turn.</Rule>
          <Rule><strong>Damage = Attacker's ATK − Defender's DEF</strong> (minimum 500 damage per hit).</Rule>
          <Rule><strong>Pure Damage</strong> (from certain items and ultimates) is dealt straight to HP, completely ignoring DEF.</Rule>
          <Rule>When a fighter's HP reaches 0 it is KO'd, removed from the board, and the attacker's player scores 1 KO.</Rule>
          <Rule>If your active fighter is KO'd and you have bench fighters, you must <strong>promote</strong> one to the active slot immediately.</Rule>
          <Rule>Some attacks cost extra Ki — check each fighter's card for their attack Ki cost.</Rule>
        </Section>

        {/* ---- SPECIAL ACTIONS ---- */}
        <Section title="Special Actions">
          <Rule><strong>Retreat</strong> — Once per turn in Main Phase 1, swap an active fighter with a bench fighter for <strong>1 Ki</strong>. The retreated fighter goes to the bench; the promoted fighter enters with Summoning Sickness removed.</Rule>
          <Rule><strong>Sacrifice</strong> — Remove one of your own fighters from the board at any time during a Main Phase for free. Useful for freeing slots or denying the opponent a KO.</Rule>
          <Rule><strong>Ultimates</strong> — Powerful once-per-game abilities usable during Battle Phase for <strong>1 Ki</strong>. Each fighter has a unique ultimate.</Rule>
        </Section>

        {/* ---- ITEMS & FIELDS ---- */}
        <Section title="Items & Fields">
          <Rule><strong>Consumable items</strong> are played once and discarded: heals, direct damage, draw effects, and more.</Rule>
          <Rule><strong>Equipment items</strong> attach permanently to a fighter, granting stat bonuses or special properties. Max 2 per fighter.</Rule>
          <Rule><strong>Field cards</strong> change the battlefield environment, benefiting your team. Cost <strong>1 Ki</strong>. Only one field is active at a time — playing a new one replaces it.</Rule>
        </Section>

        {/* ---- WIN CONDITIONS ---- */}
        <Section title="Winning">
          <Rule>Score <strong>7 KOs</strong> to win.</Rule>
          <Rule>You also win instantly if your opponent's entire board (all active and bench slots) is empty at any point.</Rule>
        </Section>

      </div>
    </div>
  );
}
