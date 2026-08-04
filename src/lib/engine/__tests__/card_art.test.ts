import fs from 'fs';
import path from 'path';
import { ALL_CARDS, DECKS } from '../cards';

// Card rules text lives in the artwork, not in the DOM — a card whose image 404s renders as
// a blank placeholder with no way to read what it does. Deploy targets (Vercel/Linux) are
// case-sensitive while macOS is not, so an art file named `Goten.png` against an
// `images/goten.png` reference works locally and silently breaks in production. This asserts
// the exact-case match that the filesystem will actually enforce once deployed.

const IMAGES_DIR = path.join(process.cwd(), 'public', 'images');

describe('Card artwork', () => {
  const onDisk = new Set(fs.readdirSync(IMAGES_DIR));

  it('every card points at an image file that exists with exactly that name', () => {
    const broken: string[] = [];
    for (const card of ALL_CARDS) {
      if (!card.image) { broken.push(`${card.id}: no image field`); continue; }
      const base = path.basename(card.image);
      if (onDisk.has(base)) continue;
      const caseInsensitive = [...onDisk].find(f => f.toLowerCase() === base.toLowerCase());
      broken.push(
        caseInsensitive
          ? `${card.id}: wants "${base}" but the file on disk is "${caseInsensitive}" (works on macOS, 404s on Linux)`
          : `${card.id}: "${base}" is missing entirely`
      );
    }
    if (broken.length > 0) {
      throw new Error(`${broken.length} card(s) with unusable artwork:\n  ${broken.join('\n  ')}`);
    }
  });

  it('references images by lowercase path, matching the rest of the catalog', () => {
    const offenders = ALL_CARDS
      .filter(c => c.image && c.image !== c.image.toLowerCase())
      .map(c => `${c.id}: ${c.image}`);
    expect(offenders).toEqual([]);
  });

  it('every card in a playable deck has artwork', () => {
    const missing: string[] = [];
    for (const [deckId, deck] of Object.entries(DECKS)) {
      for (const id of [...deck.heroes, ...deck.items]) {
        const card = ALL_CARDS.find(c => c.id === id);
        if (!card?.image || !onDisk.has(path.basename(card.image))) {
          missing.push(`${deckId}/${id}`);
        }
      }
    }
    expect(missing).toEqual([]);
  });
});
