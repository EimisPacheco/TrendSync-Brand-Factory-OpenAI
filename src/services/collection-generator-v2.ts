import { BriaAPIService, buildProductPrompt, BriaAPIError } from './bria-api';
import {
  brandStorage,
  brandStyleStorage,
  collectionStorage,
  collectionItemStorage,
  trendInsightsStorage,
  validationStorage,
} from './db-storage';
import { validateFIBOPrompt } from '../lib/brand-guardian';
import { retryBatch } from '../lib/retry';
import { GenerationLogger } from './generation-logger';
import {
  getCached,
  setCached,
  CACHE_KEYS,
  CACHE_TTL,
  checkRateLimit,
  hashObject,
} from './redis';
import { fetchTrends as apiFetchTrends, fetchCelebrities as apiFetchCelebrities } from '../lib/api-client';
import { uploadProductImage, isSupabaseStorageUrl } from '../lib/image-storage';
import type { CollectionConfig } from '../components/collection';
import type { CollectionItem, BrandStyleJSON, FIBOPromptJSON } from '../types/database';

export interface GenerationProgress {
  stage: 'creating' | 'trends' | 'planning' | 'generating_images' | 'complete' | 'failed';
  current?: number;
  total?: number;
  message?: string;
}

export interface GenerationResult {
  collectionId: string;
  items: CollectionItem[];
  stats: {
    total: number;
    successful: number;
    failed: number;
    warnings: string[];
  };
}

export class CollectionGeneratorError extends Error {
  constructor(
    message: string,
    public readonly stage: GenerationProgress['stage'],
    public readonly cause?: Error
  ) {
    super(message);
    this.name = 'CollectionGeneratorError';
  }
}

interface TrendingItem {
  name: string;
  confidence: number;
  description: string;
  hex?: string;
}

interface Celebrity {
  name: string;
  profession: string;
  signature_style: string;
  influence_score?: number;
}

interface TrendInsights {
  colors: TrendingItem[];
  silhouettes: TrendingItem[];
  materials: TrendingItem[];
  themes: TrendingItem[];
  celebrities?: Celebrity[];
  summary: string;
}

interface ProductDefinition {
  name: string;
  category: string;
  subcategory: string;
  description: string;
  designStory: string;
  persona: string;
  colors: { name: string; hex: string }[];
  materials: string[];
  style: string;
}

const PRICE_TIERS = ['entry', 'mid', 'premium', 'luxury'] as const;

export class CollectionGeneratorV2 {
  private briaApi: BriaAPIService;
  private onProgress?: (progress: GenerationProgress) => void;

  constructor(
    briaApiKey: string,
    onProgress?: (progress: GenerationProgress) => void
  ) {
    this.briaApi = new BriaAPIService({ apiKey: briaApiKey });
    this.onProgress = onProgress;
  }

  private updateProgress(progress: GenerationProgress) {
    this.onProgress?.(progress);
  }

