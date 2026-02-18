import type {
  Brand,
  BrandStyleJSON,
  Collection,
  CollectionItem,
  TrendInsightsJSON,
  Validation,
} from '../types/database';

/**
 * Local storage service to replace Supabase
 * Uses browser localStorage with JSON serialization
 */

const STORAGE_KEYS = {
  BRANDS: 'trendsync_brands',
  BRAND_STYLES: 'trendsync_brand_styles',
  COLLECTIONS: 'trendsync_collections',
  COLLECTION_ITEMS: 'trendsync_collection_items',
  TREND_INSIGHTS: 'trendsync_trend_insights',
  VALIDATIONS: 'trendsync_validations',
  CURRENT_BRAND_ID: 'trendsync_current_brand_id',
} as const;

function generateId(): string {
  return `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
}

function getFromStorage<T>(key: string, defaultValue: T): T {
  try {
    const item = localStorage.getItem(key);
    return item ? JSON.parse(item) : defaultValue;
  } catch (error) {
    console.error(`Error reading from localStorage (${key}):`, error);
    return defaultValue;
  }
}

function setInStorage<T>(key: string, value: T): void {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch (error) {
    console.error(`Error writing to localStorage (${key}):`, error);
    throw new Error('Storage quota exceeded or localStorage unavailable');
  }
}

// Brand Operations
export const brandStorage = {
  getAll(): Brand[] {
    return getFromStorage(STORAGE_KEYS.BRANDS, []);
  },

  getById(id: string): Brand | null {
    const brands = this.getAll();
    return brands.find((b) => b.id === id) || null;
  },

  create(data: Omit<Brand, 'id' | 'created_at' | 'updated_at'>): Brand {
    const brands = this.getAll();
    const newBrand: Brand = {
      ...data,
      id: generateId(),
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    };
    brands.push(newBrand);
    setInStorage(STORAGE_KEYS.BRANDS, brands);
    return newBrand;
  },

  update(id: string, data: Partial<Omit<Brand, 'id'>>): Brand | null {
    const brands = this.getAll();
    const index = brands.findIndex((b) => b.id === id);
    if (index === -1) return null;

    brands[index] = {
      ...brands[index],
      ...data,
      updated_at: new Date().toISOString(),
    };
    setInStorage(STORAGE_KEYS.BRANDS, brands);
    return brands[index];
  },

  delete(id: string): boolean {
    const brands = this.getAll();
    const filtered = brands.filter((b) => b.id !== id);
    if (filtered.length === brands.length) return false;
    setInStorage(STORAGE_KEYS.BRANDS, filtered);
    return true;
  },

  getCurrent(): Brand | null {
    const currentId = localStorage.getItem(STORAGE_KEYS.CURRENT_BRAND_ID);
    return currentId ? this.getById(currentId) : null;
  },

  setCurrent(id: string): void {
    localStorage.setItem(STORAGE_KEYS.CURRENT_BRAND_ID, id);
  },
};

// Brand Style Operations
export const brandStyleStorage = {
  getByBrandId(brandId: string): BrandStyleJSON | null {
    const styles = getFromStorage<Record<string, BrandStyleJSON>>(
      STORAGE_KEYS.BRAND_STYLES,
      {}
    );
    return styles[brandId] || null;
  },

  save(brandId: string, style: BrandStyleJSON): void {
    const styles = getFromStorage<Record<string, BrandStyleJSON>>(
      STORAGE_KEYS.BRAND_STYLES,
      {}
    );
    styles[brandId] = style;
    setInStorage(STORAGE_KEYS.BRAND_STYLES, styles);
  },

  delete(brandId: string): void {
    const styles = getFromStorage<Record<string, BrandStyleJSON>>(
      STORAGE_KEYS.BRAND_STYLES,
      {}
    );
    delete styles[brandId];
    setInStorage(STORAGE_KEYS.BRAND_STYLES, styles);
  },
};

// Collection Operations
export const collectionStorage = {
  getAll(): Collection[] {
    return getFromStorage(STORAGE_KEYS.COLLECTIONS, []);
  },

  getById(id: string): Collection | null {
    const collections = this.getAll();
    return collections.find((c) => c.id === id) || null;
  },

  getByBrandId(brandId: string): Collection[] {
    const collections = this.getAll();
    return collections.filter((c) => c.brand_id === brandId);
  },

  create(data: Omit<Collection, 'id' | 'created_at' | 'updated_at'>): Collection {
    const collections = this.getAll();
    const newCollection: Collection = {
      ...data,
      id: generateId(),
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    };
    collections.push(newCollection);
    setInStorage(STORAGE_KEYS.COLLECTIONS, collections);
    return newCollection;
  },

  update(id: string, data: Partial<Omit<Collection, 'id'>>): Collection | null {
    const collections = this.getAll();
    const index = collections.findIndex((c) => c.id === id);
    if (index === -1) return null;

    collections[index] = {
      ...collections[index],
      ...data,
      updated_at: new Date().toISOString(),
    };
    setInStorage(STORAGE_KEYS.COLLECTIONS, collections);
    return collections[index];
  },

  delete(id: string): boolean {
    const collections = this.getAll();
    const filtered = collections.filter((c) => c.id !== id);
    if (filtered.length === collections.length) return false;
    setInStorage(STORAGE_KEYS.COLLECTIONS, filtered);
    return true;
  },
};

// Collection Item Operations
export const collectionItemStorage = {
  getAll(): CollectionItem[] {
    return getFromStorage(STORAGE_KEYS.COLLECTION_ITEMS, []);
  },

  getById(id: string): CollectionItem | null {
    const items = this.getAll();
    return items.find((i) => i.id === id) || null;
  },

  getByCollectionId(collectionId: string): CollectionItem[] {
    const items = this.getAll();
    return items.filter((i) => i.collection_id === collectionId);
  },

  create(data: Omit<CollectionItem, 'id' | 'created_at' | 'updated_at'>): CollectionItem {
    const items = this.getAll();
    const newItem: CollectionItem = {
      ...data,
      id: generateId(),
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    };
    items.push(newItem);
    setInStorage(STORAGE_KEYS.COLLECTION_ITEMS, items);
    return newItem;
  },

  createMany(dataArray: Omit<CollectionItem, 'id' | 'created_at' | 'updated_at'>[]): CollectionItem[] {
    const items = this.getAll();
    const newItems = dataArray.map(data => ({
      ...data,
      id: generateId(),
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    }));
    items.push(...newItems);
    setInStorage(STORAGE_KEYS.COLLECTION_ITEMS, items);
    return newItems;
  },

  update(id: string, data: Partial<Omit<CollectionItem, 'id'>>): CollectionItem | null {
    const items = this.getAll();
    const index = items.findIndex((i) => i.id === id);
    if (index === -1) return null;

    items[index] = {
      ...items[index],
      ...data,
      updated_at: new Date().toISOString(),
    };
    setInStorage(STORAGE_KEYS.COLLECTION_ITEMS, items);
    return items[index];
  },

  delete(id: string): boolean {
    const items = this.getAll();
    const filtered = items.filter((i) => i.id !== id);
    if (filtered.length === items.length) return false;
    setInStorage(STORAGE_KEYS.COLLECTION_ITEMS, filtered);
    return true;
  },

  deleteByCollectionId(collectionId: string): number {
    const items = this.getAll();
    const filtered = items.filter((i) => i.collection_id !== collectionId);
    const deletedCount = items.length - filtered.length;
    setInStorage(STORAGE_KEYS.COLLECTION_ITEMS, filtered);
    return deletedCount;
  },
};

// Trend Insights Operations
export const trendInsightsStorage = {
  getByCollectionId(collectionId: string): TrendInsightsJSON | null {
    const insights = getFromStorage<Record<string, TrendInsightsJSON>>(
      STORAGE_KEYS.TREND_INSIGHTS,
      {}
    );
    return insights[collectionId] || null;
  },

  save(collectionId: string, insights: TrendInsightsJSON): void {
    const allInsights = getFromStorage<Record<string, TrendInsightsJSON>>(
      STORAGE_KEYS.TREND_INSIGHTS,
      {}
    );
    allInsights[collectionId] = insights;
    setInStorage(STORAGE_KEYS.TREND_INSIGHTS, allInsights);
  },

  delete(collectionId: string): void {
    const insights = getFromStorage<Record<string, TrendInsightsJSON>>(
      STORAGE_KEYS.TREND_INSIGHTS,
      {}
    );
    delete insights[collectionId];
    setInStorage(STORAGE_KEYS.TREND_INSIGHTS, insights);
  },
};

// Validation Operations
export const validationStorage = {
  getAll(): Validation[] {
    return getFromStorage(STORAGE_KEYS.VALIDATIONS, []);
  },

  getByItemId(itemId: string): Validation[] {
    const validations = this.getAll();
    return validations.filter((v) => v.collection_item_id === itemId);
  },

  create(data: Omit<Validation, 'id' | 'validated_at'>): Validation {
    const validations = this.getAll();
    const newValidation: Validation = {
      ...data,
      id: generateId(),
      validated_at: new Date().toISOString(),
    };
    validations.push(newValidation);
    setInStorage(STORAGE_KEYS.VALIDATIONS, validations);
    return newValidation;
  },

  delete(id: string): boolean {
    const validations = this.getAll();
    const filtered = validations.filter((v) => v.id !== id);
    if (filtered.length === validations.length) return false;
    setInStorage(STORAGE_KEYS.VALIDATIONS, filtered);
    return true;
  },
};

// Utility function to clear all data
export function clearAllStorage(): void {
  Object.values(STORAGE_KEYS).forEach((key) => {
    localStorage.removeItem(key);
  });
}

// Utility function to export all data
export function exportAllData() {
  const data: Record<string, unknown> = {};
  Object.entries(STORAGE_KEYS).forEach(([name, key]) => {
    const value = localStorage.getItem(key);
    if (value) {
      try {
        data[name] = JSON.parse(value);
      } catch {
        data[name] = value;
      }
    }
  });
  return data;
}

// Utility function to import data
export function importAllData(data: Record<string, unknown>): void {
  Object.entries(data).forEach(([name, value]) => {
    const key = STORAGE_KEYS[name as keyof typeof STORAGE_KEYS];
    if (key) {
      localStorage.setItem(key, JSON.stringify(value));
    }
  });
}
