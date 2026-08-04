import { DECK_OPTIONS, DECK_IDS } from '../decks';
import { DECKS } from '../engine/cards';

describe('DECK_OPTIONS', () => {
  // Majin and Kai were once playable but missing from the accept-a-challenge
  // picker, so those decks couldn't be chosen when a friend challenged you.
  it('covers every deck in cards.json', () => {
    expect([...DECK_IDS].sort()).toEqual(Object.keys(DECKS).sort());
  });

  it('gives every deck a label and a colour', () => {
    for (const deck of DECK_OPTIONS) {
      expect(deck.name).toMatch(/\S/);
      expect(deck.color).toMatch(/^#[0-9a-f]{6}$/i);
    }
  });

  it('lists the known decks in display order', () => {
    expect(DECK_IDS).toEqual(['saiyan', 'namekian', 'android', 'human', 'frieza_force', 'majin', 'kai', 'rascals']);
  });
});
