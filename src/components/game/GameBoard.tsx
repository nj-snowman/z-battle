'use client';

import React, { useState, useEffect, useRef, useMemo } from 'react';
import Image from 'next/image';
import type { GameState, Intent, PlayerId } from '@/lib/engine/types';
import { legalMoves } from '@/lib/engine';
import { getCard } from '@/lib/engine/cards';
import { getEffectiveStats } from '@/lib/engine/buffs';
import FighterSlot from './FighterSlot';
import KiDisplay from './KiDisplay';
import KoScore from './KoScore';
import FieldSlot from './FieldSlot';
import PileDisplay from './PileDisplay';
import HandCard from './HandCard';
import AttackChoiceModal, { type AttackChoice } from './AttackChoiceModal';
import CardZoomOverlay from './CardZoomOverlay';
import DragonBallKi from './DragonBallKi';

interface GameBoardProps {
  state: GameState;
  onIntent: (intent: Intent) => void;
  onTurnEnd: () => void;
  perspective?: PlayerId;
  pendingEnemyAttack?: Intent | null;
  onEnemyAttackDone?: (intent: Intent) => void;
  pendingEnemyPlay?: Intent | null;
  onEnemyPlayDone?: (intent: Intent) => void;
}

type SelectionMode =
  | { mode: 'idle' }
  | { mode: 'hand_card_selected'; handIdx: number; cardId: string }
  | { mode: 'attacker_selected'; attackerIdx: number }
  | { mode: 'retreat_select'; activeIndex: number }
  | { mode: 'ultimate_target_select'; fighterIndex: number }
  | { mode: 'chiaotzu_stun_select'; handIdx: number; cardId: string; slot: 'active' | 'bench'; index: number }
  | { mode: 'self_destruct_enemy_select'; handIdx: number; cardId: string; sacrificeSide: 'active' | 'bench'; sacrificeIndex: number }
  | { mode: 'self_destruct_bench_select'; handIdx: number; cardId: string; sacrificeSide: 'active' | 'bench'; sacrificeIndex: number; enemyTargetIndex: number }
  | { mode: 'manipulation_select_a'; fighterIndex: number }
  | { mode: 'manipulation_select_b'; fighterIndex: number; targetIndexA: number };

interface PendingAttack {
  attackerIndex: number;
  targetIndex: number;
  attackerName: string;
  attackerCardId: string;
  attackerHp: number;
  kiAvailable: number;
}

// ---- Drag types ----
type DragInfo = {
  cardId: string;
  handIdx: number;
  startX: number;
  startY: number;
  x: number;
  y: number;
  active: boolean;
};

type DropTarget =
  | { kind: 'fighter'; slot: 'active' | 'bench'; index: number; isOpp: boolean }
  | { kind: 'field' }
  | { kind: 'notarget' };

function getDropTarget(x: number, y: number): DropTarget | null {
  let el = document.elementFromPoint(x, y) as Element | null;
  while (el && el !== document.body) {
    const ds = el.getAttribute('data-slot');
    if (ds === 'fighter') {
      return {
        kind: 'fighter',
        slot: (el.getAttribute('data-subslot') as 'active' | 'bench') ?? 'active',
        index: parseInt(el.getAttribute('data-index') ?? '0', 10),
        isOpp: el.getAttribute('data-opp') === 'true',
      };
    }
    if (ds === 'field') return { kind: 'field' };
    if (ds === 'notarget') return { kind: 'notarget' };
    el = el.parentElement;
  }
  return null;
}

// ---- Sub-components ----

function OpponentStatusBar({ state, oppId, myId }: { state: GameState; oppId: PlayerId; myId: PlayerId }) {
  const opp = state.players[oppId];
  const kosScored = state.players[myId].koScoredAgainst;
  return (
    <div style={{
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'space-between',
      padding: '6px 12px',
      background: 'rgba(22,26,34,0.92)',
      borderBottom: '1px solid var(--line)',
      minHeight: 40,
      flexShrink: 0,
    }}>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
        <span style={{ fontFamily: 'Bangers, sans-serif', fontSize: 12, color: 'var(--ink)', letterSpacing: 0.5 }}>
          {oppId === 'p1' ? 'PLAYER 1' : 'PLAYER 2'}
        </span>
        <span style={{ fontFamily: 'Saira Condensed, sans-serif', fontSize: 9, color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: 1 }}>
          {opp.deck} DECK
        </span>
      </div>
      <KiDisplay kiCurrent={opp.kiCurrent} kiMax={opp.kiMax} size={18} />
      <KoScore scored={kosScored} />
    </div>
  );
}

function PlayerStatusBar({ state, myId, oppId }: { state: GameState; myId: PlayerId; oppId: PlayerId }) {
  const me = state.players[myId];
  const kosScored = state.players[oppId].koScoredAgainst;
  return (
    <div style={{
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'space-between',
      padding: '6px 12px',
      background: 'rgba(22,26,34,0.92)',
      borderTop: '1px solid var(--line)',
      minHeight: 40,
      flexShrink: 0,
    }}>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
        <span style={{ fontFamily: 'Bangers, sans-serif', fontSize: 12, color: 'var(--ki)', letterSpacing: 0.5 }}>
          {myId === 'p1' ? 'PLAYER 1' : 'PLAYER 2'}
        </span>
        <span style={{ fontFamily: 'Saira Condensed, sans-serif', fontSize: 9, color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: 1 }}>
          {me.deck} DECK
        </span>
      </div>
      <KiDisplay kiCurrent={me.kiCurrent} kiMax={me.kiMax} size={18} />
      <KoScore scored={kosScored} />
    </div>
  );
}

// ---- Main GameBoard ----

