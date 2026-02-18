import { supabase } from '../lib/supabase';
import type {
  Brand,
  BrandStyleJSON,
  Collection,
  CollectionItem,
  LoginAudit,
  TrendInsightsJSON,
  Validation,
} from '../types/database';

export const brandStorage = {
  async getAll(): Promise<Brand[]> {
    const { data, error } = await supabase
      .from('brands')
      .select('*')
      .order('created_at', { ascending: false });
    if (error) throw error;
    return (data ?? []) as Brand[];
  },

  async getById(id: string): Promise<Brand | null> {
    const { data, error } = await supabase
      .from('brands')
      .select('*')
      .eq('id', id)
      .maybeSingle();
    if (error) throw error;
    return data as Brand | null;
  },

  async getByUserId(userId: string): Promise<Brand[]> {
    const { data, error } = await supabase
      .from('brands')
      .select('*')
      .eq('user_id', userId)
      .order('created_at', { ascending: false });
    if (error) throw error;
    return (data ?? []) as Brand[];
  },

  async create(brandData: { user_id: string; name: string; description: string; logo_url?: string | null }): Promise<Brand> {
    const { data, error } = await supabase
      .from('brands')
      .insert(brandData)
      .select()
      .single();
    if (error) throw error;
    return data as Brand;
  },

  async update(id: string, updates: Partial<Brand>): Promise<Brand | null> {
    const { data, error } = await supabase
      .from('brands')
      .update({ ...updates, updated_at: new Date().toISOString() })
      .eq('id', id)
      .select()
      .maybeSingle();
    if (error) throw error;
    return data as Brand | null;
  },
};

export const brandStyleStorage = {
  async getByBrandId(brandId: string): Promise<BrandStyleJSON | null> {
    const { data, error } = await supabase
      .from('brand_styles')
      .select('style_json')
      .eq('brand_id', brandId)
      .eq('is_active', true)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();
    if (error) throw error;
    return data?.style_json as BrandStyleJSON | null;
  },

  async save(brandId: string, style: BrandStyleJSON, userId: string): Promise<void> {
    const { data: existing } = await supabase
      .from('brand_styles')
      .select('id')
      .eq('brand_id', brandId)
      .eq('is_active', true)
      .maybeSingle();

    if (existing) {
      const { error } = await supabase
        .from('brand_styles')
        .update({ style_json: style as any })
        .eq('id', existing.id);
      if (error) throw error;
    } else {
      const { error } = await supabase
        .from('brand_styles')
        .insert({
          brand_id: brandId,
          style_json: style as any,
          version: 1,
          is_active: true,
          created_by: userId,
        });
      if (error) throw error;
    }
  },
};

export const collectionStorage = {
  async getAll(): Promise<Collection[]> {
    const { data, error } = await supabase
      .from('collections')
      .select('*')
      .order('created_at', { ascending: false });
    if (error) throw error;
    return (data ?? []) as Collection[];
  },

  async getById(id: string): Promise<Collection | null> {
    const { data, error } = await supabase
      .from('collections')
      .select('*')
      .eq('id', id)
      .maybeSingle();
    if (error) throw error;
    return data as Collection | null;
  },

  async getByBrandId(brandId: string): Promise<Collection[]> {
    const { data, error } = await supabase
      .from('collections')
      .select('*')
      .eq('brand_id', brandId)
      .order('created_at', { ascending: false });
    if (error) throw error;
    return (data ?? []) as Collection[];
  },

  async create(collectionData: Omit<Collection, 'id' | 'created_at' | 'updated_at'>): Promise<Collection> {
    const { data, error } = await supabase
      .from('collections')
      .insert(collectionData as any)
      .select()
      .single();
    if (error) throw error;
    return data as Collection;
  },

  async update(id: string, updates: Partial<Collection>): Promise<Collection | null> {
    const { data, error } = await supabase
      .from('collections')
      .update({ ...updates, updated_at: new Date().toISOString() } as any)
      .eq('id', id)
      .select()
      .maybeSingle();
    if (error) throw error;
    return data as Collection | null;
  },

  async delete(id: string): Promise<void> {
    // Delete child items first
    const { error: itemsError } = await supabase
      .from('collection_items')
      .delete()
      .eq('collection_id', id);
    if (itemsError) throw itemsError;

    const { error } = await supabase
      .from('collections')
      .delete()
      .eq('id', id);
    if (error) throw error;
  },

  async isNameUnique(brandId: string, name: string): Promise<boolean> {
    const { data, error } = await supabase
      .from('collections')
      .select('id')
      .eq('brand_id', brandId)
      .ilike('name', name)
      .limit(1);
    if (error) throw error;
    return !data || data.length === 0;
  },
};