  async generateCollection(
    config: CollectionConfig,
    brandId: string
  ): Promise<GenerationResult> {
    const warnings: string[] = [];
    let collectionId: string = '';
    let items: CollectionItem[] = [];
    const logger = new GenerationLogger();

    try {
      const brand = await brandStorage.getById(brandId);
      if (!brand) {
        throw new CollectionGeneratorError('Brand not found', 'creating');
      }

      const brandStyle = await brandStyleStorage.getByBrandId(brandId);
      if (!brandStyle) {
        throw new CollectionGeneratorError(
          'Brand style not configured. Please set up brand guidelines first.',
          'creating'
        );
      }

      await logger.logSection('Brand Configuration');
      await logger.log('Brand Style', {
        name: brand.name,
        colorPalette: brandStyle.colorPalette,
        negativePrompts: brandStyle.negativePrompts,
        cameraSettings: brandStyle.cameraSettings,
        lightingConfig: brandStyle.lightingConfig
      }, 'info');

      // Check name uniqueness before creating
      const isUnique = await collectionStorage.isNameUnique(brandId, config.name);
      if (!isUnique) {
        throw new CollectionGeneratorError(
          'A collection with this name already exists. Please choose a different name.',
          'creating'
        );
      }

      this.updateProgress({ stage: 'creating', message: 'Creating collection...' });
      const collection = await collectionStorage.create({
        brand_id: brandId,
        name: config.name,
        season: config.season,
        region: config.region,
        target_demographic: config.demographic,
        status: 'generating',
        collection_plan_json: config as any,
      });
      collectionId = collection.id;

      this.updateProgress({ stage: 'trends', message: 'Analyzing market trends with Gemini...' });
      const trendInsights = await this.getTrendInsights(config, logger);
      await trendInsightsStorage.save(collectionId, trendInsights as any, {
        region: config.region,
        season: config.season,
        demographic: config.demographic,
      });

      this.updateProgress({ stage: 'planning', message: 'Planning collection items...' });
      const products = this.generateProducts(config, trendInsights);

      await logger.logProductCreation(products);

      items = await collectionItemStorage.createMany(
        products.map((product, index) => ({
          collection_id: collectionId,
          sku: `${product.category.substring(0, 3).toUpperCase()}-${String(index + 1).padStart(3, '0')}`,
          name: product.name,
          category: product.category as 'apparel' | 'footwear' | 'accessories',
          subcategory: product.subcategory,
          design_story: product.designStory,
          target_persona: product.persona,
          price_tier: PRICE_TIERS[Math.floor(Math.random() * PRICE_TIERS.length)],
          design_spec_json: {
            silhouette: '',
            fit: '',
            colors: product.colors.map(c => ({
              name: c.name,
              hex: c.hex,
              usage: 'main'
            })),
            materials: product.materials.map(m => ({ name: m, placement: 'body' })),
            details: [],
            inspiration: product.style,
          },
          fibo_prompt_json: null as any,
          brand_compliance_score: 0,
          status: 'planned' as const,
        }))
      );

      this.updateProgress({
        stage: 'generating_images',
        message: 'Generating product images...',
        current: 0,
        total: items.length,
      });

      const imageResults = await this.generateImagesWithValidation(items, brandStyle, logger);

      if (imageResults.failed.length > 0) {
        warnings.push(
          `Failed to generate ${imageResults.failed.length} of ${items.length} images`
        );
        imageResults.failed.forEach(({ item, error }) => {
          warnings.push(`${item.sku}: ${error.message}`);
        });
      }

      await collectionStorage.update(collectionId, {
        status: imageResults.failed.length === items.length ? 'failed' : 'complete',
      });

      this.updateProgress({ stage: 'complete', message: 'Collection generation complete!' });

      const endTime = Date.now();
      const startTime = endTime - 60000;
      await logger.logSummary(imageResults.successful.length, imageResults.failed.length, endTime - startTime);

      const logPath = await logger.saveLog();
      console.log(`Generation log saved: ${logPath}`);

      const finalItems = await collectionItemStorage.getByCollectionId(collectionId);
      return {
        collectionId,
        items: finalItems,
        stats: {
          total: items.length,
          successful: imageResults.successful.length,
          failed: imageResults.failed.length,
          warnings,
        },
      };
    } catch (error) {
      if (collectionId) {
        await collectionStorage.update(collectionId, { status: 'failed' });
      }

      await logger.logError('Collection generation', error);
      this.updateProgress({ stage: 'failed', message: 'Collection generation failed' });

      if (error instanceof CollectionGeneratorError) {
        throw error;
      }

      throw new CollectionGeneratorError(
        `Failed to generate collection: ${error instanceof Error ? error.message : String(error)}`,
        'failed',
        error instanceof Error ? error : undefined
      );
    }
  }