export default function GameBoard({ state, onIntent, onTurnEnd, perspective, pendingEnemyAttack, onEnemyAttackDone, pendingEnemyPlay, onEnemyPlayDone }: GameBoardProps) {
  const [selection, setSelection] = useState<SelectionMode>({ mode: 'idle' });
  const [pendingAttack, setPendingAttack] = useState<PendingAttack | null>(null);
  const [phaseButtonPressed, setPhaseButtonPressed] = useState(false);
  const [isCompact, setIsCompact] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [zoomedCard, setZoomedCard] = useState<{
    cardId: string;
    fighter?: import('@/lib/engine/types').FighterInstance;
    handIdx?: number;
    fighterSide?: 'active' | 'bench';
    fighterIndex?: number;
    isOpponentFighter?: boolean;
  } | null>(null);

  // Drag state
  const [drag, setDrag] = useState<DragInfo | null>(null);
  const dragRef = useRef<DragInfo | null>(null);
  const dispatchDropRef = useRef<(d: DragInfo, t: DropTarget) => boolean>(() => false);

  // Scouter: pile choice + opponent hand reveal
  const [pileSelectForCard, setPileSelectForCard] = useState<string | null>(null);
  const [revealedOppHand, setRevealedOppHand] = useState<string[] | null>(null);
  // Dragon Clan Ritual: discard card choice
  const [discardSelectForCard, setDiscardSelectForCard] = useState<string | null>(null);
  // Bibidi's Creation: which friendly fighter is using the ultimate, awaiting a discard-pile pick
  const [creationSelectForFighter, setCreationSelectForFighter] = useState<number | null>(null);
  // Capsule Corp: multi-draw pile selection
  const [multiDrawSelect, setMultiDrawSelect] = useState<{
    cardId: string;
    totalDraws: number;
    picks: Array<'hero' | 'item'>;
  } | null>(null);

  // PTCGP effect state
  const [turnBanner, setTurnBanner] = useState(false);
  const [phaseToast, setPhaseToast] = useState<string | null>(null);
  const [shakingSlots, setShakingSlots] = useState<Set<string>>(new Set());
  const [koFlashSlots, setKoFlashSlots] = useState<Set<string>>(new Set());
  const [damageSlots, setDamageSlots] = useState<Map<string, { amount: number; seq: number }>>(new Map());
  const dmgSeqRef = useRef(0);
  // DBZ UI features
  const [kiAnimating, setKiAnimating] = useState(false);
  const [beamClash, setBeamClash] = useState(false);

  // Victory finale: hold on the battlefield (board shake, KO flash, narration)
  // before revealing the win/loss overlay, instead of cutting to it instantly.
  const [boardShake, setBoardShake] = useState(false);
  const [winnerRevealed, setWinnerRevealed] = useState(false);
  const winnerRevealTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Item/field/hero play animation
  type ItemPlayAnim = {
    cardId: string;
    exitDx: number | null;
    exitDy: number | null;
    exitType: 'fly' | 'fade';
    exitScale?: number; // default 0.3
  };
  const [itemPlayAnim, setItemPlayAnim] = useState<ItemPlayAnim | null>(null);
  const [itemAnimPhase, setItemAnimPhase] = useState<'show' | 'exit'>('show');
  const itemAnimTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pendingCardDispatch = useRef<(() => void) | null>(null);
  const cardAnimLock = useRef(false);

  // Long-press hold: scale card 1.5× instead of native iOS callout
  const [heldCardOrigIdx, setHeldCardOrigIdx] = useState<number | null>(null);
  const holdTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  type RetreatAnim = {
    activeCardId: string;
    benchCardId: string | null;
    activePos: { x: number; y: number };
    benchPos: { x: number; y: number };
    activeW: number; activeH: number;
    benchW: number; benchH: number;
  };
  const [retreatAnim, setRetreatAnim] = useState<RetreatAnim | null>(null);
  const [retreatAnimFlying, setRetreatAnimFlying] = useState(false);
  const retreatAnimTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  type PromoteAnim = {
    cardId: string;
    fromX: number; fromY: number;
    toX: number; toY: number;
    w: number; h: number;
  };
  const [promoteAnim, setPromoteAnim] = useState<PromoteAnim | null>(null);
  const [promoteAnimFlying, setPromoteAnimFlying] = useState(false);
  const promoteAnimTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  type BeamStruggleData = {
    attackerPos: { x: number; y: number };
    defenderPos: { x: number; y: number };
    attackerColor: string;
    defenderColor: string;
    isUltimate?: boolean;
  };
  const [beamStruggle, setBeamStruggle] = useState<BeamStruggleData | null>(null);
  const beamTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  type ChainBeamData = {
    startPos: { x: number; y: number };
    endPos: { x: number; y: number };
    color: string;
  };
  const [chainBeam, setChainBeam] = useState<ChainBeamData | null>(null);
  const chainBeamTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const stateRef = useRef(state);
  useEffect(() => { stateRef.current = state; }, [state]);
  const boardRef = useRef<HTMLDivElement>(null);

  // Field background crossfade
  const [leavingFieldImage, setLeavingFieldImage] = useState<string | null>(null);
  const [leavingFieldFading, setLeavingFieldFading] = useState(false);
  const prevFieldImageRef = useRef<string | null>(null);
  const fieldLeaveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [narration, setNarration] = useState<string | null>(null);
  const handContainerRef = useRef<HTMLDivElement>(null);
  const [handContainerW, setHandContainerW] = useState(390);
  const prevStateSnap = useRef<{
    hp: Record<string, number>;
    occupied: Record<string, boolean>;
    turn: PlayerId;
    phase: string;
    friezaWrathSides: Set<string>;
    winner: PlayerId | null;
  } | null>(null);

  // Reset selection when state changes
  useEffect(() => {
    setSelection({ mode: 'idle' });
  }, [state]);

  // When our turn starts, clear any stale animation lock left over from the previous turn.
  // The lock can stay true if the auto-end-turn fires while a card animation is still running
  // (the animation's cleanup timer hasn't fired yet when the turn switches).
  useEffect(() => {
    if (state.turnPlayer !== perspectiveId) return;
    cardAnimLock.current = false;
    pendingCardDispatch.current = null;
    if (itemAnimTimerRef.current) { clearTimeout(itemAnimTimerRef.current); itemAnimTimerRef.current = null; }
    setItemPlayAnim(null);
    setItemAnimPhase('show');
  }, [state.turnPlayer]); // eslint-disable-line react-hooks/exhaustive-deps

  // Field background crossfade — when state.field changes, fade out the old image
  useEffect(() => {
    const currentImage = (() => {
      if (!state.field) return null;
      try { return getCard(state.field)?.image ?? null; } catch { return null; }
    })();
    const prev = prevFieldImageRef.current;
    prevFieldImageRef.current = currentImage;
    if (!prev || prev === currentImage) return;
    // Old field image is being replaced — fade it out
    setLeavingFieldImage(prev);
    setLeavingFieldFading(false);
    requestAnimationFrame(() => requestAnimationFrame(() => setLeavingFieldFading(true)));
    if (fieldLeaveTimerRef.current) clearTimeout(fieldLeaveTimerRef.current);
    fieldLeaveTimerRef.current = setTimeout(() => setLeavingFieldImage(null), 700);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.field]);

  // Track hand container width for dynamic card overlap
  useEffect(() => {
    const el = handContainerRef.current;
    if (!el) return;
    const update = () => setHandContainerW(el.clientWidth);
    update();
    const ro = new ResizeObserver(update);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // Compact mode for narrow screens
  useEffect(() => {
    function check() { setIsCompact(window.innerWidth < 360); }
    check();
    window.addEventListener('resize', check);
    return () => window.removeEventListener('resize', check);
  }, []);

  const tp = state.turnPlayer;
  const perspectiveId: PlayerId = perspective ?? tp;
  const myPlayer = state.players[perspectiveId];
  const oppId: PlayerId = perspectiveId === 'p1' ? 'p2' : 'p1';
  const oppPlayer = state.players[oppId];
  const isMyTurn = tp === perspectiveId;
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const moves = useMemo(() => isMyTurn ? legalMoves(state, tp) : [], [state, isMyTurn]);

  // Detect HP changes, KOs, turn switches, and phase changes for PTCGP effects
  useEffect(() => {
    const snap = prevStateSnap.current;
    const newSnap = {
      hp: {} as Record<string, number>,
      occupied: {} as Record<string, boolean>,
      turn: state.turnPlayer,
      phase: state.phase,
      friezaWrathSides: new Set(state.pendingPromotions.filter(p => p.friezaWrathPending).map(p => p.side)),
      winner: state.winner,
    };
    const fill = (slots: Array<{ currentHp: number } | null>, pId: string, side: string) => {
      slots.forEach((f, i) => {
        const k = `${pId}-${side}-${i}`;
        newSnap.hp[k] = f?.currentHp ?? 0;
        newSnap.occupied[k] = f !== null;
      });
    };
    fill(state.players.p1.actives as Array<{ currentHp: number } | null>, 'p1', 'active');
    fill(state.players.p1.bench as Array<{ currentHp: number } | null>, 'p1', 'bench');
    fill(state.players.p2.actives as Array<{ currentHp: number } | null>, 'p2', 'active');
    fill(state.players.p2.bench as Array<{ currentHp: number } | null>, 'p2', 'bench');

    if (snap) {
      const dmgUpdates = new Map<string, { amount: number; seq: number }>();
      const newShake = new Set<string>();
      const newKo = new Set<string>();
      const check = (slots: Array<{ currentHp: number; maxHp: number } | null>, pId: string, side: string) => {
        slots.forEach((f, i) => {
          const k = `${pId}-${side}-${i}`;
          if (f) {
            if (snap.occupied[k] && f.currentHp < (snap.hp[k] ?? f.currentHp)) {
              dmgUpdates.set(k, { amount: (snap.hp[k] ?? 0) - f.currentHp, seq: ++dmgSeqRef.current });
              newShake.add(k);
            } else if (!snap.occupied[k] && side === 'active' && snap.friezaWrathSides.has(pId) && f.currentHp < f.maxHp) {
              // Fighter just promoted in but took Frieza's Emperor's Wrath damage on entry
              dmgUpdates.set(k, { amount: f.maxHp - f.currentHp, seq: ++dmgSeqRef.current });
              newShake.add(k);
            }
          } else if (snap.occupied[k] && side === 'active') {
            // Only active slots trigger KO flash — bench disappearing is promotion/sacrifice, not a KO
            newKo.add(k);
          }
        });
      };
      check(state.players.p1.actives as Array<{ currentHp: number; maxHp: number } | null>, 'p1', 'active');
      check(state.players.p1.bench as Array<{ currentHp: number; maxHp: number } | null>, 'p1', 'bench');
      check(state.players.p2.actives as Array<{ currentHp: number; maxHp: number } | null>, 'p2', 'active');
      check(state.players.p2.bench as Array<{ currentHp: number; maxHp: number } | null>, 'p2', 'bench');
      if (dmgUpdates.size > 0) {
        setDamageSlots(prev => new Map([...prev, ...dmgUpdates]));
        setTimeout(() => setDamageSlots(prev => { const n = new Map(prev); dmgUpdates.forEach((_, k) => n.delete(k)); return n; }), 1200);
        // Beam clash when an active fighter is hit
        if ([...dmgUpdates.keys()].some(k => k.includes('-active-'))) {
          setBeamClash(true);
          setTimeout(() => setBeamClash(false), 600);
        }
        // Frieza's Emperor's Wrath narration — fires when a promoted fighter takes entry damage
        const wrathKeys = [...dmgUpdates.keys()].filter(k => {
          const [pId, side] = k.split('-');
          return side === 'active' && snap.friezaWrathSides.has(pId);
        });
        if (wrathKeys.length > 0) {
          setNarration("EMPEROR'S WRATH!");
          setTimeout(() => setNarration(null), 2500);
        }
      }
      if (newShake.size > 0) {
        setShakingSlots(prev => new Set([...prev, ...newShake]));
        setTimeout(() => setShakingSlots(prev => { const n = new Set(prev); newShake.forEach(k => n.delete(k)); return n; }), 500);
      }
      if (newKo.size > 0) {
        setKoFlashSlots(prev => new Set([...prev, ...newKo]));
        setTimeout(() => setKoFlashSlots(prev => { const n = new Set(prev); newKo.forEach(k => n.delete(k)); return n; }), 700);
        // Narration pill on KO
        const phrases = ["INCREDIBLE POWER!", "THEY'VE BEEN ELIMINATED!", "WHAT POWER LEVEL!", "IT'S OVER!", "UNBELIEVABLE STRENGTH!"];
        const phrase = phrases[Math.floor(Math.random() * phrases.length)];
        setNarration(phrase);
        setTimeout(() => setNarration(null), 2500);
      }
      // Game just ended — hold on the battlefield (shake + KO flash + narration already
      // queued above) before revealing the win/loss overlay, instead of cutting instantly.
      if (!snap.winner && state.winner) {
        setBoardShake(true);
        setTimeout(() => setBoardShake(false), 700);
        if (winnerRevealTimerRef.current) clearTimeout(winnerRevealTimerRef.current);
        winnerRevealTimerRef.current = setTimeout(() => setWinnerRevealed(true), 900);
      }
      if (snap.phase !== state.phase) {
        const phaseLabels: Record<string, string> = { main1: 'MAIN PHASE', battle: 'BATTLE PHASE', main2: 'MAIN PHASE 2', draw: 'DRAW PHASE' };
        const label = phaseLabels[state.phase];
        if (label) { setPhaseToast(label); setTimeout(() => setPhaseToast(null), 1800); }
      }
      if (snap.turn !== state.turnPlayer && state.turnPlayer === perspectiveId) {
        setTurnBanner(true);
        setTimeout(() => setTurnBanner(false), 2200);
        setKiAnimating(true);
        setTimeout(() => setKiAnimating(false), 700);
      }
    }
    prevStateSnap.current = newSnap;
  }, [state, perspectiveId]); // eslint-disable-line react-hooks/exhaustive-deps

  function showError(msg: string) {
    setErrorMsg(msg);
    setTimeout(() => setErrorMsg(null), 2500);
  }

  function safeIntent(intent: Intent) {
    function dispatch() {
      try { onIntent(intent); } catch (e: unknown) {
        showError(e instanceof Error ? e.message : 'Illegal move');
      }
    }
    if (intent.type === 'play_hero') { startHeroPlayAnim(intent, dispatch); return; }
    if (intent.type === 'play_item') {
      const c = (() => { try { return getCard(intent.cardId); } catch { return null; } })();
      if (c?.abilities[0]?.kind === 'recur_from_discard') {
        setDiscardSelectForCard(intent.cardId);
        return;
      }
      startItemPlayAnim(intent, dispatch); return;
    }
    if (intent.type === 'play_field') { startItemPlayAnim(intent, dispatch); return; }
    if (intent.type === 'ultimate') {
      const fighter = myPlayer.actives[intent.fighterIndex];
      if (fighter) { startUltimateAnim(intent, fighter.cardId, dispatch); return; }
    }
    if (intent.type === 'retreat') { startRetreatAnim(intent, dispatch); return; }
    dispatch();
  }

  const BEAM_COLORS: Record<string, string> = {
    earthling: '#3aa6ff',
    saiyan: '#c084fc',
    android: '#22c55e',
    namekian: '#6d28d9',
    frieza_force: '#ff4fa3',
    majin: '#f03fcc',
  };

  function beamColorFor(card: ReturnType<typeof getCard> | null): string {
    if (!card) return '#ff7a18';
    // Dual-type (Majin Vegeta): use the Saiyan beam rather than the Majin one
    if (card.types?.includes('saiyan')) return BEAM_COLORS.saiyan;
    return BEAM_COLORS[card.fighterType ?? ''] ?? '#ff7a18';
  }

  function dispatchAttackWithBeam(intent: Intent) {
    setSelection({ mode: 'idle' });
    setPendingAttack(null);
    if (beamTimerRef.current) clearTimeout(beamTimerRef.current);

    // Try to read card positions from DOM
    const board = boardRef.current;
    let beamData: BeamStruggleData | null = null;
    if (board && intent.type === 'attack') {
      const boardRect = board.getBoundingClientRect();
      const aEl = board.querySelector(`[data-subslot="active"][data-index="${intent.attackerIndex}"][data-opp="false"]`);
      const dEl = board.querySelector(`[data-subslot="active"][data-index="${intent.targetIndex}"][data-opp="true"]`);
      if (aEl && dEl) {
        const aR = aEl.getBoundingClientRect();
        const dR = dEl.getBoundingClientRect();
        const attackerFighter = myPlayer.actives[intent.attackerIndex];
        const defenderFighter = oppPlayer.actives[intent.targetIndex];
        let attackerCard; try { attackerCard = attackerFighter ? getCard(attackerFighter.cardId) : null; } catch { attackerCard = null; }
        let defenderCard; try { defenderCard = defenderFighter ? getCard(defenderFighter.cardId) : null; } catch { defenderCard = null; }
        beamData = {
          attackerPos: { x: aR.left + aR.width / 2 - boardRect.left, y: aR.top + aR.height / 2 - boardRect.top },
          defenderPos: { x: dR.left + dR.width / 2 - boardRect.left, y: dR.top + dR.height / 2 - boardRect.top },
          attackerColor: beamColorFor(attackerCard),
          defenderColor: beamColorFor(defenderCard),
        };
      }
    }
    setBeamStruggle(beamData);

    beamTimerRef.current = setTimeout(() => {
      setBeamStruggle(null);
      if (!stateRef.current.winner) safeIntent(intent);
    }, 1500);
  }

  // ---- Enemy attack beam (AI attacking the player) ----
  useEffect(() => {
    if (!pendingEnemyAttack || pendingEnemyAttack.type !== 'attack') return;
    const intent = pendingEnemyAttack;
    const board = boardRef.current;
    if (!board) { onEnemyAttackDone?.(intent); return; }
    if (beamTimerRef.current) clearTimeout(beamTimerRef.current);

    const boardRect = board.getBoundingClientRect();
    const aEl = board.querySelector(`[data-subslot="active"][data-index="${intent.attackerIndex}"][data-opp="true"]`);
    const dEl = board.querySelector(`[data-subslot="active"][data-index="${intent.targetIndex}"][data-opp="false"]`);

    let beamData: BeamStruggleData | null = null;
    if (aEl && dEl) {
      const aR = aEl.getBoundingClientRect();
      const dR = dEl.getBoundingClientRect();
      const attackerFighter = oppPlayer.actives[intent.attackerIndex];
      const defenderFighter = myPlayer.actives[intent.targetIndex];
      let attackerCard: ReturnType<typeof getCard> | null = null;
      let defenderCard: ReturnType<typeof getCard> | null = null;
      try { attackerCard = attackerFighter ? getCard(attackerFighter.cardId) : null; } catch { attackerCard = null; }
      try { defenderCard = defenderFighter ? getCard(defenderFighter.cardId) : null; } catch { defenderCard = null; }
      beamData = {
        attackerPos: { x: aR.left + aR.width / 2 - boardRect.left, y: aR.top + aR.height / 2 - boardRect.top },
        defenderPos: { x: dR.left + dR.width / 2 - boardRect.left, y: dR.top + dR.height / 2 - boardRect.top },
        attackerColor: beamColorFor(attackerCard),
        defenderColor: beamColorFor(defenderCard),
      };
    }

    setBeamStruggle(beamData);
    beamTimerRef.current = setTimeout(() => {
      setBeamStruggle(null);
      if (!stateRef.current.winner) onEnemyAttackDone?.(intent);
    }, 1500);

    return () => { if (beamTimerRef.current) clearTimeout(beamTimerRef.current); };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pendingEnemyAttack]);

  useEffect(() => {
    return () => { if (chainBeamTimerRef.current) clearTimeout(chainBeamTimerRef.current); };
  }, []);

  // ---- Enemy item/field play animation (AI plays a card) ----
  useEffect(() => {
    if (!pendingEnemyPlay || (pendingEnemyPlay.type !== 'play_item' && pendingEnemyPlay.type !== 'play_field')) return;
    const intent = pendingEnemyPlay as Extract<Intent, { type: 'play_item' }> | Extract<Intent, { type: 'play_field' }>;
    startItemPlayAnim(intent, () => onEnemyPlayDone?.(intent), true);
    return () => { if (itemAnimTimerRef.current) clearTimeout(itemAnimTimerRef.current); };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pendingEnemyPlay]);

  // Auto-advance draw phase when all piles are exhausted
  useEffect(() => {
    if (!isMyTurn || state.phase !== 'draw') return;
    const allEmpty = (['hero', 'item'] as const).every(p => myPlayer.piles[p].length === 0);
    if (!allEmpty) return;
    const isFirstPlayerTurn1 =
      state.players[tp].turnNumber === 1 && tp === state.firstPlayer;
    if (isFirstPlayerTurn1) return;
    onIntent({ type: 'advance_phase' });
  }, [state, isMyTurn]); // eslint-disable-line react-hooks/exhaustive-deps

  // Auto-end turn when Ki hits 0 and no free moves remain
  useEffect(() => {
    if (!isMyTurn) return;
    if (state.phase !== 'main1' && state.phase !== 'main2' && state.phase !== 'battle') return;
    if (myPlayer.kiCurrent > 0) return;
    // Still allow play if there are affordable (0-Ki) non-trivial moves — e.g. 0-Ki cards or
    // Android #17's free attacks. Sacrifice is intentionally excluded so it doesn't block the skip.
    const freeMoves = moves.filter(m =>
      m.type !== 'advance_phase' && m.type !== 'end_turn' && m.type !== 'sacrifice'
    );
    if (freeMoves.length > 0) return;
    // Don't auto-end while any bench promotion is pending (own side or opponent's)
    if (state.pendingPromotions.length > 0) return;
    // In main1, if a fighter can attack for free (e.g. Android #17, 0-Ki cost) advance to
    // battle instead of ending the turn so the player gets to use those attacks.
    if (state.phase === 'main1' && moves.some(m => m.type === 'advance_phase')) {
      const hasFreeAttacker = myPlayer.actives.some((f, i) => {
        if (!f || f.summoningSick || f.hasAttackedThisTurn || f.statuses.some(s => s.key === 'stun')) return false;
        return getEffectiveStats(f, 'active', i, perspectiveId, state).attackKiCost === 0;
      });
      if (hasFreeAttacker) {
        onIntent({ type: 'advance_phase' });
        return;
      }
    }
    setNarration('OUT OF KI!');
    const t = setTimeout(() => {
      setNarration(null);
      onIntent({ type: 'end_turn' });
    }, 900);
    return () => clearTimeout(t);
  }, [state, isMyTurn]); // eslint-disable-line react-hooks/exhaustive-deps

  // ---- Item / field card play animation ----
  function flushPendingCardDispatch() {
    if (pendingCardDispatch.current) {
      pendingCardDispatch.current();
      pendingCardDispatch.current = null;
    }
    if (itemAnimTimerRef.current) clearTimeout(itemAnimTimerRef.current);
    setItemPlayAnim(null);
    setItemAnimPhase('show');
    cardAnimLock.current = false;
  }

  function startHeroPlayAnim(intent: Extract<Intent, { type: 'play_hero' }>, onDispatch: () => void) {
    flushPendingCardDispatch();
    const board = boardRef.current;
    if (!board) { onDispatch(); return; }
    const boardRect = board.getBoundingClientRect();
    const centerX = boardRect.width / 2;
    const centerY = boardRect.height / 2;

    let exitDx: number | null = null;
    let exitDy: number | null = null;
    const el = board.querySelector(`[data-subslot="${intent.slot}"][data-index="${intent.index}"][data-opp="false"]`);
    if (el) {
      const r = el.getBoundingClientRect();
      exitDx = (r.left + r.width / 2 - boardRect.left) - centerX;
      exitDy = (r.top + r.height / 2 - boardRect.top) - centerY;
    }

    cardAnimLock.current = true;
    pendingCardDispatch.current = onDispatch;
    setItemPlayAnim({ cardId: intent.cardId, exitDx, exitDy, exitType: 'fly', exitScale: 0.6 });
    setItemAnimPhase('show');
    itemAnimTimerRef.current = setTimeout(() => {
      setItemAnimPhase('exit');
      // Guard: only dispatch if it's still our turn (auto-end-turn may have already switched the turn)
      if (stateRef.current.turnPlayer === perspectiveId) pendingCardDispatch.current?.();
      pendingCardDispatch.current = null;
      itemAnimTimerRef.current = setTimeout(() => {
        setItemPlayAnim(null);
        setItemAnimPhase('show');
        cardAnimLock.current = false;
      }, 550);
    }, 1500);
  }

  function startItemPlayAnim(intent: Extract<Intent, { type: 'play_item' }> | Extract<Intent, { type: 'play_field' }>, onDispatch: () => void, isEnemyPlay = false) {
    flushPendingCardDispatch();
    const board = boardRef.current;
    if (!board) { onDispatch(); return; }
    const boardRect = board.getBoundingClientRect();
    const centerX = boardRect.width / 2;
    const centerY = boardRect.height / 2;

    let exitType: 'fly' | 'fade' = 'fade';
    let exitDx: number | null = null;
    let exitDy: number | null = null;

    const toPos = (el: Element | null) => {
      if (!el) return null;
      const r = el.getBoundingClientRect();
      return {
        dx: (r.left + r.width / 2 - boardRect.left) - centerX,
        dy: (r.top + r.height / 2 - boardRect.top) - centerY,
      };
    };

    if (intent.type === 'play_field') {
      const pos = toPos(board.querySelector('[data-slot="field"]'));
      if (pos) { exitDx = pos.dx; exitDy = pos.dy; exitType = 'fly'; }
    } else if (intent.targetSide !== undefined && intent.targetIndex !== undefined) {
      // targetSide present = equipment targeting own fighter; for enemy plays "own" is opp from viewer's perspective
      const oppFlag = isEnemyPlay ? 'true' : 'false';
      const pos = toPos(board.querySelector(`[data-subslot="${intent.targetSide}"][data-index="${intent.targetIndex}"][data-opp="${oppFlag}"]`));
      if (pos) { exitDx = pos.dx; exitDy = pos.dy; exitType = 'fly'; }
    } else if (intent.targetIndex !== undefined) {
      // no targetSide = consumable targeting enemy active; for enemy plays "enemy" is the player (opp=false)
      const oppFlag = isEnemyPlay ? 'false' : 'true';
      const pos = toPos(board.querySelector(`[data-subslot="active"][data-index="${intent.targetIndex}"][data-opp="${oppFlag}"]`));
      if (pos) { exitDx = pos.dx; exitDy = pos.dy; exitType = 'fly'; }
    }

    cardAnimLock.current = true;
    pendingCardDispatch.current = onDispatch;
    setItemPlayAnim({ cardId: intent.cardId, exitDx, exitDy, exitType });
    setItemAnimPhase('show');
    itemAnimTimerRef.current = setTimeout(() => {
      setItemAnimPhase('exit');
      // For enemy plays always dispatch; for own plays guard against stale turn (auto-end-turn race)
      if (isEnemyPlay || stateRef.current.turnPlayer === perspectiveId) pendingCardDispatch.current?.();
      pendingCardDispatch.current = null;
      itemAnimTimerRef.current = setTimeout(() => {
        setItemPlayAnim(null);
        setItemAnimPhase('show');
        cardAnimLock.current = false;
      }, 600);
    }, 1500);
  }

  function startUltimateAnim(intent: Extract<Intent, { type: 'ultimate' }>, cardId: string, onDispatch: () => void) {
    flushPendingCardDispatch();
    const board = boardRef.current;
    if (!board) { onDispatch(); return; }
    const boardRect = board.getBoundingClientRect();
    const centerX = boardRect.width / 2;
    const centerY = boardRect.height / 2;

    let exitDx: number | null = null;
    let exitDy: number | null = null;
    const el = board.querySelector(`[data-subslot="active"][data-index="${intent.fighterIndex}"][data-opp="false"]`);
    if (el) {
      const r = el.getBoundingClientRect();
      exitDx = (r.left + r.width / 2 - boardRect.left) - centerX;
      exitDy = (r.top + r.height / 2 - boardRect.top) - centerY;
    }

    cardAnimLock.current = true;
    pendingCardDispatch.current = onDispatch;
    setItemPlayAnim({ cardId, exitDx, exitDy, exitType: 'fly', exitScale: 0.6 });
    setItemAnimPhase('show');

    itemAnimTimerRef.current = setTimeout(() => {
      setItemAnimPhase('exit');

      if (intent.targetIndex !== undefined) {
        // Manipulation (Babidi) forces one enemy Active to attack another — the
        // struggle happens entirely on the opponent's side, not from our caster.
        const isManipulation = intent.secondTargetIndex !== undefined;
        const aEl = isManipulation
          ? board.querySelector(`[data-subslot="active"][data-index="${intent.targetIndex}"][data-opp="true"]`)
          : board.querySelector(`[data-subslot="active"][data-index="${intent.fighterIndex}"][data-opp="false"]`);
        const dEl = isManipulation
          ? board.querySelector(`[data-subslot="active"][data-index="${intent.secondTargetIndex}"][data-opp="true"]`)
          : board.querySelector(`[data-subslot="active"][data-index="${intent.targetIndex}"][data-opp="true"]`);
        if (aEl && dEl) {
          const aR = aEl.getBoundingClientRect();
          const dR = dEl.getBoundingClientRect();
          const attackerFighter = isManipulation ? oppPlayer.actives[intent.targetIndex] : myPlayer.actives[intent.fighterIndex];
          const defenderFighter = isManipulation ? oppPlayer.actives[intent.secondTargetIndex!] : oppPlayer.actives[intent.targetIndex];
          let attackerCard: ReturnType<typeof getCard> | null = null;
          let defenderCard: ReturnType<typeof getCard> | null = null;
          try { attackerCard = attackerFighter ? getCard(attackerFighter.cardId) : null; } catch { attackerCard = null; }
          try { defenderCard = defenderFighter ? getCard(defenderFighter.cardId) : null; } catch { defenderCard = null; }
          const beamData: BeamStruggleData = {
            attackerPos: { x: aR.left + aR.width / 2 - boardRect.left, y: aR.top + aR.height / 2 - boardRect.top },
            defenderPos: { x: dR.left + dR.width / 2 - boardRect.left, y: dR.top + dR.height / 2 - boardRect.top },
            attackerColor: beamColorFor(attackerCard),
            defenderColor: beamColorFor(defenderCard),
            isUltimate: true,
          };
          setBeamStruggle(beamData);

          // Piccolo's Special Beam Cannon chains through to the bench slot directly behind the target.
          let chainBeamData: ChainBeamData | null = null;
          if (cardId === 'piccolo' && oppPlayer.bench[intent.targetIndex]) {
            const bEl = board.querySelector(`[data-subslot="bench"][data-index="${intent.targetIndex}"][data-opp="true"]`);
            if (bEl) {
              const bR = bEl.getBoundingClientRect();
              chainBeamData = {
                startPos: beamData.defenderPos,
                endPos: { x: bR.left + bR.width / 2 - boardRect.left, y: bR.top + bR.height / 2 - boardRect.top },
                color: beamData.attackerColor,
              };
            }
          }

          if (beamTimerRef.current) clearTimeout(beamTimerRef.current);
          beamTimerRef.current = setTimeout(() => {
            setBeamStruggle(null);
            if (chainBeamData) {
              setChainBeam(chainBeamData);
              if (chainBeamTimerRef.current) clearTimeout(chainBeamTimerRef.current);
              chainBeamTimerRef.current = setTimeout(() => {
                setChainBeam(null);
                if (stateRef.current.turnPlayer === perspectiveId) pendingCardDispatch.current?.();
                pendingCardDispatch.current = null;
              }, 550);
            } else {
              if (stateRef.current.turnPlayer === perspectiveId) pendingCardDispatch.current?.();
              pendingCardDispatch.current = null;
            }
          }, 1500);
        } else {
          if (stateRef.current.turnPlayer === perspectiveId) pendingCardDispatch.current?.();
          pendingCardDispatch.current = null;
        }
      } else {
        if (stateRef.current.turnPlayer === perspectiveId) pendingCardDispatch.current?.();
        pendingCardDispatch.current = null;
      }

      itemAnimTimerRef.current = setTimeout(() => {
        setItemPlayAnim(null);
        setItemAnimPhase('show');
        cardAnimLock.current = false;
      }, 550);
    }, 1500);
  }

  function startRetreatAnim(intent: Extract<Intent, { type: 'retreat' }>, onDispatch: () => void) {
    if (retreatAnimTimerRef.current) clearTimeout(retreatAnimTimerRef.current);
    const board = boardRef.current;
    if (!board) { onDispatch(); return; }

    const boardRect = board.getBoundingClientRect();
    const centerX = boardRect.width / 2;
    const centerY = boardRect.height / 2;

    const activeEl = board.querySelector(`[data-subslot="active"][data-index="${intent.activeIndex}"][data-opp="false"]`);
    const benchEl = board.querySelector(`[data-subslot="bench"][data-index="${intent.benchIndex}"][data-opp="false"]`);
    if (!activeEl || !benchEl) { onDispatch(); return; }

    const aR = activeEl.getBoundingClientRect();
    const bR = benchEl.getBoundingClientRect();

    const activePos = { x: aR.left + aR.width / 2 - boardRect.left - centerX, y: aR.top + aR.height / 2 - boardRect.top - centerY };
    const benchPos = { x: bR.left + bR.width / 2 - boardRect.left - centerX, y: bR.top + bR.height / 2 - boardRect.top - centerY };

    const activeCardId = myPlayer.actives[intent.activeIndex]?.cardId;
    const benchCardId = myPlayer.bench[intent.benchIndex]?.cardId ?? null;
    if (!activeCardId) { onDispatch(); return; }

    cardAnimLock.current = true;
    setRetreatAnim({
      activeCardId,
      benchCardId,
      activePos,
      benchPos,
      activeW: isCompact ? 110 : 140,
      activeH: isCompact ? 154 : 196,
      benchW: isCompact ? 60 : 90,
      benchH: isCompact ? 84 : 126,
    });
    setRetreatAnimFlying(false);

    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        setRetreatAnimFlying(true);
      });
    });

    retreatAnimTimerRef.current = setTimeout(() => {
      onDispatch();
      setRetreatAnim(null);
      setRetreatAnimFlying(false);
      cardAnimLock.current = false;
    }, 420);
  }

  function startPromoteAnim(benchIndex: number, activeIndex: number, cardId: string, onDispatch: () => void) {
    if (promoteAnimTimerRef.current) clearTimeout(promoteAnimTimerRef.current);
    const board = boardRef.current;
    if (!board) { onDispatch(); return; }

    const boardRect = board.getBoundingClientRect();
    const cx = boardRect.width / 2;
    const cy = boardRect.height / 2;

    const benchEl = board.querySelector(`[data-subslot="bench"][data-index="${benchIndex}"][data-opp="false"]`);
    const activeEl = board.querySelector(`[data-subslot="active"][data-index="${activeIndex}"][data-opp="false"]`);
    if (!benchEl || !activeEl) { onDispatch(); return; }

    const bR = benchEl.getBoundingClientRect();
    const aR = activeEl.getBoundingClientRect();

    setPromoteAnim({
      cardId,
      fromX: bR.left + bR.width / 2 - boardRect.left - cx,
      fromY: bR.top + bR.height / 2 - boardRect.top - cy,
      toX: aR.left + aR.width / 2 - boardRect.left - cx,
      toY: aR.top + aR.height / 2 - boardRect.top - cy,
      w: isCompact ? 110 : 140,
      h: isCompact ? 154 : 196,
    });
    setPromoteAnimFlying(false);
    requestAnimationFrame(() => requestAnimationFrame(() => setPromoteAnimFlying(true)));

    promoteAnimTimerRef.current = setTimeout(() => {
      onDispatch();
      setPromoteAnim(null);
      setPromoteAnimFlying(false);
    }, 430);
  }

  // ---- Phase button ----
  function handlePhaseButton() {
    if (!isMyTurn && perspective !== undefined) return;
    const isFirstPlayerTurn1 =
      state.phase === 'draw' &&
      state.players[tp].turnNumber === 1 &&
      tp === state.firstPlayer;

    if (isFirstPlayerTurn1) {
      setSelection({ mode: 'idle' });
      safeIntent({ type: 'advance_phase' });
      return;
    }

    if (state.phase === 'draw') return;
    if (state.phase === 'main2' || state.phase === 'end') {
      setSelection({ mode: 'idle' });
      safeIntent({ type: 'end_turn' });
      onTurnEnd();
      return;
    }
    if (state.phase === 'main1' && !moves.some(m => m.type === 'advance_phase')) {
      showError('Deploy a hero before advancing');
      return;
    }
    setSelection({ mode: 'idle' });
    safeIntent({ type: 'advance_phase' });
  }

  function getPhaseButtonLabel(): string {
    const isFirstPlayerTurn1 =
      state.phase === 'draw' &&
      state.players[tp].turnNumber === 1 &&
      tp === state.firstPlayer;

    if (isFirstPlayerTurn1) return 'START TURN';
    if (state.phase === 'draw') return 'DRAW ▾';
    if (state.phase === 'main1') return 'BATTLE PHASE →';
    if (state.phase === 'battle') return 'END BATTLE →';
    if (state.phase === 'main2') return 'END TURN →';
    if (state.phase === 'end') return 'END TURN →';
    return 'NEXT';
  }

  // ---- Draw piles ----
  function handleDrawPile(pile: 'hero' | 'item') {
    if (!isMyTurn && perspective !== undefined) return;
    if (state.phase !== 'draw') return;
    safeIntent({ type: 'draw', pile });
  }

  // ---- Hand card taps (legacy tap-to-select for non-drag cases) ----
  function handleHandCardTap(handIdx: number, cardId: string) {
    if (cardAnimLock.current) return;
    if (!isMyTurn && perspective !== undefined) return;
    if (state.phase !== 'main1' && state.phase !== 'main2') return;
    if (selection.mode === 'hand_card_selected' && selection.cardId === cardId) {
      const noTargetMove = moves.find(m =>
        (m.type === 'play_field' && m.cardId === cardId) ||
        (m.type === 'play_item' && m.cardId === cardId &&
          !('targetIndex' in m) && !('targetSide' in m))
      );
      if (noTargetMove) {
        const c = (() => { try { return getCard(cardId); } catch { return null; } })();
        const abKind = c?.abilities[0]?.kind;
        if (abKind === 'reveal_and_draw') {
          setPileSelectForCard(cardId);
        } else if (abKind === 'draw' && !(c?.abilities[0]?.params as any)?.heroOnly) {
          const drawCount = (c?.abilities[0]?.params as any)?.draw ?? 1;
          setMultiDrawSelect({ cardId, totalDraws: drawCount, picks: [] });
        } else {
          safeIntent(noTargetMove);
        }
      }
      setSelection({ mode: 'idle' });
      return;
    }
    setSelection({ mode: 'hand_card_selected', handIdx, cardId });
  }

  // ---- Field slot tap ----
  function handleFieldSlotTap() {
    if (!isMyTurn && perspective !== undefined) return;
    if (selection.mode !== 'hand_card_selected') return;
    const { cardId } = selection;
    const move = moves.find(m => m.type === 'play_field' && m.cardId === cardId);
    if (move) {
      safeIntent(move);
      setSelection({ mode: 'idle' });
    }
  }

  // ---- Playing a selected hand card onto a slot ----
  function handleSlotTap(
    side: 'active' | 'bench',
    index: number,
    isOpponent: boolean
  ) {
    if (cardAnimLock.current) return;
    if (!isMyTurn && perspective !== undefined) {
      // Not our turn — only allow card zoom, no game actions
      if (!isOpponent) {
        const fighter = side === 'active' ? myPlayer.actives[index] : myPlayer.bench[index];
        if (fighter) setZoomedCard({ cardId: fighter.cardId, fighter, fighterSide: side, fighterIndex: index, isOpponentFighter: false });
      } else {
        const oppFighter = side === 'active' ? oppPlayer.actives[index] : oppPlayer.bench[index];
        if (oppFighter) setZoomedCard({ cardId: oppFighter.cardId, fighter: oppFighter, fighterSide: side, fighterIndex: index, isOpponentFighter: true });
      }
      return;
    }
    if (selection.mode === 'chiaotzu_stun_select' && isOpponent && side === 'active') {
      safeIntent({
        type: 'play_hero',
        cardId: selection.cardId,
        slot: selection.slot,
        index: selection.index,
        stunTargetIndex: index,
      });
      setSelection({ mode: 'idle' });
      return;
    }

    if (selection.mode === 'ultimate_target_select' && isOpponent && side === 'active') {
      safeIntent({ type: 'ultimate', fighterIndex: selection.fighterIndex, targetIndex: index });
      setSelection({ mode: 'idle' });
      return;
    }

    if (selection.mode === 'manipulation_select_a' && isOpponent && side === 'active') {
      setSelection({ mode: 'manipulation_select_b', fighterIndex: selection.fighterIndex, targetIndexA: index });
      return;
    }

    if (selection.mode === 'manipulation_select_b' && isOpponent && side === 'active' && index !== selection.targetIndexA) {
      safeIntent({ type: 'ultimate', fighterIndex: selection.fighterIndex, targetIndex: selection.targetIndexA, secondTargetIndex: index });
      setSelection({ mode: 'idle' });
      return;
    }

    if (selection.mode === 'attacker_selected' && isOpponent && side === 'active') {
      const attacker = myPlayer.actives[selection.attackerIdx];
      if (!attacker) return;
      const card = (() => { try { return getCard(attacker.cardId); } catch { return null; } })();
      const hasKaioken = card?.abilities.find(ab => ab.key === 'kaioken') && !attacker.oncePerGameUsed['kaioken'];
      const hasOneShot = card?.abilities.find(ab => ab.kind === 'one_shot_on_attack') &&
        !attacker.oncePerGameUsed[card.abilities.find(ab => ab.kind === 'one_shot_on_attack')!.key];
      const hasTriBeam = card?.abilities.find(ab => ab.key === 'tri_beam') &&
        !attacker.oncePerGameUsed['tri_beam'] &&
        attacker.currentHp > 1000;

      if (hasKaioken || hasOneShot || hasTriBeam) {
        setPendingAttack({
          attackerIndex: selection.attackerIdx,
          targetIndex: index,
          attackerName: card?.name ?? attacker.cardId,
          attackerCardId: attacker.cardId,
          attackerHp: attacker.currentHp,
          kiAvailable: myPlayer.kiCurrent,
        });
      } else {
        dispatchAttackWithBeam({ type: 'attack', attackerIndex: selection.attackerIdx, targetIndex: index });
      }
      return;
    }

    if (selection.mode === 'retreat_select' && !isOpponent && side === 'bench') {
      safeIntent({ type: 'retreat', activeIndex: selection.activeIndex, benchIndex: index });
      setSelection({ mode: 'idle' });
      return;
    }

    if (selection.mode === 'self_destruct_enemy_select' && isOpponent && side === 'active') {
      const { handIdx, cardId, sacrificeSide, sacrificeIndex } = selection;
      const matchingMoves = moves.filter(m =>
        m.type === 'play_item' && m.cardId === cardId &&
        (m as any).targetSide === sacrificeSide &&
        (m as any).targetIndex === sacrificeIndex &&
        (m as any).enemyTargetIndex === index
      );
      if (matchingMoves.length === 0) return;
      if (matchingMoves.length === 1) {
        safeIntent(matchingMoves[0]);
        setSelection({ mode: 'idle' });
      } else {
        setSelection({ mode: 'self_destruct_bench_select', handIdx, cardId, sacrificeSide, sacrificeIndex, enemyTargetIndex: index });
      }
      return;
    }

    if (selection.mode === 'self_destruct_bench_select' && !isOpponent && side === 'bench') {
      const { cardId, sacrificeSide, sacrificeIndex, enemyTargetIndex } = selection;
      const move = moves.find(m =>
        m.type === 'play_item' && m.cardId === cardId &&
        (m as any).targetSide === sacrificeSide &&
        (m as any).targetIndex === sacrificeIndex &&
        (m as any).enemyTargetIndex === enemyTargetIndex &&
        (m as any).promotionIndex === index
      );
      if (!move) return;
      safeIntent(move);
      setSelection({ mode: 'idle' });
      return;
    }

    if (selection.mode === 'hand_card_selected') {
      const { cardId, handIdx } = selection;
      const card = (() => { try { return getCard(cardId); } catch { return null; } })();
      if (!card) return;

      if (isOpponent) {
        if (card.cardType === 'item') {
          const abKind = card.abilities[0]?.kind;
          if (abKind === 'direct_damage' || abKind === 'delayed_damage' || abKind === 'stun') {
            safeIntent({ type: 'play_item', cardId, targetIndex: index });
            setSelection({ mode: 'idle' });
            return;
          }
        }
        // Non-actionable opponent tap — clear selection and fall through to opponent zoom
        setSelection({ mode: 'idle' });
      } else if (card.cardType === 'hero') {
        const fighter = side === 'active' ? myPlayer.actives[index] : myPlayer.bench[index];
        if (fighter === null) {
          const isChiaotzu = card.abilities.some(
            (ab) => ab.kind === 'triggered_on_play' && (ab.params as Record<string, unknown>)['effect'] === 'stun'
          );
          if (isChiaotzu && oppPlayer.actives.some((f) => f !== null)) {
            setSelection({
              mode: 'chiaotzu_stun_select',
              handIdx,
              cardId,
              slot: side,
              index,
            });
            return;
          }
          safeIntent({ type: 'play_hero', cardId, slot: side, index });
          setSelection({ mode: 'idle' });
          return;
        }
        // Occupied slot — evolving a Buu onto an existing Buu is legal; otherwise fall through to zoom
        if (card.subtype === 'buu' && moves.some(m => m.type === 'evolve' && m.cardId === cardId && m.slotSide === side && m.slotIndex === index)) {
          safeIntent({ type: 'evolve', cardId, slotSide: side, slotIndex: index });
          setSelection({ mode: 'idle' });
          return;
        }
        setSelection({ mode: 'idle' });
      } else if (card.cardType === 'item') {
        const abKind = card.abilities[0]?.kind;
        if (abKind === 'sacrifice_for_damage') {
          const hasMove = moves.some(m => m.type === 'play_item' && m.cardId === cardId && (m as any).targetSide === side && (m as any).targetIndex === index);
          if (hasMove) {
            setSelection({ mode: 'self_destruct_enemy_select', handIdx, cardId, sacrificeSide: side, sacrificeIndex: index });
            return;
          }
        } else if (abKind === 'heal' || abKind === 'attach_stat' || abKind === 'attach_trigger' ||
          abKind === 'remove_summoning_sickness' || abKind === 'prevent_damage') {
          const fighter = side === 'active' ? myPlayer.actives[index] : myPlayer.bench[index];
          if (fighter) {
            const move = moves.find(m => m.type === 'play_item' && m.cardId === cardId && (m as any).targetSide === side && (m as any).targetIndex === index);
            if (move) {
              safeIntent(move);
              setSelection({ mode: 'idle' });
              return;
            }
          }
        }
        // No actionable item move — clear selection and fall through to fighter zoom
        setSelection({ mode: 'idle' });
      } else {
        setSelection({ mode: 'idle' });
      }
      // Fall through to fighter zoom logic below
    }

    if (selection.mode === 'attacker_selected' && !isOpponent && side === 'active' && selection.attackerIdx === index) {
      setSelection({ mode: 'idle' });
      return;
    }

    if (!isOpponent) {
      const fighter = side === 'active' ? myPlayer.actives[index] : myPlayer.bench[index];
      if (fighter) {
        setZoomedCard({ cardId: fighter.cardId, fighter, fighterSide: side, fighterIndex: index, isOpponentFighter: false });
        return;
      }
    }

    if (isOpponent) {
      const oppFighter = side === 'active' ? oppPlayer.actives[index] : oppPlayer.bench[index];
      if (oppFighter) {
        setZoomedCard({ cardId: oppFighter.cardId, fighter: oppFighter, fighterSide: side, fighterIndex: index, isOpponentFighter: true });
      }
    }
  }

  function handleAttackChoice(choice: AttackChoice) {
    if (!pendingAttack) return;
    const { attackerIndex, targetIndex } = pendingAttack;
    let intent: Intent;
    switch (choice.kind) {
      case 'kaioken':   intent = { type: 'attack', attackerIndex, targetIndex, useKaioken: true }; break;
      case 'one_shot':  intent = { type: 'attack', attackerIndex, targetIndex, useOneShotAbility: true }; break;
      case 'tri_beam':  intent = { type: 'attack', attackerIndex, targetIndex, useTriBeam: true }; break;
      default:          intent = { type: 'attack', attackerIndex, targetIndex }; break;
    }
    dispatchAttackWithBeam(intent);
  }

  // ---- Drag: dispatch drop ----
  function dispatchDrop(d: DragInfo, target: DropTarget): boolean {
    const card = (() => { try { return getCard(d.cardId); } catch { return null; } })();
    if (!card) return false;

    if (target.kind === 'field') {
      const move = moves.find(m => m.type === 'play_field' && m.cardId === d.cardId);
      if (move) safeIntent(move);
      return false;
    }

    if (target.kind === 'notarget') {
      const abKind = card.abilities[0]?.kind;
      const move = moves.find(m =>
        m.type === 'play_item' && m.cardId === d.cardId &&
        !('targetIndex' in m) && !('targetSide' in m)
      );
      if (move) {
        if (abKind === 'reveal_and_draw') {
          setPileSelectForCard(d.cardId);
        } else if (abKind === 'draw' && !(card.abilities[0]?.params as any)?.heroOnly) {
          const drawCount = (card.abilities[0]?.params as any)?.draw ?? 1;
          setMultiDrawSelect({ cardId: d.cardId, totalDraws: drawCount, picks: [] });
        } else {
          safeIntent(move);
        }
      }
      return false;
    }

    const { slot, index, isOpp } = target as Extract<DropTarget, { kind: 'fighter' }>;

    if (isOpp) {
      if (card.cardType === 'item') {
        const abKind = card.abilities[0]?.kind;
        if (abKind === 'direct_damage' || abKind === 'delayed_damage' || abKind === 'stun') {
          safeIntent({ type: 'play_item', cardId: d.cardId, targetIndex: index });
        }
      }
      return false;
    }

    if (card.cardType === 'hero') {
      const fighter = slot === 'active' ? myPlayer.actives[index] : myPlayer.bench[index];
      if (fighter !== null) {
        if (card.subtype === 'buu' && moves.some(m => m.type === 'evolve' && m.cardId === d.cardId && m.slotSide === slot && m.slotIndex === index)) {
          safeIntent({ type: 'evolve', cardId: d.cardId, slotSide: slot, slotIndex: index });
        }
        return false;
      }
      const isChiaotzu = card.abilities.some(
        ab => ab.kind === 'triggered_on_play' && (ab.params as Record<string, unknown>)['effect'] === 'stun'
      );
      if (isChiaotzu && oppPlayer.actives.some(f => f !== null)) {
        setSelection({ mode: 'chiaotzu_stun_select', handIdx: d.handIdx, cardId: d.cardId, slot, index });
        return true;
      }
      safeIntent({ type: 'play_hero', cardId: d.cardId, slot, index });
      return false;
    }

    if (card.cardType === 'item') {
      const abKind = card.abilities[0]?.kind;
      if (abKind === 'sacrifice_for_damage') {
        // Multi-step: dropping on an Android enters enemy-select mode rather than dispatching immediately
        const fighter = slot === 'active' ? myPlayer.actives[index] : myPlayer.bench[index];
        if (!fighter) return false;
        const hasMove = moves.some(m => m.type === 'play_item' && m.cardId === d.cardId && (m as any).targetSide === slot && (m as any).targetIndex === index);
        if (!hasMove) return false;
        setSelection({ mode: 'self_destruct_enemy_select', handIdx: d.handIdx, cardId: d.cardId, sacrificeSide: slot, sacrificeIndex: index });
        return true;
      }
      if (['heal', 'attach_stat', 'attach_trigger', 'remove_summoning_sickness', 'prevent_damage'].includes(abKind ?? '')) {
        const fighter = slot === 'active' ? myPlayer.actives[index] : myPlayer.bench[index];
        if (!fighter) return false;
        const move = moves.find(m => m.type === 'play_item' && m.cardId === d.cardId && (m as any).targetSide === slot && (m as any).targetIndex === index);
        if (!move) return false;
        safeIntent(move);
      }
      return false;
    }

    return false;
  }
  dispatchDropRef.current = dispatchDrop;

  // ---- Global drag listeners (active only while a drag is in flight) ----
  const dragActive = drag !== null;
  useEffect(() => {
    if (!dragActive) return;

    const onMove = (e: PointerEvent) => {
      const d = dragRef.current;
      if (!d) return;
      const updated = { ...d, x: e.clientX, y: e.clientY };
      dragRef.current = updated;
      setDrag(updated);
    };

    const onUp = (e: PointerEvent) => {
      const d = dragRef.current;
      dragRef.current = null;
      setDrag(null);
      if (!d) return;
      const target = getDropTarget(e.clientX, e.clientY);
      if (target) {
        const keep = dispatchDropRef.current(d, target);
        if (!keep) setSelection({ mode: 'idle' });
      } else {
        setSelection({ mode: 'idle' });
      }
    };

    window.addEventListener('pointermove', onMove, { passive: true });
    window.addEventListener('pointerup', onUp);
    window.addEventListener('pointercancel', onUp);
    return () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      window.removeEventListener('pointercancel', onUp);
    };
  }, [dragActive]);

  // ---- Compute valid play slots for selected hand card ----
  function getValidPlaySlots(): Set<string> {
    const result = new Set<string>();
    if (selection.mode !== 'hand_card_selected') return result;
    const { cardId } = selection;
    for (const m of moves) {
      if (m.type === 'play_hero' && m.cardId === cardId) {
        result.add(`${m.slot}-${m.index}-own`);
      } else if (m.type === 'evolve' && m.cardId === cardId) {
        result.add(`${m.slotSide}-${m.slotIndex}-own`);
      } else if (m.type === 'play_item') {
        if (m.cardId !== cardId) continue;
        if (m.targetSide !== undefined && m.targetIndex !== undefined) {
          result.add(`${m.targetSide}-${m.targetIndex}-own`);
        }
        if (m.targetIndex !== undefined && !m.targetSide) {
          result.add(`active-${m.targetIndex}-opp`);
        }
      }
    }
    return result;
  }

  const validPlaySlots = getValidPlaySlots();

  // ---- Compute valid attack targets ----
  function getValidAttackTargets(): Set<number> {
    if (selection.mode !== 'attacker_selected') return new Set();
    return new Set(
      moves
        .filter((m) => m.type === 'attack' && m.attackerIndex === selection.attackerIdx)
        .map((m) => (m as Extract<Intent, { type: 'attack' }>).targetIndex)
    );
  }
  const validAttackTargets = getValidAttackTargets();

  const chiaotzuStunTargets = selection.mode === 'chiaotzu_stun_select'
    ? new Set(oppPlayer.actives.map((f, i) => f ? i : -1).filter((i) => i !== -1))
    : new Set<number>();

  const ultTargets = selection.mode === 'ultimate_target_select'
    ? new Set(
        moves
          .filter((m) => m.type === 'ultimate' && m.fighterIndex === selection.fighterIndex && m.targetIndex !== undefined)
          .map((m) => (m as Extract<Intent, { type: 'ultimate' }>).targetIndex!)
      )
    : new Set<number>();

  const manipulationATargets = selection.mode === 'manipulation_select_a'
    ? new Set(
        moves
          .filter((m) => m.type === 'ultimate' && m.fighterIndex === selection.fighterIndex && m.targetIndex !== undefined)
          .map((m) => (m as Extract<Intent, { type: 'ultimate' }>).targetIndex!)
      )
    : new Set<number>();

  const manipulationBTargets = selection.mode === 'manipulation_select_b'
    ? new Set(
        moves
          .filter((m) => m.type === 'ultimate' && m.fighterIndex === selection.fighterIndex && m.targetIndex === selection.targetIndexA)
          .map((m) => (m as Extract<Intent, { type: 'ultimate' }>).secondTargetIndex!)
      )
    : new Set<number>();

  const retreatBenchTargets = selection.mode === 'retreat_select'
    ? new Set(
        moves
          .filter((m) => m.type === 'retreat' && m.activeIndex === selection.activeIndex)
          .map((m) => (m as Extract<Intent, { type: 'retreat' }>).benchIndex)
      )
    : new Set<number>();

  const sdEnemyTargets = selection.mode === 'self_destruct_enemy_select'
    ? new Set(
        moves
          .filter(m => m.type === 'play_item' && m.cardId === selection.cardId &&
            (m as any).targetSide === selection.sacrificeSide &&
            (m as any).targetIndex === selection.sacrificeIndex)
          .map(m => (m as any).enemyTargetIndex as number)
          .filter((idx): idx is number => idx !== undefined)
      )
    : new Set<number>();

  const sdBenchTargets = selection.mode === 'self_destruct_bench_select'
    ? new Set(
        moves
          .filter(m => m.type === 'play_item' && m.cardId === selection.cardId &&
            (m as any).targetSide === selection.sacrificeSide &&
            (m as any).targetIndex === selection.sacrificeIndex &&
            (m as any).enemyTargetIndex === selection.enemyTargetIndex)
          .map(m => (m as any).promotionIndex as number)
          .filter((idx): idx is number => idx !== undefined)
      )
    : new Set<number>();

  const playableCards = new Set(
    moves
      .filter((m) => m.type === 'play_hero' || m.type === 'play_item' || m.type === 'play_field' || m.type === 'evolve')
      .map((m) => (m as Extract<Intent, { type: 'play_hero' | 'play_item' | 'play_field' | 'evolve' }>).cardId)
  );

  const handToShow = myPlayer.hand;

  const isFirstPlayerTurn1 =
    state.phase === 'draw' &&
    state.players[tp].turnNumber === 1 &&
    tp === state.firstPlayer;

  const isMainPhase = state.phase === 'main1' || state.phase === 'main2';

  const fieldBgImage = (() => {
    if (!state.field) return null;
    try { return getCard(state.field)?.image ?? null; } catch { return null; }
  })();

  return (
    <div
      ref={boardRef}
      data-slot="notarget"
      className={boardShake ? 'board-shake' : undefined}
      style={{
        width: '100%',
        maxWidth: 430,
        height: '100dvh',
        margin: '0 auto',
        background: 'transparent',
        display: 'flex',
        flexDirection: 'column',
        position: 'relative',
        isolation: 'isolate',
        fontFamily: 'Saira, sans-serif',
        overflow: 'hidden',
        touchAction: 'none',
        userSelect: 'none',
        WebkitUserSelect: 'none',
      }}
    >
      {/* Playmat background — blurred field image (crossfade on field change) */}
      {leavingFieldImage && (
        <div
          style={{
            position: 'absolute',
            inset: '-60px',
            zIndex: -2,
            backgroundImage: `url(/${leavingFieldImage})`,
            backgroundSize: 'auto',
            backgroundPosition: 'center -400px',
            filter: 'blur(48px) brightness(0.55) saturate(1.6)',
            opacity: leavingFieldFading ? 0 : 1,
            transition: 'opacity 0.6s ease',
            pointerEvents: 'none',
          }}
        />
      )}
      <div
        key={state.field ?? 'none'}
        style={{
          position: 'absolute',
          inset: '-60px',
          zIndex: -1,
          backgroundImage: fieldBgImage ? `url(/${fieldBgImage})` : undefined,
          backgroundSize: 'auto',
          backgroundPosition: 'center -400px',
          filter: 'blur(48px) brightness(0.55) saturate(1.6)',
          opacity: !fieldBgImage ? 0 : undefined,
          animation: fieldBgImage ? 'fieldBgFadeIn 0.7s ease forwards' : undefined,
          pointerEvents: 'none',
        }}
      />

      {/* Beam struggle overlay — SVG-based, card-to-card */}
      {beamStruggle && (() => {
        const { attackerPos, defenderPos, attackerColor, defenderColor, isUltimate } = beamStruggle;
        const dx = defenderPos.x - attackerPos.x;
        const dy = defenderPos.y - attackerPos.y;
        const totalLen = Math.sqrt(dx * dx + dy * dy);
        const midX = (attackerPos.x + defenderPos.x) / 2;
        const midY = (attackerPos.y + defenderPos.y) / 2;
        const sparkDx = defenderPos.x - midX;
        const sparkDy = defenderPos.y - midY;
        const beamAngleDeg = Math.atan2(dy, dx) * 180 / Math.PI;
        const ac = attackerColor;
        const dc = defenderColor;
        return (
          <div style={{ position: 'absolute', inset: 0, zIndex: 300, pointerEvents: 'none' }}>
            {/* Board dim */}
            <div style={{ position: 'absolute', inset: 0, background: 'rgba(0,0,0,0.6)', animation: 'beam-bg-dim 1.5s forwards' }} />
            <svg style={{ position: 'absolute', inset: 0, overflow: 'visible' }} width="100%" height="100%">
              <defs>
                <filter id="bf-glow-a" x="-80%" y="-80%" width="260%" height="260%">
                  <feGaussianBlur stdDeviation="10" result="blur"/>
                  <feMerge><feMergeNode in="blur"/><feMergeNode in="SourceGraphic"/></feMerge>
                </filter>
                <filter id="bf-glow-d" x="-80%" y="-80%" width="260%" height="260%">
                  <feGaussianBlur stdDeviation="8" result="blur"/>
                  <feMerge><feMergeNode in="blur"/><feMergeNode in="SourceGraphic"/></feMerge>
                </filter>
                <filter id="bf-spark" x="-200%" y="-200%" width="500%" height="500%">
                  <feGaussianBlur stdDeviation="14"/>
                </filter>
                <filter id="bf-burst" x="-120%" y="-120%" width="340%" height="340%">
                  <feGaussianBlur stdDeviation="6" result="blur"/>
                  <feMerge><feMergeNode in="blur"/><feMergeNode in="SourceGraphic"/></feMerge>
                </filter>
              </defs>

              {/* ---- Attacker origin burst: outer handles opacity, inner handles position+rotation ---- */}
              <g style={{ animation: 'burst-origin 1.5s ease-out forwards' }}>
                <g transform={`translate(${attackerPos.x},${attackerPos.y}) rotate(${beamAngleDeg})`}>
                  <ellipse cx="0" cy="0" rx="36" ry="24" fill={ac} opacity="0.28" filter="url(#bf-burst)"/>
                  {/* Forward main spike */}
                  <line x1="-8" y1="0" x2="88" y2="0" stroke="white" strokeWidth="9" strokeLinecap="round" opacity="0.95"/>
                  <line x1="-8" y1="0" x2="110" y2="0" stroke={ac} strokeWidth="3.5" strokeLinecap="round" opacity="0.65"/>
                  {/* Forward diagonal ±25° */}
                  <line x1="0" y1="0" x2="62" y2="-27" stroke={ac} strokeWidth="5" strokeLinecap="round" opacity="0.8"/>
                  <line x1="0" y1="0" x2="62" y2="27" stroke={ac} strokeWidth="5" strokeLinecap="round" opacity="0.8"/>
                  {/* Forward diagonal ±45° */}
                  <line x1="0" y1="0" x2="40" y2="-40" stroke={ac} strokeWidth="3" strokeLinecap="round" opacity="0.6"/>
                  <line x1="0" y1="0" x2="40" y2="40" stroke={ac} strokeWidth="3" strokeLinecap="round" opacity="0.6"/>
                  {/* Perpendicular cross */}
                  <line x1="0" y1="-44" x2="0" y2="44" stroke={ac} strokeWidth="6" strokeLinecap="round" opacity="0.75"/>
                  <line x1="6" y1="-56" x2="6" y2="56" stroke={ac} strokeWidth="2" strokeLinecap="round" opacity="0.38"/>
                  {/* Backward kickback */}
                  <line x1="-4" y1="0" x2="-40" y2="0" stroke={ac} strokeWidth="5" strokeLinecap="round" opacity="0.62"/>
                  <line x1="0" y1="0" x2="-26" y2="-18" stroke={ac} strokeWidth="3" strokeLinecap="round" opacity="0.48"/>
                  <line x1="0" y1="0" x2="-26" y2="18" stroke={ac} strokeWidth="3" strokeLinecap="round" opacity="0.48"/>
                  {/* Core */}
                  <ellipse cx="0" cy="0" rx="21" ry="14" fill="white" opacity="1"/>
                  <ellipse cx="0" cy="0" rx="12" ry="8" fill={ac} opacity="1"/>
                </g>
              </g>

              {/* ---- Defender origin burst ---- */}
              <g style={{ animation: 'burst-origin 1.5s ease-out forwards' }}>
                <g transform={`translate(${defenderPos.x},${defenderPos.y}) rotate(${beamAngleDeg + 180})`}>
                  <ellipse cx="0" cy="0" rx="36" ry="24" fill={dc} opacity="0.28" filter="url(#bf-burst)"/>
                  <line x1="-8" y1="0" x2="88" y2="0" stroke="white" strokeWidth="9" strokeLinecap="round" opacity="0.95"/>
                  <line x1="-8" y1="0" x2="110" y2="0" stroke={dc} strokeWidth="3.5" strokeLinecap="round" opacity="0.65"/>
                  <line x1="0" y1="0" x2="62" y2="-27" stroke={dc} strokeWidth="5" strokeLinecap="round" opacity="0.8"/>
                  <line x1="0" y1="0" x2="62" y2="27" stroke={dc} strokeWidth="5" strokeLinecap="round" opacity="0.8"/>
                  <line x1="0" y1="0" x2="40" y2="-40" stroke={dc} strokeWidth="3" strokeLinecap="round" opacity="0.6"/>
                  <line x1="0" y1="0" x2="40" y2="40" stroke={dc} strokeWidth="3" strokeLinecap="round" opacity="0.6"/>
                  <line x1="0" y1="-44" x2="0" y2="44" stroke={dc} strokeWidth="6" strokeLinecap="round" opacity="0.75"/>
                  <line x1="6" y1="-56" x2="6" y2="56" stroke={dc} strokeWidth="2" strokeLinecap="round" opacity="0.38"/>
                  <line x1="-4" y1="0" x2="-40" y2="0" stroke={dc} strokeWidth="5" strokeLinecap="round" opacity="0.62"/>
                  <line x1="0" y1="0" x2="-26" y2="-18" stroke={dc} strokeWidth="3" strokeLinecap="round" opacity="0.48"/>
                  <line x1="0" y1="0" x2="-26" y2="18" stroke={dc} strokeWidth="3" strokeLinecap="round" opacity="0.48"/>
                  <ellipse cx="0" cy="0" rx="21" ry="14" fill="white" opacity="1"/>
                  <ellipse cx="0" cy="0" rx="12" ry="8" fill={dc} opacity="1"/>
                </g>
              </g>

              {/* ---- Attacker beam ---- */}
              <line x1={attackerPos.x} y1={attackerPos.y} x2={defenderPos.x} y2={defenderPos.y}
                stroke={ac} strokeWidth={isUltimate ? "78" : "52"} strokeLinecap="round" strokeOpacity="0.35"
                filter="url(#bf-glow-a)"
                style={{ strokeDasharray: totalLen, '--tlen': totalLen, animation: 'beam-attacker-line 1.5s ease-out forwards' } as React.CSSProperties}
              />
              <line x1={attackerPos.x} y1={attackerPos.y} x2={defenderPos.x} y2={defenderPos.y}
                stroke={ac} strokeWidth={isUltimate ? "40" : "26"} strokeLinecap="round" strokeOpacity="0.75"
                style={{ strokeDasharray: totalLen, '--tlen': totalLen, animation: 'beam-attacker-line 1.5s ease-out forwards' } as React.CSSProperties}
              />
              <line x1={attackerPos.x} y1={attackerPos.y} x2={defenderPos.x} y2={defenderPos.y}
                stroke="white" strokeWidth={isUltimate ? "12" : "8"} strokeLinecap="round"
                style={{ strokeDasharray: totalLen, '--tlen': totalLen, animation: 'beam-attacker-line 1.5s ease-out forwards' } as React.CSSProperties}
              />

              {/* ---- Defender beam ---- */}
              <line x1={defenderPos.x} y1={defenderPos.y} x2={attackerPos.x} y2={attackerPos.y}
                stroke={dc} strokeWidth="40" strokeLinecap="round" strokeOpacity="0.35"
                filter="url(#bf-glow-d)"
                style={{ strokeDasharray: totalLen, '--tlen': totalLen, animation: 'beam-defender-line 1.5s ease-out forwards' } as React.CSSProperties}
              />
              <line x1={defenderPos.x} y1={defenderPos.y} x2={attackerPos.x} y2={attackerPos.y}
                stroke={dc} strokeWidth="18" strokeLinecap="round" strokeOpacity="0.8"
                style={{ strokeDasharray: totalLen, '--tlen': totalLen, animation: 'beam-defender-line 1.5s ease-out forwards' } as React.CSSProperties}
              />
              <line x1={defenderPos.x} y1={defenderPos.y} x2={attackerPos.x} y2={attackerPos.y}
                stroke="white" strokeWidth="5" strokeLinecap="round" strokeOpacity="0.7"
                style={{ strokeDasharray: totalLen, '--tlen': totalLen, animation: 'beam-defender-line 1.5s ease-out forwards' } as React.CSSProperties}
              />

              {/* ---- Clash explosion: outer handles CSS translate (follows spark), inner handles SVG position+rotation ---- */}
              <g style={{ '--sdx': `${sparkDx}px`, '--sdy': `${sparkDy}px`, animation: 'burst-clash 1.5s ease-in-out forwards' } as React.CSSProperties}>
                <g transform={`translate(${midX},${midY}) rotate(${beamAngleDeg})`}>
                  {/* Outer haze */}
                  <ellipse cx="0" cy="0" rx="58" ry="45" fill="white" opacity="0.1" filter="url(#bf-burst)"/>
                  {/* Perpendicular cross — widest (energy exploding sideways at impact) */}
                  <line x1="0" y1="-95" x2="0" y2="95" stroke="white" strokeWidth="8" strokeLinecap="round" opacity="0.9"/>
                  <line x1="0" y1="-118" x2="0" y2="118" stroke="white" strokeWidth="3" strokeLinecap="round" opacity="0.4"/>
                  {/* Beam axis — two colors meeting */}
                  <line x1="-78" y1="0" x2="0" y2="0" stroke={dc} strokeWidth="7" strokeLinecap="round" opacity="0.85"/>
                  <line x1="0" y1="0" x2="78" y2="0" stroke={ac} strokeWidth="7" strokeLinecap="round" opacity="0.85"/>
                  <line x1="-98" y1="0" x2="98" y2="0" stroke="white" strokeWidth="2.5" strokeLinecap="round" opacity="0.42"/>
                  {/* Diagonal spikes ±45° — attacker side */}
                  <line x1="0" y1="0" x2="58" y2="-58" stroke={ac} strokeWidth="4.5" strokeLinecap="round" opacity="0.72"/>
                  <line x1="0" y1="0" x2="58" y2="58" stroke={ac} strokeWidth="4.5" strokeLinecap="round" opacity="0.72"/>
                  {/* Diagonal spikes ±135° — defender side */}
                  <line x1="0" y1="0" x2="-58" y2="-58" stroke={dc} strokeWidth="4.5" strokeLinecap="round" opacity="0.72"/>
                  <line x1="0" y1="0" x2="-58" y2="58" stroke={dc} strokeWidth="4.5" strokeLinecap="round" opacity="0.72"/>
                  {/* Thin spikes between perp and diagonal (~±22.5°) */}
                  <line x1="0" y1="0" x2="32" y2="-78" stroke="white" strokeWidth="2.5" strokeLinecap="round" opacity="0.48"/>
                  <line x1="0" y1="0" x2="32" y2="78" stroke="white" strokeWidth="2.5" strokeLinecap="round" opacity="0.48"/>
                  <line x1="0" y1="0" x2="-32" y2="-78" stroke="white" strokeWidth="2.5" strokeLinecap="round" opacity="0.48"/>
                  <line x1="0" y1="0" x2="-32" y2="78" stroke="white" strokeWidth="2.5" strokeLinecap="round" opacity="0.48"/>
                  {/* Central glow layers */}
                  <ellipse cx="0" cy="0" rx="38" ry="30" fill="white" opacity="0.92"/>
                  <ellipse cx="0" cy="0" rx="22" ry="17" fill={ac} opacity="1"/>
                  <ellipse cx="0" cy="0" rx="11" ry="9" fill="white" opacity="1"/>
                </g>
              </g>

              {/* ---- Spark (bright point on top) ---- */}
              <circle cx={midX} cy={midY} r={38} fill="white" filter="url(#bf-spark)"
                style={{ '--sdx': `${sparkDx}px`, '--sdy': `${sparkDy}px`, animation: 'beam-spark-follow 1.5s ease-in-out forwards' } as React.CSSProperties}
              />
              <circle cx={midX} cy={midY} r={18} fill="white"
                style={{ '--sdx': `${sparkDx}px`, '--sdy': `${sparkDy}px`, animation: 'beam-spark-follow 1.5s ease-in-out forwards' } as React.CSSProperties}
              />
              <circle cx={midX} cy={midY} r={10} fill={ac}
                style={{ '--sdx': `${sparkDx}px`, '--sdy': `${sparkDy}px`, animation: 'beam-spark-follow 1.5s ease-in-out forwards' } as React.CSSProperties}
              />
            </svg>
          </div>
        );
      })()}

      {/* Chain beam overlay — Special Beam Cannon punching through to the bench slot behind the target */}
      {chainBeam && (() => {
        const { startPos, endPos, color } = chainBeam;
        const dx = endPos.x - startPos.x;
        const dy = endPos.y - startPos.y;
        const totalLen = Math.sqrt(dx * dx + dy * dy);
        return (
          <div style={{ position: 'absolute', inset: 0, zIndex: 300, pointerEvents: 'none' }}>
            <svg style={{ position: 'absolute', inset: 0, overflow: 'visible' }} width="100%" height="100%">
              <defs>
                <filter id="cb-glow" x="-80%" y="-80%" width="260%" height="260%">
                  <feGaussianBlur stdDeviation="8" result="blur"/>
                  <feMerge><feMergeNode in="blur"/><feMergeNode in="SourceGraphic"/></feMerge>
                </filter>
              </defs>
              <line x1={startPos.x} y1={startPos.y} x2={endPos.x} y2={endPos.y}
                stroke={color} strokeWidth="46" strokeLinecap="round" strokeOpacity="0.35"
                filter="url(#cb-glow)"
                style={{ strokeDasharray: totalLen, '--tlen': totalLen, animation: 'chain-beam-fire 0.55s ease-out forwards' } as React.CSSProperties}
              />
              <line x1={startPos.x} y1={startPos.y} x2={endPos.x} y2={endPos.y}
                stroke={color} strokeWidth="24" strokeLinecap="round" strokeOpacity="0.75"
                style={{ strokeDasharray: totalLen, '--tlen': totalLen, animation: 'chain-beam-fire 0.55s ease-out forwards' } as React.CSSProperties}
              />
              <line x1={startPos.x} y1={startPos.y} x2={endPos.x} y2={endPos.y}
                stroke="white" strokeWidth="8" strokeLinecap="round"
                style={{ strokeDasharray: totalLen, '--tlen': totalLen, animation: 'chain-beam-fire 0.55s ease-out forwards' } as React.CSSProperties}
              />
              <circle cx={endPos.x} cy={endPos.y} r={30} fill="white"
                style={{ animation: 'chain-impact-pop 0.4s ease-out 0.4s forwards', opacity: 0 } as React.CSSProperties}
              />
              <circle cx={endPos.x} cy={endPos.y} r={16} fill={color}
                style={{ animation: 'chain-impact-pop 0.4s ease-out 0.4s forwards', opacity: 0 } as React.CSSProperties}
              />
            </svg>
          </div>
        );
      })()}

      {/* Draw phase — large centered pile stacks with dim */}
      {state.phase === 'draw' && !isFirstPlayerTurn1 && isMyTurn && (
        <div style={{
          position: 'absolute', inset: 0, zIndex: 30,
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          pointerEvents: 'none',
        }}>
          {/* Dim */}
          <div style={{ position: 'absolute', inset: 0, background: 'rgba(0,0,0,0.55)', pointerEvents: 'none' }} />

          {/* Pile stacks */}
          <div style={{
            position: 'relative',
            display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 18,
            pointerEvents: 'auto',
          }}>
            <div style={{
              fontFamily: 'Bangers, sans-serif', fontSize: 11, letterSpacing: 4,
              color: 'rgba(255,255,255,0.38)', textTransform: 'uppercase',
            }}>
              Draw one
            </div>
            <div style={{ display: 'flex', gap: 22, alignItems: 'flex-end' }}>
              {(['hero', 'item'] as const).map((pile) => {
                const count = myPlayer.piles[pile].length;
                const hasMove = moves.some(m => m.type === 'draw' && m.pile === pile);
                const PILE_COLORS: Record<string, { bg: string; border: string; label: string; glow: string }> = {
                  hero:  { bg: '#111128', border: '#353880', label: '#8090ff', glow: 'rgba(80,100,255,0.45)' },
                  item:  { bg: '#0e1e0e', border: '#285028', label: '#40b840', glow: 'rgba(40,180,40,0.45)' },
                };
                const c = PILE_COLORS[pile];
                return (
                  <div
                    key={pile}
                    onClick={hasMove ? () => handleDrawPile(pile) : undefined}
                    style={{
                      display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 10,
                      cursor: hasMove ? 'pointer' : 'default',
                      opacity: hasMove ? 1 : 0.3,
                      transition: 'opacity 0.2s',
                    }}
                  >
                    {/* Stack layers */}
                    <div style={{ position: 'relative', width: 76, height: 100 }}>
                      {[3, 2, 1, 0].map((offset) => (
                        <div
                          key={offset}
                          className={offset === 0 && hasMove ? 'draw-pile-active' : undefined}
                          style={{
                            position: 'absolute',
                            width: 64, height: 86,
                            borderRadius: 7,
                            background: hasMove ? c.bg : 'rgba(30,30,30,1)',
                            border: `1.5px solid ${hasMove ? c.border : 'rgba(255,255,255,0.06)'}`,
                            left: offset * 4,
                            top: offset * 4,
                            ...(offset === 0 && hasMove ? { '--glow-color': c.glow } as React.CSSProperties : {}),
                          }}
                        />
                      ))}
                      {/* Count */}
                      <div style={{
                        position: 'absolute', inset: 0,
                        display: 'flex', alignItems: 'center', justifyContent: 'center',
                        zIndex: 10,
                      }}>
                        <span style={{
                          fontFamily: 'Bangers, sans-serif',
                          fontSize: 34, letterSpacing: 2,
                          color: hasMove ? c.label : 'rgba(255,255,255,0.25)',
                          lineHeight: 1,
                        }}>
                          {count}
                        </span>
                      </div>
                    </div>
                    {/* Pile label */}
                    <span style={{
                      fontFamily: 'Bangers, sans-serif',
                      fontSize: 14, letterSpacing: 2,
                      color: hasMove ? c.label : 'rgba(255,255,255,0.2)',
                      textTransform: 'uppercase',
                    }}>
                      {pile}
                    </span>
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      )}

      {/* YOUR TURN banner — DBZ episode title card style */}
      {turnBanner && (
        <div
          className="turn-banner"
          style={{ position: 'absolute', top: '44%', left: 0, right: 0, width: '100%', zIndex: 200, pointerEvents: 'none' }}
        >
          <div style={{
            background: '#000',
            padding: 0,
            borderRadius: 0,
          }}>
            <div style={{ height: 4, background: 'var(--ki)', width: '100%' }} />
            <div style={{ padding: '8px 16px 4px' }}>
              <div style={{ fontFamily: 'Bangers, sans-serif', fontSize: 22, color: '#fff', letterSpacing: 3, textTransform: 'uppercase' }}>
                YOUR TURN
              </div>
            </div>
            <div style={{ height: 2, background: 'var(--ki)', width: '100%' }} />
            <div style={{ padding: '3px 16px 6px' }}>
              <div style={{ fontFamily: 'Saira Condensed, sans-serif', fontSize: 9, color: '#ff7a18', letterSpacing: 2, textTransform: 'uppercase' }}>
                NEXT TIME ON DRAGON BALL Z...
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Narration pill */}
      {narration && (
        <div className="narration-pill" style={{ position: 'absolute', bottom: '35%', left: 0, right: 0, zIndex: 200, display: 'flex', justifyContent: 'center', pointerEvents: 'none' }}>
          <div style={{ fontFamily: 'Bangers, sans-serif', fontSize: 20, color: '#fff', letterSpacing: 3, textTransform: 'uppercase', textShadow: '0 0 20px rgba(255,122,24,0.9)', background: 'rgba(0,0,0,0.7)', padding: '8px 24px', borderRadius: 4, border: '1px solid rgba(255,122,24,0.4)' }}>{narration}</div>
        </div>
      )}

      {/* Phase toast */}
      {phaseToast && (
        <div
          className="phase-toast"
          style={{ position: 'absolute', top: '48%', left: 0, right: 0, zIndex: 200, display: 'flex', justifyContent: 'center', pointerEvents: 'none' }}
        >
          <div style={{
            fontFamily: 'Bangers, sans-serif', fontSize: 18, color: 'var(--ink)',
            letterSpacing: 3, textTransform: 'uppercase',
            background: 'rgba(0,0,0,0.78)', padding: '8px 28px', borderRadius: 6,
            border: '1px solid rgba(255,255,255,0.1)',
          }}>
            {phaseToast}
          </div>
        </div>
      )}

      {/* Item / field play animation — floating card */}
      {itemPlayAnim && (() => {
        let card: ReturnType<typeof getCard> | null = null;
        try { card = getCard(itemPlayAnim.cardId); } catch { card = null; }
        if (!card) return null;
        const isExiting = itemAnimPhase === 'exit';
        let transform = 'translate(-50%, -50%) scale(1)';
        let opacity: number = isExiting ? 0 : 1;
        let filter = 'none';
        const exitScale = itemPlayAnim.exitScale ?? 0.3;
        if (isExiting && itemPlayAnim.exitType === 'fly' && itemPlayAnim.exitDx !== null) {
          transform = `translate(calc(-50% + ${itemPlayAnim.exitDx}px), calc(-50% + ${itemPlayAnim.exitDy}px)) scale(${exitScale})`;
        } else if (isExiting && itemPlayAnim.exitType === 'fade') {
          transform = 'translate(-50%, -50%) scale(1.06)';
          filter = 'brightness(8) saturate(0)';
        }
        return (
          <div key={itemPlayAnim.cardId} style={{
            position: 'absolute',
            left: '50%',
            top: '50%',
            zIndex: 350,
            pointerEvents: 'none',
            transition: isExiting ? 'all 0.55s ease-in' : 'opacity 0.18s ease-out',
            transform,
            opacity,
            filter,
          }}>
            <div style={{
              width: 200,
              height: 280,
              borderRadius: 10,
              overflow: 'hidden',
              position: 'relative',
              background: '#0d0f14',
              boxShadow: '0 0 32px rgba(255,255,255,0.55), 0 12px 40px rgba(0,0,0,0.9)',
            }}>
              <Image
                fill
                src={`/${card.image}`}
                alt=""
                sizes="200px"
                loading="eager"
                style={{ objectFit: 'cover' }}
              />
            </div>
          </div>
        );
      })()}

      {/* Retreat swap animation — two cards cross-flying */}
      {retreatAnim && (() => {
        const { activeCardId, benchCardId, activePos, benchPos, activeW, activeH, benchW, benchH } = retreatAnim;
        let activeCard: ReturnType<typeof getCard> | null = null;
        let benchCard: ReturnType<typeof getCard> | null = null;
        try { activeCard = getCard(activeCardId); } catch { activeCard = null; }
        if (benchCardId) try { benchCard = getCard(benchCardId); } catch { benchCard = null; }
        const transition = 'transform 0.38s ease-in-out';
        return (
          <>
            <div style={{
              position: 'absolute', left: '50%', top: '50%', zIndex: 340, pointerEvents: 'none',
              width: activeW, height: activeH,
              transform: retreatAnimFlying
                ? `translate(calc(-50% + ${benchPos.x}px), calc(-50% + ${benchPos.y}px))`
                : `translate(calc(-50% + ${activePos.x}px), calc(-50% + ${activePos.y}px))`,
              transition,
            }}>
              <div style={{ width: '100%', height: '100%', borderRadius: 8, overflow: 'hidden', position: 'relative', background: '#0d0f14', boxShadow: '0 4px 20px rgba(0,0,0,0.85)' }}>
                {activeCard?.image && <Image fill src={`/${activeCard.image}`} alt="" sizes="140px" style={{ objectFit: 'cover', objectPosition: 'top center' }} />}
              </div>
            </div>
            {benchCard?.image && (
              <div style={{
                position: 'absolute', left: '50%', top: '50%', zIndex: 341, pointerEvents: 'none',
                width: benchW, height: benchH,
                transform: retreatAnimFlying
                  ? `translate(calc(-50% + ${activePos.x}px), calc(-50% + ${activePos.y}px))`
                  : `translate(calc(-50% + ${benchPos.x}px), calc(-50% + ${benchPos.y}px))`,
                transition,
              }}>
                <div style={{ width: '100%', height: '100%', borderRadius: 8, overflow: 'hidden', position: 'relative', background: '#0d0f14', boxShadow: '0 4px 20px rgba(0,0,0,0.85)' }}>
                  <Image fill src={`/${benchCard.image}`} alt="" sizes="90px" style={{ objectFit: 'cover', objectPosition: 'top center' }} />
                </div>
              </div>
            )}
          </>
        );
      })()}

      {/* Promotion slide animation — bench card flies to empty active slot */}
      {promoteAnim && (() => {
        let card: ReturnType<typeof getCard> | null = null;
        try { card = getCard(promoteAnim.cardId); } catch { card = null; }
        return (
          <div style={{
            position: 'absolute', left: '50%', top: '50%', zIndex: 342, pointerEvents: 'none',
            width: promoteAnim.w, height: promoteAnim.h,
            transform: promoteAnimFlying
              ? `translate(calc(-50% + ${promoteAnim.toX}px), calc(-50% + ${promoteAnim.toY}px)) scale(1.08)`
              : `translate(calc(-50% + ${promoteAnim.fromX}px), calc(-50% + ${promoteAnim.fromY}px)) scale(0.7)`,
            transition: 'transform 0.4s cubic-bezier(0.22, 1, 0.36, 1)',
            opacity: promoteAnimFlying ? 1 : 0.85,
          }}>
            <div style={{ width: '100%', height: '100%', borderRadius: 8, overflow: 'hidden', position: 'relative', background: '#0d0f14', boxShadow: '0 8px 32px rgba(255,122,24,0.5)' }}>
              {card?.image && <Image fill src={`/${card.image}`} alt="" sizes="140px" style={{ objectFit: 'cover', objectPosition: 'top center' }} />}
            </div>
          </div>
        );
      })()}

      {/* Promotion picker — shown when human player's active slot is empty and needs a replacement */}
      {(() => {
        const pending = state.pendingPromotions[0];
        if (!pending) return null;
        if (pending.side !== perspectiveId) return null;
        const benchFighters = myPlayer.bench
          .map((f, i) => (f ? { f, i } : null))
          .filter(Boolean) as { f: NonNullable<typeof myPlayer.bench[0]>; i: number }[];
        if (benchFighters.length === 0) return null;

        return (
          <div style={{
            position: 'absolute', inset: 0, background: 'rgba(13,15,20,0.88)',
            display: 'flex', alignItems: 'flex-end', zIndex: 390,
          }}>
            <div style={{
              width: '100%', background: 'var(--bg)',
              borderRadius: '16px 16px 0 0', padding: '20px 16px max(32px, env(safe-area-inset-bottom))',
              display: 'flex', flexDirection: 'column', gap: 14,
            }}>
              <p style={{
                fontFamily: 'Bangers, sans-serif', fontSize: 15, color: 'var(--ki)',
                margin: 0, letterSpacing: 1.5, textTransform: 'uppercase', textAlign: 'center',
              }}>
                CHOOSE REPLACEMENT
              </p>
              <p style={{
                fontFamily: 'Saira Condensed, sans-serif', fontSize: 10, color: 'var(--muted)',
                margin: 0, letterSpacing: 1, textTransform: 'uppercase', textAlign: 'center',
              }}>
                Select a bench fighter to take the active slot
              </p>
              <div style={{ display: 'flex', gap: 10, justifyContent: 'center', flexWrap: 'wrap' }}>
                {benchFighters.map(({ f, i }) => {
                  let card: ReturnType<typeof getCard> | null = null;
                  try { card = getCard(f.cardId); } catch { card = null; }
                  const hpPct = Math.round((f.currentHp / f.maxHp) * 100);
                  const hpColor = hpPct > 55 ? '#34c759' : hpPct > 25 ? '#ffb648' : '#ff4d4d';
                  return (
                    <button
                      key={i}
                      onClick={() => {
                        startPromoteAnim(i, pending.activeIndex, f.cardId, () => {
                          safeIntent({ type: 'promote_from_bench', benchIndex: i });
                        });
                      }}
                      style={{
                        background: 'rgba(255,255,255,0.04)', border: '1.5px solid rgba(255,255,255,0.12)',
                        borderRadius: 10, padding: '8px 10px', cursor: 'pointer',
                        display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 6,
                        minWidth: 90,
                      }}
                    >
                      <div style={{ width: 70, height: 98, borderRadius: 6, overflow: 'hidden', position: 'relative', background: '#0d0f14' }}>
                        {card?.image && <Image fill src={`/${card.image}`} alt="" sizes="70px" style={{ objectFit: 'cover', objectPosition: 'top center' }} />}
                      </div>
                      <span style={{ fontFamily: 'Saira Condensed, sans-serif', fontSize: 10, color: 'var(--ink)', textTransform: 'uppercase', letterSpacing: 0.5 }}>
                        {card?.name ?? f.cardId}
                      </span>
                      <span style={{ fontFamily: 'Saira Condensed, sans-serif', fontSize: 9, color: hpColor }}>
                        {f.currentHp.toLocaleString()} HP
                      </span>
                    </button>
                  );
                })}
              </div>
            </div>
          </div>
        );
      })()}

      {/* Discard picker (Bibidi's Creation) */}
      {creationSelectForFighter !== null && (() => {
        const fighterIndex = creationSelectForFighter;
        const eligibleDiscardIdxs = new Set(
          moves
            .filter((m) => m.type === 'ultimate' && m.fighterIndex === fighterIndex && m.targetIndex !== undefined)
            .map((m) => (m as Extract<Intent, { type: 'ultimate' }>).targetIndex!)
        );
        const eligible = state.discard
          .map((entry, i) => ({ id: entry.cardId, i }))
          .filter(({ i }) => eligibleDiscardIdxs.has(i));
        return (
          <div
            onClick={() => setCreationSelectForFighter(null)}
            style={{
              position: 'fixed', inset: 0, zIndex: 500,
              background: 'rgba(0,0,0,0.88)',
              display: 'flex', alignItems: 'flex-end', justifyContent: 'center',
            }}
          >
            <div
              onClick={e => e.stopPropagation()}
              className="sheet-rise"
              style={{
                width: '100%', maxWidth: 430,
                background: 'var(--panel)', borderRadius: '16px 16px 0 0',
                padding: 'max(20px, env(safe-area-inset-top)) 16px max(20px, env(safe-area-inset-bottom))',
                display: 'flex', flexDirection: 'column', gap: 12,
              }}
            >
              <div style={{ fontFamily: 'Bangers, sans-serif', fontSize: 17, color: 'var(--ki)', letterSpacing: 2, textTransform: 'uppercase', textAlign: 'center' }}>
                Return which fighter?
              </div>
              <div style={{ fontFamily: 'Saira Condensed, sans-serif', fontSize: 10, color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: 1, textAlign: 'center' }}>
                Choose a KO'd Majin to return to your hand
              </div>
              {eligible.map(({ id, i }) => {
                const c = (() => { try { return getCard(id); } catch { return null; } })();
                return (
                  <button
                    key={i}
                    onClick={() => {
                      setCreationSelectForFighter(null);
                      safeIntent({ type: 'ultimate', fighterIndex, targetIndex: i });
                    }}
                    style={{
                      display: 'flex', alignItems: 'center', gap: 12,
                      padding: '10px 14px', borderRadius: 10,
                      border: '1.5px solid var(--ki)',
                      background: 'rgba(255,122,24,0.08)',
                      cursor: 'pointer', textAlign: 'left',
                    }}
                  >
                    {c?.image && (
                      <img src={`/${c.image}`} alt={c.name ?? id} style={{ width: 40, height: 56, borderRadius: 4, objectFit: 'cover', flexShrink: 0 }} />
                    )}
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                      <span style={{ fontFamily: 'Bangers, sans-serif', fontSize: 15, color: 'var(--ink)', letterSpacing: 1 }}>{c?.name ?? id}</span>
                      <span style={{ fontFamily: 'Saira Condensed, sans-serif', fontSize: 10, color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: 0.5 }}>
                        {c?.kiCost ?? 0} Ki · {c?.hp?.toLocaleString() ?? '?'} HP · ATK {c?.atk?.toLocaleString() ?? '?'}
                      </span>
                    </div>
                  </button>
                );
              })}
              <button
                onClick={() => setCreationSelectForFighter(null)}
                style={{
                  padding: '8px 24px', borderRadius: 8,
                  border: '1px solid var(--line)', background: 'transparent',
                  color: 'var(--muted)', fontFamily: 'Saira Condensed, sans-serif',
                  fontSize: 12, letterSpacing: 1, textTransform: 'uppercase', cursor: 'pointer',
                }}
              >
                CANCEL
              </button>
            </div>
          </div>
        );
      })()}

      {/* Win / loss overlay — Dragon Radar style. Held back briefly after the finishing
          blow (see winnerRevealed) so the KO flash / board shake / narration land first. */}
      {winnerRevealed && state.winner && (
        <div className="winner-overlay-in" style={{
          position: 'absolute', inset: 0, zIndex: 500,
          background: 'rgba(0,0,0,0.87)',
          display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 20,
        }}>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
            {Array.from({ length: 7 }, (_, i) => (
              <div
                key={i}
                className="db-collect"
                style={{ animationDelay: `${i * 250}ms`, display: 'inline-flex' }}
              >
                <DragonBallKi stars={i + 1} size={36} />
              </div>
            ))}
          </div>
          <div style={{
            fontFamily: 'Bangers, sans-serif', fontSize: 52,
            color: state.winner === perspectiveId ? '#ffb648' : '#ff4d4d',
            letterSpacing: 4, textTransform: 'uppercase',
            textShadow: `0 0 40px ${state.winner === perspectiveId ? 'rgba(255,182,72,0.8)' : 'rgba(255,77,77,0.8)'}`,
          }}>
            {state.winner === perspectiveId ? 'VICTORY' : 'DEFEAT'}
          </div>
          <div style={{
            fontFamily: 'Saira Condensed, sans-serif', fontSize: 14,
            color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: 2,
          }}>
            {state.winner === perspectiveId
              ? 'You won the battle!'
              : `${state.winner === 'p1' ? 'Player 1' : 'Player 2'} wins`}
          </div>
        </div>
      )}

      {/* Battle zone */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 0, flex: 1, overflow: 'hidden', minHeight: 0, position: 'relative', justifyContent: 'center' }}>

        {/* Beam clash — sits across full battle zone width */}
        {beamClash && (
          <div className="beam-clash" style={{ position: 'absolute', inset: 0, zIndex: 50, pointerEvents: 'none', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            <div style={{ width: '100%', height: 3, background: 'linear-gradient(90deg, transparent, #ff7a18, white, #ff7a18, transparent)', boxShadow: '0 0 20px #ff7a18, 0 0 40px rgba(255,122,24,0.5)' }} />
          </div>
        )}

        {/* Field card — floats on the far left, overlapping both active rows */}
        <div style={{
          position: 'absolute', left: 8, top: '50%', transform: 'translateY(-50%)',
          zIndex: 15, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 3,
        }}>
          <div
            data-slot="field"
            style={{
              background: 'rgba(255,255,255,0.05)',
              borderRadius: 8, padding: 3,
              border: '1px solid rgba(255,255,255,0.1)',
              boxShadow: '0 4px 16px rgba(0,0,0,0.6)',
            }}
          >
            <FieldSlot
              fieldId={state.field}
              isValidPlaySlot={
                selection.mode === 'hand_card_selected' &&
                moves.some(m => m.type === 'play_field' && m.cardId === selection.cardId)
              }
              onTap={state.field
                ? () => setZoomedCard({ cardId: state.field! })
                : handleFieldSlotTap}
            />
          </div>
          {state.discard.length > 0 && (
            <span style={{ fontFamily: 'Saira Condensed, sans-serif', fontSize: 7, color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: 0.5 }}>
              ×{state.discard.length}
            </span>
          )}
        </div>

        {/* Phase button — floats on the far right, mirroring the field card */}
        <div style={{
          position: 'absolute', right: 8, top: '50%', transform: 'translateY(-50%)',
          zIndex: 15, display: 'flex', alignItems: 'center', justifyContent: 'center',
        }}>
          {isMyTurn ? (
            <button
              onClick={(e) => { e.stopPropagation(); handlePhaseButton(); }}
              onPointerDown={() => setPhaseButtonPressed(true)}
              onPointerUp={() => setPhaseButtonPressed(false)}
              onPointerCancel={() => setPhaseButtonPressed(false)}
              style={{
                fontFamily: 'Bangers, sans-serif', fontSize: 11, letterSpacing: 1.5,
                color: '#0d0f14',
                background: 'linear-gradient(135deg, var(--ki), var(--ki2))',
                border: 'none', borderRadius: 16, padding: '10px 14px',
                cursor: 'pointer', boxShadow: '0 3px 14px rgba(255,122,24,0.55)',
                textTransform: 'uppercase', whiteSpace: 'nowrap',
                WebkitTapHighlightColor: 'transparent',
                opacity: phaseButtonPressed ? 0.75 : 1,
                transform: phaseButtonPressed ? 'scale(0.96)' : 'scale(1)',
                transition: 'opacity 0.1s, transform 0.1s',
              }}
            >
              {getPhaseButtonLabel()}
            </button>
          ) : perspective && !isMyTurn ? (
            <span style={{
              fontFamily: 'Bangers, sans-serif', fontSize: 8, color: 'var(--muted)',
              letterSpacing: 1, textTransform: 'uppercase', textAlign: 'center',
              opacity: 0.5,
            }}>OPP<br/>TURN</span>
          ) : null}
        </div>

        {/* Opponent zone — bench at top, actives closest to centre */}
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4, padding: '6px 12px 4px', background: 'transparent', flexShrink: 0, opacity: isMyTurn ? 0.9 : 1, transition: 'opacity 0.3s', transform: 'perspective(500px) rotateX(5deg) scale(0.95)', transformOrigin: 'center bottom' }}>
          {/* Opp bench row: KO pips float on the right */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, width: '100%' }}>
            <div style={{ flex: 1 }} />
            <div style={{
              display: 'flex', justifyContent: 'center', gap: 6,
              background: 'rgba(0,0,0,0.38)',
              borderRadius: 12, padding: '5px 8px',
              border: '1px solid rgba(255,255,255,0.06)',
            }}>
              {oppPlayer.bench.map((f, i) => (
                <div key={i} data-slot="fighter" data-subslot="bench" data-index={i} data-opp="true" style={{ position: 'relative' }}>
                  {koFlashSlots.has(`${oppId}-bench-${i}`) && (
                    <div className="ko-flash" style={{ position: 'absolute', inset: 0, zIndex: 10, background: 'white', borderRadius: 8, pointerEvents: 'none' }} />
                  )}
                  <FighterSlot
                    fighter={f}
                    isActive={false}
                    isOpponent={true}
                    isCurrentTurnPlayer={!isMyTurn}
                    shaking={shakingSlots.has(`${oppId}-bench-${i}`)}
                    incomingDamage={damageSlots.get(`${oppId}-bench-${i}`)}
                    effectiveAtk={f ? getEffectiveStats(f, 'bench', i, oppId, state).atk : undefined}
                    effectiveDef={f ? getEffectiveStats(f, 'bench', i, oppId, state).def : undefined}
                    compact
                    onTap={() => handleSlotTap('bench', i, true)}
                  />
                </div>
              ))}
            </div>
            <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
              <KoScore scored={state.players[perspectiveId].koScoredAgainst} />
            </div>
          </div>
          <div style={{ display: 'flex', justifyContent: 'center', gap: 4 }}>
            {oppPlayer.actives.map((f, i) => {
              const isTarget = validAttackTargets.has(i) || chiaotzuStunTargets.has(i) || ultTargets.has(i) || sdEnemyTargets.has(i) || manipulationATargets.has(i) || manipulationBTargets.has(i);
              const isOppPlay = validPlaySlots.has(`active-${i}-opp`);
              return (
                <div key={i} data-slot="fighter" data-subslot="active" data-index={i} data-opp="true" style={{ position: 'relative' }}>
                  {koFlashSlots.has(`${oppId}-active-${i}`) && (
                    <div className="ko-flash" style={{ position: 'absolute', inset: 0, zIndex: 10, background: 'white', borderRadius: 8, pointerEvents: 'none' }} />
                  )}
                  <FighterSlot
                    fighter={f}
                    isActive={true}
                    isOpponent={true}
                    isCurrentTurnPlayer={!isMyTurn}
                    isValidTarget={isTarget}
                    isValidPlaySlot={isOppPlay && !f}
                    compact={isCompact}
                    shaking={shakingSlots.has(`${oppId}-active-${i}`)}
                    incomingDamage={damageSlots.get(`${oppId}-active-${i}`)}
                    effectiveAtk={f ? getEffectiveStats(f, 'active', i, oppId, state).atk : undefined}
                    effectiveDef={f ? getEffectiveStats(f, 'active', i, oppId, state).def : undefined}
                    onTap={() => handleSlotTap('active', i, true)}
                  />
                </div>
              );
            })}
          </div>
        </div>

        {/* Small gap between opp and player actives */}
        <div style={{ height: 12, flexShrink: 0 }} />

        {/* Player actives */}
        <div style={{ display: 'flex', justifyContent: 'center', gap: 4, padding: '4px 12px 6px', background: 'transparent', flexShrink: 0 }}>
          {myPlayer.actives.map((f, i) => {
            const isAttackerSelected = selection.mode === 'attacker_selected' && selection.attackerIdx === i;
            const isPlayable = validPlaySlots.has(`active-${i}-own`);
            return (
              <div key={i} data-slot="fighter" data-subslot="active" data-index={i} data-opp="false" style={{ position: 'relative' }}>
                {koFlashSlots.has(`${perspectiveId}-active-${i}`) && (
                  <div className="ko-flash" style={{ position: 'absolute', inset: 0, zIndex: 10, background: 'white', borderRadius: 8, pointerEvents: 'none' }} />
                )}
                <FighterSlot
                  fighter={f}
                  isActive={true}
                  isOpponent={false}
                  isCurrentTurnPlayer={isMyTurn}
                  isSelected={isAttackerSelected}
                  isValidTarget={!isAttackerSelected && isPlayable && !!f}
                  isValidPlaySlot={isPlayable && !f}
                  compact={isCompact}
                  canAttack={isMyTurn && state.phase === 'battle' && f !== null && !f.summoningSick && !f.hasAttackedThisTurn && myPlayer.kiCurrent >= getEffectiveStats(f, 'active', i, tp, state).attackKiCost}
                  shaking={shakingSlots.has(`${perspectiveId}-active-${i}`)}
                  incomingDamage={damageSlots.get(`${perspectiveId}-active-${i}`)}
                  effectiveAtk={f ? getEffectiveStats(f, 'active', i, perspectiveId, state).atk : undefined}
                  effectiveDef={f ? getEffectiveStats(f, 'active', i, perspectiveId, state).def : undefined}
                  onTap={() => handleSlotTap('active', i, false)}
                />
              </div>
            );
          })}
        </div>

        {/* Player bench — Ki+KO float on left, phase button on right */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '4px 12px 4px', flexShrink: 0 }}>
          {/* Left: Ki pips + KO score — fixed width to keep bench centred */}
          <div style={{ width: 90, flexShrink: 0, display: 'flex', flexDirection: 'column', gap: 4, alignItems: 'flex-start' }}>
            <KiDisplay kiCurrent={myPlayer.kiCurrent} kiMax={myPlayer.kiMax} size={15} animating={kiAnimating} />
            <KoScore scored={state.players[oppId].koScoredAgainst} />
          </div>

          {/* Bench tray */}
          <div style={{ flex: 1, display: 'flex', justifyContent: 'center' }}>
            <div style={{
              display: 'flex', justifyContent: 'center', gap: 8,
              background: 'rgba(0,0,0,0.38)',
              borderRadius: 12, padding: '5px 8px',
              border: '1px solid rgba(255,255,255,0.06)',
            }}>
              {myPlayer.bench.map((f, i) => {
                const isRetreatTarget = retreatBenchTargets.has(i);
                const isSdBenchTarget = sdBenchTargets.has(i);
                const isPlayable = validPlaySlots.has(`bench-${i}-own`);
                return (
                  <div key={i} data-slot="fighter" data-subslot="bench" data-index={i} data-opp="false" style={{ position: 'relative' }}>
                    {koFlashSlots.has(`${perspectiveId}-bench-${i}`) && (
                      <div className="ko-flash" style={{ position: 'absolute', inset: 0, zIndex: 10, background: 'white', borderRadius: 8, pointerEvents: 'none' }} />
                    )}
                    <FighterSlot
                      fighter={f}
                      isActive={false}
                      isOpponent={false}
                      isCurrentTurnPlayer={isMyTurn}
                      isValidTarget={isRetreatTarget || isSdBenchTarget || (isPlayable && !!f)}
                      isValidPlaySlot={isPlayable && !f}
                      compact
                      shaking={shakingSlots.has(`${perspectiveId}-bench-${i}`)}
                      incomingDamage={damageSlots.get(`${perspectiveId}-bench-${i}`)}
                      effectiveAtk={f ? getEffectiveStats(f, 'bench', i, perspectiveId, state).atk : undefined}
                      effectiveDef={f ? getEffectiveStats(f, 'bench', i, perspectiveId, state).def : undefined}
                      onTap={() => handleSlotTap('bench', i, false)}
                    />
                  </div>
                );
              })}
            </div>
          </div>

          {/* Right: pile display — same fixed width as left flank */}
          <div style={{ width: 90, flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'flex-end' }}>
            <PileDisplay piles={myPlayer.piles} />
          </div>
        </div>
      </div>


      {/* Player hand — pulled up slightly so cards overlap bottom of bench */}
      <div style={{
        background: 'transparent',
        flexShrink: 0,
        paddingBottom: 'max(8px, env(safe-area-inset-bottom))',
        position: 'relative',
        zIndex: 10,
        marginTop: -14,
      }}>
        {/* Scrollable card row */}
        <div
          ref={handContainerRef}
          className="hand-drawer"
          style={{ minHeight: 'min(132px, 16dvh)' }}
        >
        <div
          className="hand-scroll"
          style={{
            display: 'flex',
            justifyContent: 'center',
            overflowX: 'hidden',
            overflowY: 'visible',
            padding: '4px 16px 8px',
            msOverflowStyle: 'none' as React.CSSProperties['msOverflowStyle'],
            scrollbarWidth: 'none' as React.CSSProperties['scrollbarWidth'],
            alignItems: 'flex-end',
          }}
        >
          {(() => {
            const CARD_W = 86;
            // Preserve original indices, then hide the card being actively dragged or mid-play-animation
            const allWithIdx = handToShow.map((cid, idx) => ({ cardId: cid, origIdx: idx }));
            let displayHand = allWithIdx;
            if (drag?.active && drag.handIdx != null) {
              displayHand = displayHand.filter(({ origIdx }) => origIdx !== drag.handIdx);
            }
            if (itemPlayAnim?.cardId) {
              // Hide one instance of the animating card so it doesn't flash back into the hand
              let dropped = false;
              displayHand = displayHand.filter(({ cardId }) => {
                if (!dropped && cardId === itemPlayAnim.cardId) { dropped = true; return false; }
                return true;
              });
            }
            const handCount = displayHand.length;
            const fanCenter = (handCount - 1) / 2;
            const fanAngleStep = Math.min(7, 28 / Math.max(handCount - 1, 1));
            // Compute the minimum overlap so the full hand fits without scrolling.
            // 32px accounts for the 16px padding on each side.
            const usable = handContainerW - 32;
            const rawOverlap = handCount > 1
              ? (CARD_W * handCount - usable) / (handCount - 1)
              : 0;
            // clamp: never less than 26 (existing look), never more than 62 (keep cards readable)
            const overlap = Math.max(26, Math.min(Math.ceil(rawOverlap), 62));
            return displayHand.map(({ cardId, origIdx }, i) => {
            const isHandSelected = selection.mode === 'hand_card_selected' && selection.cardId === cardId;
            const isPlayable = playableCards.has(cardId);
            const canDrag = isMyTurn && isPlayable && isMainPhase;
            const isHeld = heldCardOrigIdx === origIdx;

            return (
              <div
                key={`${cardId}-${origIdx}`}
                draggable={false}
                onContextMenu={(e) => e.preventDefault()}
                onPointerDown={(e) => {
                  // Start long-press timer — fires regardless of drag permission
                  if (holdTimerRef.current) clearTimeout(holdTimerRef.current);
                  holdTimerRef.current = setTimeout(() => {
                    holdTimerRef.current = null;
                    setHeldCardOrigIdx(origIdx);
                  }, 400);

                  // Capture pointer and suppress the click event that Safari fires after
                  // pointerup — without preventDefault the click would hit the zoom overlay
                  // backdrop and immediately close the modal we're about to open.
                  e.currentTarget.setPointerCapture(e.pointerId);
                  e.preventDefault();
                  if (!canDrag) return;
                  const info: DragInfo = {
                    cardId, handIdx: origIdx,
                    startX: e.clientX, startY: e.clientY,
                    x: e.clientX, y: e.clientY,
                    active: false,
                  };
                  dragRef.current = info;
                  setDrag(info);
                  setSelection({ mode: 'hand_card_selected', handIdx: origIdx, cardId });
                }}
                onPointerMove={(e) => {
                  const d = dragRef.current;
                  if (!d || d.handIdx !== origIdx) return;
                  const dist = Math.hypot(e.clientX - d.startX, e.clientY - d.startY);
                  if (dist >= 8) {
                    // Cancel long-press on any significant movement
                    if (holdTimerRef.current) { clearTimeout(holdTimerRef.current); holdTimerRef.current = null; }
                    setHeldCardOrigIdx(null);
                  }
                  const active = d.active || dist >= 8;
                  const updated = { ...d, x: e.clientX, y: e.clientY, active };
                  dragRef.current = updated;
                  setDrag(updated);
                }}
                onPointerUp={(e) => {
                  if (holdTimerRef.current) { clearTimeout(holdTimerRef.current); holdTimerRef.current = null; }
                  if (heldCardOrigIdx === origIdx) { setHeldCardOrigIdx(null); return; }
                  const d = dragRef.current;
                  if (!d || d.handIdx !== origIdx) {
                    setZoomedCard({ cardId, handIdx: origIdx });
                    return;
                  }
                  // Clear ref first — prevents the global window pointerup from double-dispatching
                  dragRef.current = null;
                  setDrag(null);
                  if (!d.active) {
                    setSelection({ mode: 'idle' });
                    setZoomedCard({ cardId, handIdx: origIdx });
                  } else {
                    // Dispatch drop here so fast drags on desktop work even if the
                    // global useEffect listener wasn't registered yet (fires after re-render)
                    const target = getDropTarget(e.clientX, e.clientY);
                    if (target) {
                      const keep = dispatchDropRef.current(d, target);
                      if (!keep) setSelection({ mode: 'idle' });
                    } else {
                      setSelection({ mode: 'idle' });
                    }
                  }
                }}
                onPointerCancel={() => {
                  if (holdTimerRef.current) { clearTimeout(holdTimerRef.current); holdTimerRef.current = null; }
                  setHeldCardOrigIdx(null);
                  if (dragRef.current?.handIdx === origIdx) {
                    dragRef.current = null;
                    setDrag(null);
                    setSelection({ mode: 'idle' });
                  }
                }}
                style={{
                  opacity: 1,
                  flexShrink: 0,
                  touchAction: 'none',
                  WebkitTouchCallout: 'none' as any,
                  cursor: canDrag ? 'grab' : 'pointer',
                  WebkitTapHighlightColor: 'rgba(255,255,255,0.08)',
                  transform: `rotate(${isHeld ? 0 : (i - fanCenter) * fanAngleStep}deg) translateY(${isHeld ? -20 : (Math.pow(i - fanCenter, 2) * 2.5 - (isHandSelected ? 38 : 0))}px) scale(${isHeld ? 1.5 : (isHandSelected ? 1.06 : 1)})`,
                  transformOrigin: 'center bottom',
                  zIndex: isHeld ? handCount + 20 : (isHandSelected ? handCount + 5 : i),
                  transition: 'transform 0.15s ease, margin-left 0.2s ease',
                  marginLeft: i > 0 ? -overlap : 0,
                }}
              >
                <HandCard cardId={cardId} isSelected={isHandSelected} />
              </div>
            );
          });
          })()}
        </div>
        </div>
      </div>

      {/* Drag ghost */}
      {drag?.active && (
        <div
          style={{
            position: 'fixed',
            left: drag.x - 43,
            top: drag.y - 130,
            width: 86,
            height: 120,
            pointerEvents: 'none',
            zIndex: 1000,
            opacity: 0.9,
            transform: 'rotate(3deg) scale(1.08)',
            borderRadius: 8,
            overflow: 'hidden',
            boxShadow: '0 12px 32px rgba(0,0,0,0.6)',
          }}
        >
          <HandCard cardId={drag.cardId} isSelected />
        </div>
      )}

      {/* Error toast */}
      {errorMsg && (
        <div style={{
          position: 'fixed',
          top: 80,
          left: '50%',
          transform: 'translateX(-50%)',
          background: 'rgba(255,77,77,0.9)',
          borderRadius: 8,
          padding: '6px 16px',
          zIndex: 300,
        }}>
          <span style={{ fontFamily: 'Saira Condensed, sans-serif', fontSize: 11, color: '#fff', textTransform: 'uppercase', letterSpacing: 0.5 }}>
            {errorMsg}
          </span>
        </div>
      )}

      {/* Card zoom overlay */}
      {zoomedCard && (() => {
        const zoomActions: Array<{ label: string; variant: 'primary' | 'secondary'; onClick: () => void; needsConfirm?: boolean }> = [];

        // Hand card — add play action for no-target items
        if (zoomedCard.handIdx !== undefined && isMyTurn && isMainPhase) {
          const hCard = (() => { try { return getCard(zoomedCard.cardId); } catch { return null; } })();
          const abKind = hCard?.abilities[0]?.kind;
          if (abKind === 'reveal_and_draw') {
            const move = moves.find(m => m.type === 'play_item' && m.cardId === zoomedCard.cardId);
            if (move) {
              zoomActions.push({
                label: 'PLAY',
                variant: 'primary',
                onClick: () => {
                  setZoomedCard(null);
                  setPileSelectForCard(zoomedCard.cardId);
                },
              });
            }
          } else if (abKind === 'draw') {
            const move = moves.find(m => m.type === 'play_item' && m.cardId === zoomedCard.cardId);
            if (move) {
              const heroOnly = (hCard?.abilities[0]?.params as any)?.heroOnly;
              const drawCount = (hCard?.abilities[0]?.params as any)?.draw ?? 1;
              zoomActions.push({
                label: 'PLAY',
                variant: 'primary',
                onClick: () => {
                  if (heroOnly) {
                    safeIntent(move);
                  } else {
                    setMultiDrawSelect({ cardId: zoomedCard.cardId, totalDraws: drawCount, picks: [] });
                  }
                  setZoomedCard(null);
                },
              });
            }
          }
        }

        if (zoomedCard.fighterSide !== undefined && !zoomedCard.isOpponentFighter && isMyTurn) {
          const f = zoomedCard.fighter;
          const side = zoomedCard.fighterSide!;
          const idx = zoomedCard.fighterIndex!;

          if (state.phase === 'battle' && side === 'active' && f &&
              !f.summoningSick && !f.hasAttackedThisTurn && !f.statuses.some(s => s.key === 'stun') &&
              moves.some(m => m.type === 'attack' && m.attackerIndex === idx)) {
            zoomActions.push({
              label: 'ATTACK',
              variant: 'primary',
              onClick: () => {
                setSelection({ mode: 'attacker_selected', attackerIdx: idx });
                setZoomedCard(null);
              },
            });
          }

          const canUltimate = side === 'active' && state.phase === 'battle' &&
            moves.some(m => m.type === 'ultimate' && m.fighterIndex === idx);
          if (canUltimate) {
            const ownCard = f ? (() => { try { return getCard(f.cardId); } catch { return null; } })() : null;
            const ultKey = ownCard?.abilities.find(ab => ab.kind === 'ultimate' || ab.kind === 'activated_one_shot')?.key;
            const ultimateNeedsTarget = moves.some(
              m => m.type === 'ultimate' && m.fighterIndex === idx && m.targetIndex !== undefined
            );
            zoomActions.push({
              label: 'ULTIMATE',
              variant: 'primary',
              needsConfirm: !ultimateNeedsTarget,
              onClick: () => {
                if (ultKey === 'manipulation') {
                  setSelection({ mode: 'manipulation_select_a', fighterIndex: idx });
                } else if (ultKey === 'creation') {
                  setCreationSelectForFighter(idx);
                } else if (ultimateNeedsTarget) {
                  setSelection({ mode: 'ultimate_target_select', fighterIndex: idx });
                } else {
                  safeIntent({ type: 'ultimate', fighterIndex: idx });
                }
                setZoomedCard(null);
              },
            });
          }

          const canRetreat = side === 'active' && state.phase === 'main1' &&
            moves.some(m => m.type === 'retreat' && m.activeIndex === idx);
          if (canRetreat) {
            zoomActions.push({
              label: 'RETREAT',
              variant: 'secondary',
              onClick: () => {
                setSelection({ mode: 'retreat_select', activeIndex: idx });
                setZoomedCard(null);
              },
            });
          }

          const canSacrifice = moves.some(m => m.type === 'sacrifice' && m.side === side && m.index === idx);
          if (canSacrifice) {
            zoomActions.push({
              label: 'SACRIFICE',
              variant: 'secondary',
              needsConfirm: true,
              onClick: () => {
                safeIntent({ type: 'sacrifice', side, index: idx });
                setZoomedCard(null);
              },
            });
          }
        }

        const zoomOwner = zoomedCard.isOpponentFighter ? oppId : perspectiveId;
        const zoomEffStats = (zoomedCard.fighter && zoomedCard.fighterSide !== undefined && zoomedCard.fighterIndex !== undefined)
          ? getEffectiveStats(zoomedCard.fighter, zoomedCard.fighterSide, zoomedCard.fighterIndex, zoomOwner, state)
          : null;

        return (
          <CardZoomOverlay
            cardId={zoomedCard.cardId}
            fighter={zoomedCard.fighter}
            onClose={() => setZoomedCard(null)}
            actions={zoomActions}
            isOpponentFighter={zoomedCard?.isOpponentFighter ?? false}
            effectiveAtk={zoomEffStats?.atk}
            effectiveDef={zoomEffStats?.def}
          />
        );
      })()}

      {/* Pile selection modal (Scouter / reveal_and_draw) */}
      {pileSelectForCard && (
        <div
          onClick={() => setPileSelectForCard(null)}
          style={{
            position: 'fixed', inset: 0, zIndex: 500,
            background: 'rgba(0,0,0,0.88)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            padding: 16,
          }}
        >
          <div
            onClick={e => e.stopPropagation()}
            style={{
              display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 16,
              background: 'var(--panel)', borderRadius: 12, padding: '24px 20px',
              border: '1px solid var(--line)', width: 'min(90vw, 340px)',
            }}
          >
            <div style={{ fontFamily: 'Bangers, sans-serif', fontSize: 18, color: 'var(--ink)', letterSpacing: 2, textTransform: 'uppercase' }}>
              Draw from which pile?
            </div>
            <div style={{ fontFamily: 'Saira Condensed, sans-serif', fontSize: 11, color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: 1 }}>
              Also reveals opponent's hand
            </div>
            <div style={{ display: 'flex', gap: 8, width: '100%' }}>
              {(['hero', 'item'] as const).map(pile => {
                const count = myPlayer.piles[pile].length;
                const disabled = count === 0;
                return (
                  <button
                    key={pile}
                    disabled={disabled}
                    onClick={() => {
                      const snapshot = [...oppPlayer.hand];
                      safeIntent({ type: 'play_item', cardId: pileSelectForCard, pileChoice: pile });
                      setRevealedOppHand(snapshot);
                      setPileSelectForCard(null);
                    }}
                    style={{
                      flex: 1,
                      padding: '12px 6px',
                      borderRadius: 8,
                      border: disabled ? '1px solid var(--line)' : '1.5px solid var(--ki)',
                      background: disabled ? 'rgba(255,255,255,0.03)' : 'rgba(255,122,24,0.12)',
                      color: disabled ? 'var(--muted)' : 'var(--ki)',
                      fontFamily: 'Bangers, sans-serif',
                      fontSize: 12,
                      letterSpacing: 1,
                      textTransform: 'uppercase',
                      cursor: disabled ? 'not-allowed' : 'pointer',
                      display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4,
                    }}
                  >
                    <span>{pile}</span>
                    <span style={{ fontFamily: 'Saira Condensed, sans-serif', fontSize: 9, color: 'var(--muted)' }}>
                      {count} card{count !== 1 ? 's' : ''}
                    </span>
                  </button>
                );
              })}
            </div>
            <button
              onClick={() => setPileSelectForCard(null)}
              style={{
                padding: '8px 24px', borderRadius: 8,
                border: '1px solid var(--line)', background: 'transparent',
                color: 'var(--muted)', fontFamily: 'Saira Condensed, sans-serif',
                fontSize: 12, letterSpacing: 1, textTransform: 'uppercase', cursor: 'pointer',
              }}
            >
              CANCEL
            </button>
          </div>
        </div>
      )}

      {/* Discard picker (Dragon Clan Ritual) */}
      {discardSelectForCard && (() => {
        const ritualCard = (() => { try { return getCard(discardSelectForCard); } catch { return null; } })();
        const targetType = (ritualCard?.abilities[0]?.params as any)?.type as string | undefined;
        const eligible = state.discard
          .map((entry, i) => ({ id: entry.cardId, owner: entry.owner, i }))
          .filter(({ id, owner }) => {
            if (owner !== perspectiveId) return false;
            const c = (() => { try { return getCard(id); } catch { return null; } })();
            return c?.cardType === 'hero' && c.fighterType === targetType;
          });
        return (
          <div
            onClick={() => setDiscardSelectForCard(null)}
            style={{
              position: 'fixed', inset: 0, zIndex: 500,
              background: 'rgba(0,0,0,0.88)',
              display: 'flex', alignItems: 'flex-end', justifyContent: 'center',
            }}
          >
            <div
              onClick={e => e.stopPropagation()}
              className="sheet-rise"
              style={{
                width: '100%', maxWidth: 430,
                background: 'var(--panel)', borderRadius: '16px 16px 0 0',
                padding: 'max(20px, env(safe-area-inset-top)) 16px max(20px, env(safe-area-inset-bottom))',
                display: 'flex', flexDirection: 'column', gap: 12,
              }}
            >
              <div style={{ fontFamily: 'Bangers, sans-serif', fontSize: 17, color: 'var(--ki)', letterSpacing: 2, textTransform: 'uppercase', textAlign: 'center' }}>
                Return which fighter?
              </div>
              <div style={{ fontFamily: 'Saira Condensed, sans-serif', fontSize: 10, color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: 1, textAlign: 'center' }}>
                Choose a KO'd {targetType ?? 'fighter'} to return to your hand
              </div>
              {eligible.map(({ id, i }) => {
                const c = (() => { try { return getCard(id); } catch { return null; } })();
                return (
                  <button
                    key={i}
                    onClick={() => {
                      const intent: Intent = { type: 'play_item', cardId: discardSelectForCard, discardIndex: i };
                      setDiscardSelectForCard(null);
                      startItemPlayAnim(intent, () => {
                        try { onIntent(intent); } catch (e: unknown) {
                          showError(e instanceof Error ? e.message : 'Illegal move');
                        }
                      });
                    }}
                    style={{
                      display: 'flex', alignItems: 'center', gap: 12,
                      padding: '10px 14px', borderRadius: 10,
                      border: '1.5px solid var(--ki)',
                      background: 'rgba(255,122,24,0.08)',
                      cursor: 'pointer', textAlign: 'left',
                    }}
                  >
                    {c?.image && (
                      <img src={`/${c.image}`} alt={c.name ?? id} style={{ width: 40, height: 56, borderRadius: 4, objectFit: 'cover', flexShrink: 0 }} />
                    )}
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                      <span style={{ fontFamily: 'Bangers, sans-serif', fontSize: 15, color: 'var(--ink)', letterSpacing: 1 }}>{c?.name ?? id}</span>
                      <span style={{ fontFamily: 'Saira Condensed, sans-serif', fontSize: 10, color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: 0.5 }}>
                        {c?.kiCost ?? 0} Ki · {c?.hp?.toLocaleString() ?? '?'} HP · ATK {c?.atk?.toLocaleString() ?? '?'}
                      </span>
                    </div>
                  </button>
                );
              })}
              <button
                onClick={() => setDiscardSelectForCard(null)}
                style={{
                  padding: '8px 24px', borderRadius: 8,
                  border: '1px solid var(--line)', background: 'transparent',
                  color: 'var(--muted)', fontFamily: 'Saira Condensed, sans-serif',
                  fontSize: 12, letterSpacing: 1, textTransform: 'uppercase', cursor: 'pointer',
                }}
              >
                CANCEL
              </button>
            </div>
          </div>
        );
      })()}

      {/* Revealed opponent hand overlay */}
      {revealedOppHand && (
        <div
          onClick={() => setRevealedOppHand(null)}
          style={{
            position: 'fixed', inset: 0, zIndex: 500,
            background: 'rgba(0,0,0,0.88)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            padding: 16,
          }}
        >
          <div
            onClick={e => e.stopPropagation()}
            style={{
              display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 16,
              background: 'var(--panel)', borderRadius: 12, padding: '20px 16px',
              border: '1px solid var(--line)', width: 'min(90vw, 360px)',
              maxHeight: '80dvh',
            }}
          >
            <div style={{ fontFamily: 'Bangers, sans-serif', fontSize: 16, color: 'var(--ki)', letterSpacing: 2, textTransform: 'uppercase' }}>
              Opponent's Hand
            </div>
            {revealedOppHand.length === 0 ? (
              <div style={{ fontFamily: 'Saira Condensed, sans-serif', fontSize: 13, color: 'var(--muted)' }}>
                Empty hand
              </div>
            ) : (
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, justifyContent: 'center', overflowY: 'auto' }}>
                {revealedOppHand.map((cId, idx) => {
                  let rc; try { rc = getCard(cId); } catch { rc = null; }
                  return (
                    <div key={idx} style={{
                      width: 72, height: 100, borderRadius: 6,
                      border: '1px solid var(--line)', overflow: 'hidden',
                      position: 'relative',
                      flexShrink: 0, background: 'var(--panel2)',
                    }}>
                      {rc?.image ? (
                        <Image fill src={`/${rc.image}`} alt={rc.name ?? cId} sizes="72px" style={{ objectFit: 'cover' }} />
                      ) : (
                        <div style={{ width: '100%', height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                          <span style={{ fontFamily: 'Bangers, sans-serif', fontSize: 20, color: 'rgba(255,255,255,0.3)' }}>
                            {(rc?.name ?? cId).charAt(0).toUpperCase()}
                          </span>
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
            <button
              onClick={() => setRevealedOppHand(null)}
              style={{
                padding: '10px 32px', borderRadius: 8,
                border: '1px solid var(--line)', background: 'transparent',
                color: 'rgba(255,255,255,0.7)', fontFamily: 'Saira Condensed, sans-serif',
                fontSize: 13, letterSpacing: 1.5, textTransform: 'uppercase', cursor: 'pointer',
              }}
            >
              CLOSE
            </button>
          </div>
        </div>
      )}

      {/* Multi-draw pile selection (Capsule Corp Kit) */}
      {multiDrawSelect && (
        <div
          onClick={() => setMultiDrawSelect(null)}
          style={{
            position: 'fixed', inset: 0, zIndex: 500,
            background: 'rgba(0,0,0,0.88)',
            display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16,
          }}
        >
          <div
            onClick={e => e.stopPropagation()}
            style={{
              display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 14,
              background: 'var(--panel)', borderRadius: 12, padding: '24px 20px',
              border: '1px solid var(--line)', width: 'min(90vw, 340px)',
            }}
          >
            <div style={{ fontFamily: 'Bangers, sans-serif', fontSize: 18, color: 'var(--ink)', letterSpacing: 2, textTransform: 'uppercase' }}>
              Choose pile to draw from
            </div>
            <div style={{ fontFamily: 'Saira Condensed, sans-serif', fontSize: 12, color: 'var(--ki)', textTransform: 'uppercase', letterSpacing: 1 }}>
              {multiDrawSelect.totalDraws - multiDrawSelect.picks.length} draw{multiDrawSelect.totalDraws - multiDrawSelect.picks.length !== 1 ? 's' : ''} remaining
            </div>
            <div style={{ display: 'flex', gap: 8, width: '100%' }}>
              {(['hero', 'item'] as const).map(pile => {
                const count = myPlayer.piles[pile].length;
                const disabled = count === 0;
                return (
                  <button
                    key={pile}
                    disabled={disabled}
                    onClick={() => {
                      const newPicks = [...multiDrawSelect.picks, pile];
                      if (newPicks.length === multiDrawSelect.totalDraws) {
                        safeIntent({ type: 'play_item', cardId: multiDrawSelect.cardId, drawChoices: newPicks });
                        setMultiDrawSelect(null);
                      } else {
                        setMultiDrawSelect({ ...multiDrawSelect, picks: newPicks });
                      }
                    }}
                    style={{
                      flex: 1, padding: '12px 6px', borderRadius: 8,
                      border: disabled ? '1px solid var(--line)' : '1.5px solid var(--ki)',
                      background: disabled ? 'rgba(255,255,255,0.03)' : 'rgba(255,122,24,0.12)',
                      color: disabled ? 'var(--muted)' : 'var(--ki)',
                      fontFamily: 'Bangers, sans-serif', fontSize: 12, letterSpacing: 1, textTransform: 'uppercase',
                      cursor: disabled ? 'not-allowed' : 'pointer',
                      display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4,
                    }}
                  >
                    <span>{pile}</span>
                    <span style={{ fontFamily: 'Saira Condensed, sans-serif', fontSize: 9, color: 'var(--muted)' }}>
                      {count} card{count !== 1 ? 's' : ''}
                    </span>
                  </button>
                );
              })}
            </div>
            {multiDrawSelect.picks.length > 0 && (
              <div style={{ fontFamily: 'Saira Condensed, sans-serif', fontSize: 11, color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: 0.5 }}>
                Chosen: {multiDrawSelect.picks.join(', ')}
              </div>
            )}
            <button
              onClick={() => setMultiDrawSelect(null)}
              style={{
                padding: '8px 24px', borderRadius: 8, border: '1px solid var(--line)',
                background: 'transparent', color: 'var(--muted)',
                fontFamily: 'Saira Condensed, sans-serif', fontSize: 12, letterSpacing: 1,
                textTransform: 'uppercase', cursor: 'pointer',
              }}
            >
              CANCEL
            </button>
          </div>
        </div>
      )}

      {/* Attack choice modal */}
      {pendingAttack && (() => {
        const card = (() => { try { return getCard(pendingAttack.attackerCardId); } catch { return null; } })();
        const hasKaioken = !!(card?.abilities.find(ab => ab.key === 'kaioken'));
        const oneShotAb = card?.abilities.find(ab => ab.kind === 'one_shot_on_attack');
        const hasOneShot = !!(oneShotAb && !myPlayer.actives[pendingAttack.attackerIndex]?.oncePerGameUsed[oneShotAb.key]);
        const hasTriBeam = !!(card?.abilities.find(ab => ab.key === 'tri_beam') &&
          !myPlayer.actives[pendingAttack.attackerIndex]?.oncePerGameUsed['tri_beam']);
        return (
          <AttackChoiceModal
            attackerName={pendingAttack.attackerName}
            showKaioken={hasKaioken}
            kiAvailable={pendingAttack.kiAvailable}
            showOneShot={hasOneShot}
            oneShotLabel={oneShotAb ? oneShotAb.key.replace(/_/g, ' ').toUpperCase() : undefined}
            showTriBeam={hasTriBeam}
            attackerHp={pendingAttack.attackerHp}
            onChoose={handleAttackChoice}
            onCancel={() => { setPendingAttack(null); setSelection({ mode: 'idle' }); }}
          />
        );
      })()}
    </div>
  );
}
