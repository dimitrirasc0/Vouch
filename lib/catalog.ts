import catalogJson from '@/data/catalog.json';
import type { CatalogItem } from './mandate';

export const catalog: CatalogItem[] = catalogJson;

export const categories = [...new Set(catalog.map((i) => i.category))] as [string, ...string[]];

// Keyword search over name and category; no matches returns the whole catalog.
export function searchCatalog(q: string): CatalogItem[] {
  const words = q.toLowerCase().split(/\W+/).filter(Boolean);
  const hits = catalog.filter((i) => words.some((w) => `${i.name} ${i.category}`.toLowerCase().includes(w)));
  return hits.length ? hits : catalog;
}

export function findItem(id: string): CatalogItem | undefined {
  return catalog.find((i) => i.id === id);
}