  private async getTrendInsights(config: CollectionConfig, logger?: GenerationLogger): Promise<TrendInsights> {
    const isCelebrityBased = config.trendSource === 'celebrity';

    try {
      const cacheKey = isCelebrityBased
        ? `gemini:trend:celebrity:${config.demographic || 'unknown'}`
        : CACHE_KEYS.GEMINI_TREND(
            config.season || 'unknown',
            config.region || 'unknown',
            config.demographic || 'unknown'
          );

      const cachedTrends = await getCached<TrendInsights>(cacheKey);
      if (cachedTrends) {
        console.log('Cache HIT - Using cached trend insights');
        if (logger) {
          await logger.log('Cache Hit', { cacheKey, source: 'redis' }, 'info');
        }
        return cachedTrends;
      }

      console.log('Cache MISS - Fetching trends from backend API');

      const rateLimitResult = await checkRateLimit('gemini-trends', 100, 3600);
      if (!rateLimitResult.allowed) {
        throw new CollectionGeneratorError(
          `API rate limit exceeded. ${rateLimitResult.remaining} requests remaining.`,
          'trends'
        );
      }

      const trendSource = isCelebrityBased ? 'celebrity' : 'regional';

      const [trendRes, celebRes] = await Promise.all([
        apiFetchTrends({
          season: config.season,
          region: config.region,
          demographic: config.demographic,
          trend_source: trendSource,
        }),
        isCelebrityBased
          ? apiFetchCelebrities(config.demographic || 'millennials')
          : Promise.resolve(null),
      ]);

      const insights: TrendInsights = {
        colors: trendRes.insights?.colors || [],
        silhouettes: trendRes.insights?.silhouettes || [],
        materials: trendRes.insights?.materials || [],
        themes: trendRes.insights?.themes || [],
        celebrities: celebRes?.celebrities || trendRes.insights?.celebrities || [],
        summary: trendRes.insights?.summary || '',
      };

      if (logger) {
        await logger.log('Backend Trend Response', {
          colors: insights.colors.length,
          silhouettes: insights.silhouettes.length,
          materials: insights.materials.length,
          themes: insights.themes.length,
        }, 'info');
      }

      console.log('Saving trend insights to cache...');
      await setCached(cacheKey, insights, CACHE_TTL.GEMINI_TRENDS);

      if (logger) {
        await logger.log('Cache Saved', { cacheKey }, 'info');
      }

      return insights;
    } catch (error) {
      console.error('Trend analysis error:', error);

      if (error instanceof CollectionGeneratorError) {
        throw error;
      }

      throw new CollectionGeneratorError(
        `Failed to fetch trends: ${error instanceof Error ? error.message : 'Unknown error'}`,
        'trends'
      );
    }
  }

  private generateProducts(config: CollectionConfig, insights: TrendInsights): ProductDefinition[] {
    const products: ProductDefinition[] = [];
    let colorIndex = 0;

    if (config.categories.apparel) {
      const apparelTypes = this.getProductTypesFromTrends('apparel', insights, config.productCount.apparel);
      for (const subcategory of apparelTypes) {
        products.push(this.createProductDefinition('apparel', subcategory, insights, config, colorIndex));
        colorIndex++;
      }
    }

    if (config.categories.footwear) {
      const footwearTypes = this.getProductTypesFromTrends('footwear', insights, config.productCount.footwear);
      for (const subcategory of footwearTypes) {
        products.push(this.createProductDefinition('footwear', subcategory, insights, config, colorIndex));
        colorIndex++;
      }
    }

    if (config.categories.accessories) {
      const accessoryTypes = this.getProductTypesFromTrends('accessories', insights, config.productCount.accessories);
      for (const subcategory of accessoryTypes) {
        products.push(this.createProductDefinition('accessories', subcategory, insights, config, colorIndex));
        colorIndex++;
      }
    }

    return products;
  }