export const collectionItemStorage = {
  async getAll(): Promise<CollectionItem[]> {
    const { data, error } = await supabase
      .from('collection_items')
      .select('*')
      .order('created_at', { ascending: true });
    if (error) throw error;
    return (data ?? []) as CollectionItem[];
  },

  async getById(id: string): Promise<CollectionItem | null> {
    const { data, error } = await supabase
      .from('collection_items')
      .select('*')
      .eq('id', id)
      .maybeSingle();
    if (error) throw error;
    return data as CollectionItem | null;
  },

  async getByCollectionId(collectionId: string): Promise<CollectionItem[]> {
    const { data, error } = await supabase
      .from('collection_items')
      .select('*')
      .eq('collection_id', collectionId)
      .order('created_at', { ascending: true });
    if (error) throw error;
    return (data ?? []) as CollectionItem[];
  },

  async create(itemData: Omit<CollectionItem, 'id' | 'created_at' | 'updated_at'>): Promise<CollectionItem> {
    const { data, error } = await supabase
      .from('collection_items')
      .insert(itemData as any)
      .select()
      .single();
    if (error) throw error;
    return data as CollectionItem;
  },

  async createMany(itemsData: Omit<CollectionItem, 'id' | 'created_at' | 'updated_at'>[]): Promise<CollectionItem[]> {
    const { data, error } = await supabase
      .from('collection_items')
      .insert(itemsData as any[])
      .select();
    if (error) throw error;
    return (data ?? []) as CollectionItem[];
  },

  async update(id: string, updates: Partial<CollectionItem>): Promise<CollectionItem | null> {
    const { data, error } = await supabase
      .from('collection_items')
      .update({ ...updates, updated_at: new Date().toISOString() } as any)
      .eq('id', id)
      .select()
      .maybeSingle();
    if (error) throw error;
    return data as CollectionItem | null;
  },

  async delete(id: string): Promise<void> {
    const { error } = await supabase
      .from('collection_items')
      .delete()
      .eq('id', id);
    if (error) throw error;
  },
};

export const trendInsightsStorage = {
  async save(collectionId: string, insights: TrendInsightsJSON, config?: { region?: string; season?: string; demographic?: string }): Promise<void> {
    const { error } = await supabase
      .from('trend_insights')
      .insert({
        collection_id: collectionId,
        insights_json: insights as any,
        region: config?.region ?? '',
        season: config?.season ?? '',
        demographic: config?.demographic ?? '',
        source: 'gemini',
        expires_at: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString(),
      });
    if (error) throw error;
  },

  async getByCollectionId(collectionId: string): Promise<TrendInsightsJSON | null> {
    const { data, error } = await supabase
      .from('trend_insights')
      .select('insights_json')
      .eq('collection_id', collectionId)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();
    if (error) throw error;
    return data?.insights_json as TrendInsightsJSON | null;
  },
};

export const validationStorage = {
  async getByItemId(itemId: string): Promise<Validation[]> {
    const { data, error } = await supabase
      .from('validations')
      .select('*')
      .eq('collection_item_id', itemId)
      .order('validated_at', { ascending: false });
    if (error) throw error;
    return (data ?? []) as Validation[];
  },

  async create(validationData: Omit<Validation, 'id' | 'validated_at'>): Promise<Validation> {
    const { data, error } = await supabase
      .from('validations')
      .insert(validationData as any)
      .select()
      .single();
    if (error) throw error;
    return data as Validation;
  },
};

export const loginAuditStorage = {
  async log(userId: string): Promise<void> {
    const { error } = await (supabase
      .from('login_audit') as any)
      .insert({
        user_id: userId,
        user_agent: navigator.userAgent,
        login_method: 'password',
        success: true,
      });
    if (error) console.error('Login audit insert failed:', error);
  },

  async getByUserId(userId: string, limit = 50): Promise<LoginAudit[]> {
    const { data, error } = await (supabase
      .from('login_audit') as any)
      .select('*')
      .eq('user_id', userId)
      .order('login_at', { ascending: false })
      .limit(limit);
    if (error) throw error;
    return (data ?? []) as LoginAudit[];
  },
};
