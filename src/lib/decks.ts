import { DECKS } from './engine/cards';

export interface DeckOption {
  id: string;
  /** Faction label shown in pickers — not DECKS[id].name, which is the flavour title. */
  name: string;
  color: string;
}

const DECK_STYLES: Record<string, { name: string; color: string }> = {
  saiyan: { name: 'Saiyan', color: '#ff7a18' },
  namekian: { name: 'Namekian', color: '#34c759' },
  android: { name: 'Android', color: '#3aa6ff' },
  human: { name: 'Earthling', color: '#ffb648' },
  frieza_force: { name: 'Frieza Force', color: '#b44dff' },
  majin: { name: 'Majin', color: '#f03fcc' },
  kai: { name: 'Kai', color: '#7de2e0' },
  rascals: { name: 'Rascals', color: '#ffd447' },
};

// cards.json lists decks in its own order; pickers want this one.
const DISPLAY_ORDER = Object.keys(DECK_STYLES);

// Unlisted decks sort to the end, in cards.json order.
function rank(id: string): number {
  const i = DISPLAY_ORDER.indexOf(id);
  return i === -1 ? DISPLAY_ORDER.length : i;
}

function titleCase(id: string): string {
  return id.split('_').map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' ');
}

/**
 * Every deck in cards.json, in display order — the single source for all deck
 * pickers. Derived from DECKS rather than hand-listed in each screen, because
 * hand-listing is how Majin and Kai ended up unselectable when accepting a
 * friend's challenge. A deck with no entry in DECK_STYLES still shows up (grey,
 * name derived from its id) instead of silently vanishing from a picker.
 */
export const DECK_OPTIONS: DeckOption[] = Object.keys(DECKS)
  .sort((a, b) => rank(a) - rank(b))
  .map(id => ({ id, ...(DECK_STYLES[id] ?? { name: titleCase(id), color: '#8b93a7' }) }));

export const DECK_IDS: string[] = DECK_OPTIONS.map(d => d.id);
