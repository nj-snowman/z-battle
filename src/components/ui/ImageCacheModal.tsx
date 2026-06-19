'use client';

import React, { useState, useCallback, useRef } from 'react';

export const CACHE_STORAGE_KEY = 'zbattle_images_cached';

export function hasImagesCached(): boolean {
  if (typeof window === 'undefined') return false;
  return localStorage.getItem(CACHE_STORAGE_KEY) === '1';
}

// All card image paths (public/images/*)
const CARD_IMAGES = [
  'images/earthling_fighter.png',
  'images/martial_artist.png',
  'images/young_trainee.png',
  'images/krillin.png',
  'images/yamcha.png',
  'images/chiaotzu.png',
  'images/master_roshi.png',
  'images/tien.png',
  'images/gohan.png',
  'images/goku.png',
  'images/saiyan_recruit.png',
  'images/saiyan_trooper.png',
  'images/saiyan_brawler.png',
  'images/raditz.png',
  'images/nappa.png',
  'images/bardock.png',
  'images/future_trunks.png',
  'images/trunks_super_saiyan.png',
  'images/broly.png',
  'images/vegeta.png',
  'images/saibaman.png',
  'images/android_19.png',
  'images/dr_gero_20.png',
  'images/android_17.png',
  'images/android_18.png',
  'images/super_android_13.png',
  'images/android_16.png',
  'images/semi_perfect_cell.png',
  'images/cell.png',
  'images/dragon_clan_namekian.png',
  'images/namekian_child.png',
  'images/namekian_warrior.png',
  'images/dende.png',
  'images/lord_slug.png',
  'images/nail.png',
  'images/king_piccolo.png',
  'images/kami.png',
  'images/giant_namekian.png',
  'images/piccolo.png',
  'images/frieza_soldier.png',
  'images/cui.png',
  'images/appule.png',
  'images/dodoria.png',
  'images/zarbon.png',
  'images/recoome.png',
  'images/captain_ginyu.png',
  'images/king_cold.png',
  'images/cooler.png',
  'images/frieza.png',
  'images/senzu_bean.png',
  'images/power_pole.png',
  'images/weighted_clothing.png',
  'images/scouter.png',
  'images/flying_nimbus.png',
  'images/capsule_corp_kit.png',
  'images/kamehameha.png',
  'images/fusion.png',
  'images/saiyan_armor.png',
  'images/galick_gun.png',
  'images/zenkai_boost.png',
  'images/great_ape.png',
  'images/super_saiyan.png',
  'images/repair_kit.png',
  'images/reinforced_plating.png',
  'images/energy_absorption.png',
  'images/targeting_scope.png',
  'images/photon_blast.png',
  'images/barrier_field.png',
  'images/self_destruct_device.png',
  'images/power_core.png',
  'images/demon_cloak.png',
  'images/makankosappo.png',
  'images/namekian_insight.png',
  'images/regeneration_item.png',
  'images/dragon_clan_ritual.png',
  'images/fusion_namekian.png',
  'images/medical_machine.png',
  'images/battle_armor.png',
  'images/death_beam.png',
  'images/death_saucer.png',
  'images/telekinesis.png',
  'images/tyrants_command.png',
  'images/final_form.png',
  'images/world_tournament_arena.png',
  'images/kame_house.png',
  'images/hyperbolic_time_chamber.png',
  'images/king_kais_planet.png',
  'images/cell_games_arena.png',
  'images/dr_geros_lab.png',
  'images/planet_namek.png',
  'images/gurus_house.png',
  'images/friezas_spaceship.png',
  'images/capital_of_the_cold_empire.png',
];


type Mode = 'prompt' | 'loading' | 'done';

interface ImageCacheModalProps {
  onClose: () => void;
}

export default function ImageCacheModal({ onClose }: ImageCacheModalProps) {
  const [mode, setMode] = useState<Mode>('prompt');
  const [loaded, setLoaded] = useState(0);
  const total = CARD_IMAGES.length;
  const countRef = useRef(0);

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

  const handleDownload = useCallback(() => {
    setMode('loading');
    countRef.current = 0;

    for (const path of CARD_IMAGES) {
      const img = new window.Image();
      const done = () => {
        countRef.current += 1;
        const n = countRef.current;
        setLoaded(n);
        if (n === CARD_IMAGES.length) {
          localStorage.setItem(CACHE_STORAGE_KEY, '1');
          setMode('done');
          setTimeout(onClose, 1800);
        }
      };
      img.onload = done;
      img.onerror = done;
      img.src = '/' + path;
    }
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
      </div>
    </div>
  );
}
