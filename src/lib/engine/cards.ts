import cardsData from '../../../public/cards.json';
import type { CardDef } from './types';

const cardMap = new Map<string, CardDef>();
for (const card of (cardsData as any).cards) {
  cardMap.set(card.id, card as CardDef);
}

export function getCard(id: string): CardDef {
  const c = cardMap.get(id);
  if (!c) throw new Error(`Unknown card: ${id}`);
  return c;
}

export const DECKS = (cardsData as any).decks as Record<string, {
  name: string; type: string; ultimate: string;
  heroes: string[]; items: string[];
}>;

export const CONSTANTS = (cardsData as any).meta.constants;