  private getProductTypesFromTrends(
    category: string,
    insights: TrendInsights,
    count: number
  ): string[] {
    const types: string[] = [];
    const hasSilhouettes = insights.silhouettes && insights.silhouettes.length > 0;
    const hasThemes = insights.themes && insights.themes.length > 0;

    for (let i = 0; i < count; i++) {
      if (category === 'apparel') {
        const defaultTypes = ['shirt', 'dress', 'jacket', 'pants', 'sweater', 'coat'];
        if (hasSilhouettes && insights.silhouettes[i % insights.silhouettes.length]) {
          const silhouetteName = insights.silhouettes[i % insights.silhouettes.length].name.toLowerCase();
          if (silhouetteName.includes('oversized') || silhouetteName.includes('loose') || silhouetteName.includes('relaxed')) {
            types.push(i % 2 === 0 ? 'jacket' : 'shirt');
          } else if (silhouetteName.includes('fitted') || silhouetteName.includes('tailored') || silhouetteName.includes('slim')) {
            types.push(i % 2 === 0 ? 'dress' : 'pants');
          } else if (silhouetteName.includes('layered') || silhouetteName.includes('structured')) {
            types.push(i % 2 === 0 ? 'coat' : 'jacket');
          } else {
            types.push(defaultTypes[i % defaultTypes.length]);
          }
        } else {
          types.push(defaultTypes[i % defaultTypes.length]);
        }
      } else if (category === 'footwear') {
        const defaultTypes = ['sneaker', 'boot', 'sandal', 'loafer', 'heel'];
        if (hasThemes && insights.themes[i % insights.themes.length]) {
          const themeName = insights.themes[i % insights.themes.length].name.toLowerCase();
          if (themeName.includes('athletic') || themeName.includes('sport') || themeName.includes('active')) {
            types.push('sneaker');
          } else if (themeName.includes('formal') || themeName.includes('luxury') || themeName.includes('elegant')) {
            types.push(i % 2 === 0 ? 'loafer' : 'heel');
          } else if (themeName.includes('outdoor') || themeName.includes('adventure')) {
            types.push('boot');
          } else if (themeName.includes('casual') || themeName.includes('comfort')) {
            types.push(i % 2 === 0 ? 'sneaker' : 'sandal');
          } else {
            types.push(defaultTypes[i % defaultTypes.length]);
          }
        } else {
          types.push(defaultTypes[i % defaultTypes.length]);
        }
      } else if (category === 'accessories') {
        const accessoryTypes = ['hat', 'belt', 'bag', 'scarf', 'jewelry', 'watch', 'sunglasses'];
        types.push(accessoryTypes[i % accessoryTypes.length]);
      }
    }

    return types;
  }

  private createProductDefinition(
    category: string,
    subcategory: string,
    insights: TrendInsights,
    config: CollectionConfig,
    productIndex: number = 0
  ): ProductDefinition {
    if (!insights.colors?.length) throw new Error('No trending colors available from analysis.');
    if (!insights.themes?.length) throw new Error('No fashion themes available from analysis.');
    if (!insights.materials?.length) throw new Error('No trending materials available from analysis.');
    if (!insights.silhouettes?.length) throw new Error('No trending silhouettes available from analysis.');

    const themeIndex = productIndex % insights.themes.length;
    const theme = insights.themes[themeIndex];
    const materialIndex = productIndex % insights.materials.length;
    const material = insights.materials[materialIndex];
    const primaryColorIndex = productIndex % insights.colors.length;
    const primaryColor = insights.colors[primaryColorIndex];

    const availableSecondaryIndices = insights.colors
      .map((_, idx) => idx)
      .filter(idx => idx !== primaryColorIndex);

    const numSecondaryColors = Math.min(availableSecondaryIndices.length, Math.floor(Math.random() * 2) + 1);
    const secondaryColors: typeof insights.colors[0][] = [];

    if (numSecondaryColors > 0 && availableSecondaryIndices.length > 0) {
      for (let i = 0; i < numSecondaryColors; i++) {
        const secondaryIndex = availableSecondaryIndices[(primaryColorIndex + i + 1) % availableSecondaryIndices.length];
        secondaryColors.push(insights.colors[secondaryIndex]);
      }
    }

    const productColors = [primaryColor, ...secondaryColors];
    const silhouetteIndex = productIndex % insights.silhouettes.length;
    const silhouette = insights.silhouettes[silhouetteIndex];
    const isCelebrityBased = config.trendSource === 'celebrity';

    const name = isCelebrityBased
      ? `Star ${silhouette.name} ${primaryColor.name} ${subcategory.charAt(0).toUpperCase() + subcategory.slice(1)}`
      : `${silhouette.name} ${primaryColor.name} ${subcategory.charAt(0).toUpperCase() + subcategory.slice(1)}`;

    const designStory = isCelebrityBased
      ? `Celebrity-inspired ${subcategory} capturing the essence of modern star fashion. ${theme.description}. Features the trending ${primaryColor.name} worn by top influencers.`
      : `Inspired by ${config.season} trends in ${config.region}. ${theme.description}.`;

    return {
      name,
      category,
      subcategory,
      description: `${silhouette.name} ${subcategory} featuring ${productColors.map(c => c.name).join(', ')}`,
      designStory,
      persona: config.demographic,
      colors: productColors.map(c => ({ name: c.name, hex: c.hex || '#000000' })),
      materials: [material.name],
      style: theme.name,
    };
  }

