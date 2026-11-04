export interface CategoryRecord {
  id: string; name: string; slug: string; description: string; parentId: string | null;
  displayOrder: number; visible: boolean; revision: string;
}
export interface CollectionRecord {
  id: string; name: string; slug: string; description: string; displayOrder: number;
  status: "DRAFT" | "PUBLISHED" | "ARCHIVED"; slugLocked: boolean; revision: string;
  publishedAt: string | null; publiclyVisible: boolean;
}
export interface TaxonomyState { categories: CategoryRecord[]; collections: CollectionRecord[] }
interface TaxonomyFields { id?: string; revision?: string; name: string; slug: string; description: string; displayOrder: number }
export type TaxonomyInput = TaxonomyFields & (
  { kind: "category"; parentId: string | null; visible: boolean }
  | { kind: "collection"; status: CollectionRecord["status"] }
);
