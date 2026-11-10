import catalogJson from '@/data/catalog.json';
import type { CatalogItem } from './mandate';

export const catalog: CatalogItem[] = catalogJson;

export const categories = [...new Set(catalog.map((i) => i.category))] as [string, ...string[]];

export function findItem(id: string): CatalogItem | undefined {
  return catalog.find((i) => i.id === id);
}
