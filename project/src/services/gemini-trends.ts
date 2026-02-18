import { GoogleGenerativeAI } from '@google/generative-ai';

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

export interface TrendInsights {
  colors: TrendingItem[];
  silhouettes: TrendingItem[];
  materials: TrendingItem[];
  themes: TrendingItem[];
  celebrities?: Celebrity[];
  summary: string;
}

export class GeminiTrendService {
  private genAI: GoogleGenerativeAI;

  constructor(apiKey: string) {
    this.genAI = new GoogleGenerativeAI(apiKey);
  }

  async fetchTrends(config: {
    season?: string;
    region?: string;
    demographic?: string;
    trendSource?: 'regional' | 'celebrity';
  }): Promise<TrendInsights> {
    const isCelebrityBased = config.trendSource === 'celebrity';

    const model = this.genAI.getGenerativeModel({
      model: 'gemini-2.5-flash-preview-05-20',
      generationConfig: {
        temperature: 0.7,
        maxOutputTokens: 4096,
        responseMimeType: 'application/json',
      },
      tools: [{ googleSearch: {} } as any],
    });

    const prompt = isCelebrityBased
      ? this.buildCelebrityPrompt(config.demographic || 'millennials')
      : this.buildRegionalPrompt(config);

    const result = await model.generateContent(prompt);
    const response = result.response;
    const text = response.text();

    let jsonContent = text.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();
    const jsonMatch = jsonContent.match(/\{[\s\S]*\}/);
    if (jsonMatch) jsonContent = jsonMatch[0];
    jsonContent = jsonContent.replace(/,\s*([}\]])/g, '$1');

    const trendData = JSON.parse(jsonContent);

    return this.transformToInsights(trendData, isCelebrityBased, config);
  }

  async fetchCelebrityList(demographic: string): Promise<Celebrity[]> {
    const model = this.genAI.getGenerativeModel({
      model: 'gemini-2.5-flash-preview-05-20',
      generationConfig: {
        temperature: 0.7,
        maxOutputTokens: 2048,
        responseMimeType: 'application/json',
      },
      tools: [{ googleSearch: {} } as any],
    });

    const prompt = `Search for and list the top 10 most influential fashion celebrities in 2024-2025 for the ${demographic} demographic. Include actors, musicians, athletes, and influencers.

Return a JSON array:
[
  {
    "name": "Celebrity Name",
    "profession": "Music/Film/Fashion/Sports/TV",
    "signature_style": "Their signature fashion style in 2-3 words",
    "influence_score": 95
  }
]`;

    const result = await model.generateContent(prompt);
    const text = result.response.text();

    let jsonContent = text.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();
    const jsonMatch = jsonContent.match(/\[[\s\S]*\]/);
    if (jsonMatch) jsonContent = jsonMatch[0];

    const celebrities = JSON.parse(jsonContent);
    return celebrities.map((celeb: any, idx: number) => ({
      ...celeb,
      influence_score: celeb.influence_score || (95 - idx * 3),
    }));
  }

  private buildCelebrityPrompt(demographic: string): string {
    return `Search for current fashion trends from 10 influential US celebrities (2024-2025) for the ${demographic} demographic.

Return a JSON object with these fields:
{
  "key_colors": [
    {"color": "Color name", "hex": "#HEXCODE", "description": "Which celebrities wear it"}
  ],
  "trending_styles": [
    {"name": "Style Name", "description": "Celebrity style description"}
  ],
  "materials": [
    {"name": "Material Name", "description": "How celebrities style it"}
  ],
  "themes": [
    {"name": "Theme Name", "description": "Theme description"}
  ],
  "celebrities": [
    {"name": "Name", "profession": "Profession", "signature_style": "Style"}
  ]
}

Include 4-6 colors with real hex codes, 3-5 styles, 3-5 materials, 2-3 themes, and 10 celebrities.`;
  }

  private buildRegionalPrompt(config: { season?: string; region?: string; demographic?: string }): string {
    return `Search for current fashion trends for ${config.demographic || 'millennials'} in ${config.region || 'global'} for ${config.season || 'Spring 2025'}.

Return a JSON object:
{
  "key_colors": [
    {"color": "Color name", "hex": "#HEXCODE", "description": "Why trending"}
  ],
  "trending_styles": [
    {"name": "Style Name", "description": "Style description"}
  ],
  "materials": [
    {"name": "Material Name", "description": "Why popular"}
  ],
  "themes": [
    {"name": "Theme Name", "description": "Theme description"}
  ]
}

Include 4-6 colors with real hex codes, 3-5 styles, 3-5 materials, and 2-3 themes based on current real-world fashion trend data.`;
  }

  private transformToInsights(
    trendData: any,
    isCelebrityBased: boolean,
    config: { season?: string; region?: string; demographic?: string }
  ): TrendInsights {
    if (!trendData.key_colors?.length) {
      throw new Error('No color trends returned from Gemini');
    }
    if (!trendData.trending_styles?.length) {
      throw new Error('No style trends returned from Gemini');
    }

    return {
      colors: trendData.key_colors.map((color: any, i: number) => ({
        name: color.color,
        hex: color.hex?.startsWith('#') ? color.hex : '#808080',
        confidence: 90 - i * 5,
        description: color.description,
      })),
      silhouettes: trendData.trending_styles.map((style: any, i: number) => ({
        name: style.name,
        confidence: 88 - i * 5,
        description: style.description,
      })),
      materials: (trendData.materials || []).map((material: any, i: number) => ({
        name: material.name,
        confidence: 85 - i * 5,
        description: material.description,
      })),
      themes: (trendData.themes || []).map((theme: any, i: number) => ({
        name: theme.name,
        confidence: 87 - i * 5,
        description: theme.description,
      })),
      celebrities: isCelebrityBased && trendData.celebrities
        ? trendData.celebrities.map((celeb: any, i: number) => ({
            name: celeb.name,
            profession: celeb.profession,
            signature_style: celeb.signature_style,
            influence_score: 95 - i * 5,
          }))
        : undefined,
      summary: isCelebrityBased
        ? `Celebrity fashion trends for ${config.demographic} inspired by top influencers`
        : `Fashion trends for ${config.demographic} in ${config.region} for ${config.season}`,
    };
  }
}