  private async generateImagesWithValidation(
    items: CollectionItem[],
    brandStyle: BrandStyleJSON,
    logger?: GenerationLogger
  ): Promise<{ successful: CollectionItem[]; failed: Array<{ item: CollectionItem; error: Error }> }> {
    return await retryBatch(
      items,
      async (item, index) => {
        this.updateProgress({
          stage: 'generating_images',
          message: `Generating image for ${item.name}...`,
          current: index + 1,
          total: items.length,
        });
        await this.generateImageForItemWithValidation(item, brandStyle, logger);
      },
      {
        maxRetries: 3,
        continueOnError: true,
        onRetry: (error, attempt, delay) => {
          console.warn(`Retrying image generation (attempt ${attempt}) after ${delay}ms:`, error.message);
        },
      }
    );
  }

  private async generateImageForItemWithValidation(
    item: CollectionItem,
    brandStyle: BrandStyleJSON,
    logger?: GenerationLogger
  ): Promise<void> {
    try {
      await collectionItemStorage.update(item.id, { status: 'designing' });

      const focalLengthValue = Math.round(36 / (2 * Math.tan((brandStyle.cameraSettings.fovDefault * Math.PI / 180) / 2)));

      const textPrompt = buildProductPrompt({
        name: item.name,
        category: item.category,
        description: item.design_story,
        colors: item.design_spec_json.colors.map(c => c.name),
        materials: item.design_spec_json.materials.map(m => m.name),
        style: item.design_spec_json.inspiration,
        brandStandards: {
          lightingIntensity: brandStyle.lightingConfig?.keyIntensity || 80,
          colorTemperature: brandStyle.lightingConfig?.colorTemperature || 5500,
          cameraAngle: brandStyle.cameraSettings?.angleDefault || 30,
          focalLength: focalLengthValue,
          negativePrompts: brandStyle.negativePrompts
        }
      });

      await collectionItemStorage.update(item.id, { status: 'generating' });

      const promptHash = hashObject({ textPrompt, brandStyle });
      const promptCacheKey = CACHE_KEYS.BRIA_STRUCTURED_PROMPT(promptHash);

      const cachedPrompt = await getCached<FIBOPromptJSON>(promptCacheKey);
      let structuredPrompt: FIBOPromptJSON;
      let imageUrl: string;

      if (cachedPrompt) {
        console.log(`Cache HIT for ${item.name} structured prompt`);
        structuredPrompt = cachedPrompt;

        if (logger) {
          await logger.log('Bria Prompt Cache Hit', { promptCacheKey }, 'info');
          await logger.logBriaPromptGeneration(item.name, textPrompt, cachedPrompt);
        }

        const brandNegatives = this.buildNegativePrompt(brandStyle);
        if (structuredPrompt.negative_prompt) {
          const existingNegatives = structuredPrompt.negative_prompt.split(',').map(s => s.trim());
          const brandNegativesList = brandNegatives.split(',').map(s => s.trim());
          const mergedNegatives = [...new Set([...existingNegatives, ...brandNegativesList])];
          structuredPrompt.negative_prompt = mergedNegatives.join(', ');
        } else {
          structuredPrompt.negative_prompt = brandNegatives;
        }

        const imageResponse = await this.briaApi.generateImage({
          structured_prompt: structuredPrompt,
          aspect_ratio: this.getAspectRatio(item.category),
          steps_num: 50,
          guidance_scale: 5,
          sync: true,
        });

        imageUrl = imageResponse.result_url || imageResponse.url || imageResponse.image_url || '';

        if (!imageUrl) {
          throw new BriaAPIError('No image URL returned from Bria image generation', 500);
        }
      } else {
        console.log(`Cache MISS for ${item.name} - Generating new structured prompt`);

        if (logger) {
          await logger.logBriaPromptGeneration(item.name, textPrompt, null);
        }

        const result = await this.briaApi.generateWithStructuredPrompt(
          textPrompt,
          {
            aspectRatio: this.getAspectRatio(item.category),
            negativePrompt: this.buildNegativePrompt(brandStyle),
            onStructuredPromptGenerated: async (promptData) => {
              let prompt = promptData;
              if (typeof promptData === 'string') {
                try {
                  prompt = JSON.parse(promptData);
                } catch (e) {
                  console.error('Failed to parse structured prompt:', e);
                  return promptData;
                }
              }

              const brandNegatives = this.buildNegativePrompt(brandStyle);
              if (prompt.negative_prompt) {
                const existingNegatives = prompt.negative_prompt.split(',').map(s => s.trim());
                const brandNegativesList = brandNegatives.split(',').map(s => s.trim());
                const mergedNegatives = [...new Set([...existingNegatives, ...brandNegativesList])];
                prompt.negative_prompt = mergedNegatives.join(', ');
              } else {
                prompt.negative_prompt = brandNegatives;
              }

              const validation = validateFIBOPrompt(prompt, brandStyle);

              if (logger) {
                await logger.logBriaPromptGeneration(item.name, textPrompt, prompt);
                await logger.logBrandValidation(item.name, validation, brandStyle);
              }

              await validationStorage.create({
                collection_item_id: item.id,
                compliance_score: validation.complianceScore,
                violations: validation.violations as any,
                auto_fixes_applied: [{
                  violationId: 'negative-prompt-merge',
                  field: 'negative_prompt',
                  originalValue: (promptData as any).negative_prompt || '',
                  fixedValue: prompt.negative_prompt,
                  appliedAt: new Date().toISOString()
                }] as any,
                original_prompt_json: promptData as any,
                fixed_prompt_json: prompt as any,
              });

              return prompt;
            },
          }
        );

        structuredPrompt = result.structuredPrompt;
        imageUrl = result.imageUrl;

        await setCached(promptCacheKey, structuredPrompt, CACHE_TTL.BRIA_PROMPTS);

        if (logger) {
          await logger.log('Bria Prompt Cached', { promptCacheKey }, 'info');
        }
      }

      // Upload to Supabase Storage for permanent URL
      let finalImageUrl = imageUrl;
      if (imageUrl && !isSupabaseStorageUrl(imageUrl)) {
        const storagePath = `collections/${item.collection_id}/${item.sku}`;
        const publicUrl = await uploadProductImage(imageUrl, storagePath);
        if (publicUrl) {
          finalImageUrl = publicUrl;
        }
        // Falls back to Bria URL if upload fails
      }

      const validations = await validationStorage.getByItemId(item.id);
      await collectionItemStorage.update(item.id, {
        fibo_prompt_json: structuredPrompt as any,
        image_url: finalImageUrl,
        brand_compliance_score: validations[0]?.compliance_score || 0,
        status: 'complete',
      });

      console.log(`Generated image for ${item.name}: ${finalImageUrl}`);

      if (logger) {
        await logger.logImageGeneration(item.name, imageUrl, 'bria-request-id');
      }
    } catch (error) {
      console.error(`Failed to generate image for ${item.name}:`, error);

      if (logger) {
        await logger.logError(`Image generation for ${item.name}`, error);
      }

      await collectionItemStorage.update(item.id, { status: 'failed' });
      throw error;
    }
  }

  private getAspectRatio(category: string): string {
    switch (category) {
      case 'footwear': return '4:3';
      case 'accessories': return '1:1';
      default: return '4:5';
    }
  }

  private buildNegativePrompt(brandStyle: BrandStyleJSON): string {
    const baseNegatives = ['blurry', 'low quality', 'distorted', 'watermark', 'text overlay'];
    return [...new Set([...baseNegatives, ...brandStyle.negativePrompts])].join(', ');
  }
}
