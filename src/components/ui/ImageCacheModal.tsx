'use client';

import React, { useState, useCallback, useRef } from 'react';
import { ALL_CARDS } from '@/lib/engine/cards';

export const CACHE_STORAGE_KEY = 'zbattle_images_cached';

export function hasImagesCached(): boolean {
  if (typeof window === 'undefined') return false;
  return localStorage.getItem(CACHE_STORAGE_KEY) === '1';
}

// Every card image path, derived from cards.json so this list can never go stale.
const CARD_IMAGES = [...new Set(ALL_CARDS.map((c) => c.image).filter(Boolean))] as string[];


type Mode = 'prompt' | 'loading' | 'done' | 'partial';

interface ImageCacheModalProps {
  onClose: () => void;
}

export default function ImageCacheModal({ onClose }: ImageCacheModalProps) {
  const [mode, setMode] = useState<Mode>('prompt');
  const [loaded, setLoaded] = useState(0);
  const [total, setTotal] = useState(CARD_IMAGES.length);
  const [failed, setFailed] = useState<string[]>([]);
  const countRef = useRef(0);
  const failedRef = useRef<string[]>([]);

  // Read user's scouter colour preference (default green)
  const storedColor = typeof window !== 'undefined'
    ? (localStorage.getItem('scouter_color') ?? 'green')
    : 'green';

  const COLORS: Record<string, { bg: string; vivid: string; muted: string; text: string }> = {
    green:  { bg: '#001a08', vivid: '#00c426', muted: '#004d15', text: '#00e030' },
    red:    { bg: '#280000', vivid: '#e82020', muted: '#5a0000', text: '#ff3030' },
    purple: { bg: '#1c0028', vivid: '#b830e8', muted: '#4a0066', text: '#d040ff' },
    blue:   { bg: '#001428', vivid: '#0096e8', muted: '#003566', text: '#10b0ff' },
  };
  const c = COLORS[storedColor] ?? COLORS.green;

  const loadImages = useCallback((paths: string[]) => {
    setMode('loading');
    setTotal(paths.length);
    setLoaded(0);
    countRef.current = 0;
    failedRef.current = [];

    for (const path of paths) {
      const img = new window.Image();
      const onDone = (ok: boolean) => {
        countRef.current += 1;
        if (!ok) failedRef.current.push(path);
        setLoaded(countRef.current);
        if (countRef.current === paths.length) {
          if (failedRef.current.length === 0) {
            localStorage.setItem(CACHE_STORAGE_KEY, '1');
            setMode('done');
            setTimeout(onClose, 1800);
          } else {
            setFailed(failedRef.current);
            setMode('partial');
          }
        }
      };
      img.onload = () => onDone(true);
      img.onerror = () => onDone(false);
      img.src = '/' + path;
    }
  }, [onClose]);

  const handleDownload = useCallback(() => loadImages(CARD_IMAGES), [loadImages]);
  const handleRetry = useCallback(() => loadImages(failed), [loadImages, failed]);
  const handleContinueAnyway = useCallback(() => {
    localStorage.setItem(CACHE_STORAGE_KEY, '1');
    onClose();
  }, [onClose]);

  const handleSkip = useCallback(() => {
    localStorage.setItem(CACHE_STORAGE_KEY, '1');
    onClose();
  }, [onClose]);

  const pct = total > 0 ? Math.round((loaded / total) * 100) : 0;
  const filled = Math.round(pct / 10);

  return (
    <div style={{
      position: 'fixed', inset: 0, zIndex: 600,
      background: 'rgba(0,0,0,0.88)',
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      padding: 24,
    }}>
      {/* Scanline overlay */}
      <div style={{
        position: 'fixed', inset: 0, pointerEvents: 'none',
        backgroundImage: 'repeating-linear-gradient(0deg, transparent, transparent 2px, rgba(0,200,50,0.04) 2px, rgba(0,200,50,0.04) 4px)',
      }} />

      <div style={{
        position: 'relative',
        width: '100%', maxWidth: 320,
        background: c.bg,
        border: `2px solid ${c.vivid}`,
        borderRadius: 16,
        padding: '22px 20px 20px',
        boxShadow: `0 0 50px ${c.vivid}25, 0 0 100px rgba(0,0,0,0.95)`,
        fontFamily: 'Courier New, monospace',
      }}>

        {/* Corner brackets */}
        <span style={{ position: 'absolute', top: 5, left:  6, color: c.vivid, fontSize: 13, opacity: 0.55 }}>⌐</span>
        <span style={{ position: 'absolute', top: 5, right: 6, color: c.vivid, fontSize: 13, opacity: 0.55, display: 'inline-block', transform: 'scaleX(-1)' }}>⌐</span>
        <span style={{ position: 'absolute', bottom: 5, left:  6, color: c.vivid, fontSize: 13, opacity: 0.55, display: 'inline-block', transform: 'scaleY(-1)' }}>⌐</span>
        <span style={{ position: 'absolute', bottom: 5, right: 6, color: c.vivid, fontSize: 13, opacity: 0.55, display: 'inline-block', transform: 'scale(-1)' }}>⌐</span>

        {/* Header label */}
        <div style={{ fontSize: 8, color: c.muted, letterSpacing: 3, marginBottom: 14, textTransform: 'uppercase' }}>
          ◈ CAPSULE CORP SCOUTER v3.1
        </div>

        {mode === 'prompt' && (
          <>
            <div style={{ fontSize: 15, color: c.vivid, letterSpacing: 3, textTransform: 'uppercase', marginBottom: 6 }}>
              CARD DATA
            </div>
            <div style={{ fontSize: 9, color: c.muted, letterSpacing: 1, marginBottom: 14 }}>
              {'━'.repeat(30)}
            </div>
            <div style={{ fontSize: 11, color: c.text, lineHeight: 1.8, marginBottom: 20, letterSpacing: 0.5 }}>
              DOWNLOAD LOW-RES CARD<br />
              IMAGES FOR A SMOOTHER<br />
              EXPERIENCE?<br />
              <span style={{ color: c.muted, fontSize: 9 }}>
                {total} IMAGES &nbsp;·&nbsp; ONE-TIME ONLY
              </span>
            </div>

            <div style={{ display: 'flex', gap: 10 }}>
              <button
                onClick={handleDownload}
                style={{
                  flex: 1, padding: '13px 0',
                  background: `${c.vivid}1a`,
                  border: `2px solid ${c.vivid}`,
                  borderRadius: 3, cursor: 'pointer',
                  fontFamily: 'Courier New, monospace',
                  fontSize: 22, color: c.vivid,
                }}
              >
                ✓
              </button>
              <button
                onClick={handleSkip}
                style={{
                  flex: 1, padding: '13px 0',
                  background: 'transparent',
                  border: `2px solid ${c.muted}`,
                  borderRadius: 3, cursor: 'pointer',
                  fontFamily: 'Courier New, monospace',
                  fontSize: 22, color: c.muted,
                }}
              >
                ✗
              </button>
            </div>
          </>
        )}

        {mode === 'loading' && (
          <>
            <div style={{ fontSize: 15, color: c.vivid, letterSpacing: 3, textTransform: 'uppercase', marginBottom: 6 }}>
              DOWNLOADING
            </div>
            <div style={{ fontSize: 9, color: c.muted, letterSpacing: 1, marginBottom: 16 }}>
              {'━'.repeat(30)}
            </div>

            <div style={{ fontSize: 10, color: c.muted, letterSpacing: 2, marginBottom: 4 }}>
              CACHING CARD DATA
            </div>
            <div style={{ fontSize: 11, color: c.text, letterSpacing: 1, marginBottom: 14 }}>
              {loaded} / {total} IMAGES
            </div>

            {/* Progress bar */}
            <div style={{ fontSize: 16, letterSpacing: 2, marginBottom: 6 }}>
              <span style={{ color: c.vivid }}>{'█'.repeat(filled)}</span>
              <span style={{ color: c.muted }}>{'░'.repeat(10 - filled)}</span>
              <span style={{ color: c.text, fontSize: 11 }}>&nbsp;{pct}%</span>
            </div>
          </>
        )}

        {mode === 'done' && (
          <>
            <div style={{ fontSize: 15, color: c.vivid, letterSpacing: 3, textTransform: 'uppercase', marginBottom: 6 }}>
              COMPLETE
            </div>
            <div style={{ fontSize: 9, color: c.muted, letterSpacing: 1, marginBottom: 16 }}>
              {'━'.repeat(30)}
            </div>
            <div style={{ fontSize: 11, color: c.text, letterSpacing: 1, lineHeight: 1.8 }}>
              ✓ {total} IMAGES CACHED<br />
              <span style={{ color: c.muted, fontSize: 9 }}>POWER LEVEL ENHANCED</span>
            </div>
          </>
        )}

        {mode === 'partial' && (
          <>
            <div style={{ fontSize: 15, color: c.vivid, letterSpacing: 3, textTransform: 'uppercase', marginBottom: 6 }}>
              INCOMPLETE
            </div>
            <div style={{ fontSize: 9, color: c.muted, letterSpacing: 1, marginBottom: 14 }}>
              {'━'.repeat(30)}
            </div>
            <div style={{ fontSize: 11, color: c.text, lineHeight: 1.8, marginBottom: 20, letterSpacing: 0.5 }}>
              {failed.length} OF {total} IMAGES<br />
              FAILED TO DOWNLOAD.<br />
              <span style={{ color: c.muted, fontSize: 9 }}>
                THESE MAY NOT LOAD OFFLINE
              </span>
            </div>

            <div style={{ display: 'flex', gap: 10 }}>
              <button
                onClick={handleRetry}
                style={{
                  flex: 1, padding: '13px 0',
                  background: `${c.vivid}1a`,
                  border: `2px solid ${c.vivid}`,
                  borderRadius: 3, cursor: 'pointer',
                  fontFamily: 'Courier New, monospace',
                  fontSize: 11, color: c.vivid, letterSpacing: 1,
                }}
              >
                RETRY
              </button>
              <button
                onClick={handleContinueAnyway}
                style={{
                  flex: 1, padding: '13px 0',
                  background: 'transparent',
                  border: `2px solid ${c.muted}`,
                  borderRadius: 3, cursor: 'pointer',
                  fontFamily: 'Courier New, monospace',
                  fontSize: 11, color: c.muted, letterSpacing: 1,
                }}
              >
                SKIP
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
