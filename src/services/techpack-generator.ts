import type { CollectionItem } from '../types/database';

interface TechPackSection {
  title: string;
  content: any;
  subsections?: TechPackSection[];
}

export interface TechPack {
  fabricType: TechPackSection;
  measurements: TechPackSection;
  graphics: TechPackSection;
  adornments: TechPackSection;
  construction: TechPackSection;
  qualityControl: TechPackSection;
  packaging: TechPackSection;
}

import { generateTechPack as apiGenerateTechPack } from '../lib/api-client';

export class TechPackGenerator {
  async generateTechPack(item: CollectionItem): Promise<TechPack> {
    console.log(`Generating tech pack for ${item.name}...`);

    try {
      const result = await apiGenerateTechPack({
        name: item.name,
        category: item.category,
        subcategory: item.subcategory,
        description: item.design_story,
        materials: item.design_spec_json?.materials?.map((m: any) => typeof m === 'string' ? m : m.name).join(', '),
        colors: item.design_spec_json?.colors?.map((c: any) => typeof c === 'string' ? c : c.name).join(', '),
        style: item.design_spec_json?.inspiration || 'Contemporary',
        season: item.design_spec_json?.season || 'Current',
      });

      if (result.techpack) {
        const techPack = this.formatTechPack(result.techpack as any, item);
        console.log('Tech pack generated via backend');
        return techPack;
      }

      return this.createDefaultTechPack(item);
    } catch (error) {
      console.error('Tech pack generation failed, using default:', error);
      return this.createDefaultTechPack(item);
    }
  }

  private buildTechPackPrompt(item: CollectionItem): string {
    return `Generate a comprehensive fashion tech pack for the following product:

Product: ${item.name}
Category: ${item.category}
Subcategory: ${item.subcategory}
Description: ${item.design_story}
Materials: ${item.design_spec_json?.materials?.map((m: any) => typeof m === 'string' ? m : m.name).join(', ')}
Colors: ${item.design_spec_json?.colors?.map((c: any) => typeof c === 'string' ? c : c.name).join(', ')}
Style: ${item.design_spec_json?.inspiration || 'Contemporary'}
Season: ${item.design_spec_json?.season || 'Current'}

Please provide a detailed technical specification document in the following JSON structure:

{
  "fabricType": {
    "fabricTreatment": {
      "material": "detailed material composition",
      "printDesign": "print and pattern details",
      "surface": "texture and finish details",
      "care": "care instructions",
      "specialNotes": "any special requirements"
    }
  },
  "measurements": {
    "sizeChart": {
      "sizes": ["XS", "S", "M", "L", "XL"],
      "measurements": {
        "chest": [],
        "waist": [],
        "hip": [],
        "length": []
      }
    },
    "tolerances": "measurement tolerances",
    "fitNotes": "fit specifications"
  },
  "graphics": {
    "fabricAndColor": "color specifications",
    "pattern": "pattern details",
    "construction": "construction method",
    "buttons": "button/closure specs",
    "cuffsAndHem": "finishing details",
    "stitches": "stitch types and specs",
    "texture": "texture requirements"
  },
  "adornments": {
    "hardware": "hardware specifications",
    "labels": "label placement and specs",
    "embellishments": "decorative elements",
    "branding": "branding application"
  },
  "construction": {
    "assembly": "step-by-step assembly instructions",
    "stitching": "stitching specifications",
    "seaming": "seam types and finishes",
    "reinforcement": "stress point reinforcement"
  },
  "qualityControl": {
    "inspection": "inspection criteria",
    "testing": "required tests",
    "standards": "quality standards",
    "defects": "acceptable quality levels"
  },
  "packaging": {
    "individual": "individual packaging specs",
    "bulk": "bulk packaging requirements",
    "labeling": "package labeling",
    "shipping": "shipping requirements"
  }
}

Ensure all specifications are professional, detailed, and suitable for manufacturing.`;
  }

  private parseGeneratedTechPack(generatedText: string, item: CollectionItem): TechPack {
    try {
      // Clean up the response - remove markdown code blocks if present
      let cleanedText = generatedText
        .replace(/```json\n?/gi, '')
        .replace(/```\n?/g, '')
        .trim();

      // Try to extract JSON from the generated text
      // Look for the first { and last } to get the JSON object
      const startIndex = cleanedText.indexOf('{');
      const endIndex = cleanedText.lastIndexOf('}');

      if (startIndex === -1 || endIndex === -1 || startIndex >= endIndex) {
        console.error('❌ No valid JSON structure found in response');
        console.log('Response text:', cleanedText.substring(0, 500));
        // Return a default tech pack if parsing fails
        return this.createDefaultTechPack(item);
      }

      let jsonString = cleanedText.substring(startIndex, endIndex + 1);

      // More aggressive JSON cleanup
      // 1. Fix broken string values (missing quotes)
      jsonString = jsonString.replace(/:\s*([^",\[\{\}\]]+)([,\}])/g, (match, value, delimiter) => {
        const trimmed = value.trim();
        // Check if it's already a valid JSON value
        if (trimmed === 'true' || trimmed === 'false' || trimmed === 'null' || !isNaN(Number(trimmed))) {
          return `: ${trimmed}${delimiter}`;
        }
        // Otherwise wrap in quotes
        return `: "${trimmed}"${delimiter}`;
      });

      // 2. Fix line breaks within string values
      jsonString = jsonString.replace(/"([^"]*)\n([^"]*?)"/g, '"$1 $2"');

      // 3. Remove trailing commas
      jsonString = jsonString
        .replace(/,\s*\}/g, '}')
        .replace(/,\s*\]/g, ']');

      // 4. Fix multiple commas
      jsonString = jsonString.replace(/,\s*,+/g, ',');

      // 5. Fix empty values
      jsonString = jsonString.replace(/:\s*,/g, ': "",');

      // 6. Remove control characters
      jsonString = jsonString.replace(/[\x00-\x1F\x7F]/g, ' ');

      // 7. Fix unclosed strings (basic attempt)
      let quoteCount = (jsonString.match(/"/g) || []).length;
      if (quoteCount % 2 !== 0) {
        console.warn('⚠️ Unbalanced quotes detected, attempting to fix...');
        // Try to add a closing quote before the last }
        jsonString = jsonString.replace(/([^"])(\s*\})$/, '$1"$2');
      }

      // Log the cleaned JSON for debugging
      console.log('🔧 Cleaned JSON (first 500 chars):', jsonString.substring(0, 500));

      const parsed = JSON.parse(jsonString);
      console.log('✅ PARSED TECH PACK STRUCTURE KEYS:', Object.keys(parsed));
      return this.formatTechPack(parsed, item);
    } catch (error: any) {
      console.error('❌ TECH PACK PARSE ERROR:', error.message);

      // Try to identify the exact location of the error
      if (error.message.includes('position')) {
        const position = parseInt(error.message.match(/position (\d+)/)?.[1] || '0');
        if (position > 0 && generatedText.length > position) {
          console.log('Error context:', generatedText.substring(Math.max(0, position - 50), Math.min(generatedText.length, position + 50)));
        }
      }

      console.log('📋 Creating default tech pack as fallback...');
      // Fallback to a default tech pack if parsing fails
      return this.createDefaultTechPack(item);
    }
  }

  private formatTechPack(parsed: any, item: CollectionItem): TechPack {
    return {
      fabricType: {
        title: 'Fabric Type',
        content: parsed.fabricType || {},
        subsections: [
          {
            title: 'Fabric Treatment',
            content: {
              material: parsed.fabricType?.fabricTreatment?.material || this.getDefaultMaterial(item),
              printDesign: parsed.fabricType?.fabricTreatment?.printDesign || 'As per design',
              surface: parsed.fabricType?.fabricTreatment?.surface || 'Standard finish',
              care: parsed.fabricType?.fabricTreatment?.care || 'Machine wash cold, tumble dry low',
              specialNotes: parsed.fabricType?.fabricTreatment?.specialNotes || 'None'
            }
          }
        ]
      },
      measurements: {
        title: 'Measurements',
        content: parsed.measurements || {},
        subsections: [
          {
            title: 'Size Chart',
            content: this.generateSizeChart(item, parsed.measurements)
          },
          {
            title: 'Fit Specifications',
            content: {
              fit: parsed.measurements?.fitNotes || this.getDefaultFit(item),
              tolerances: parsed.measurements?.tolerances || '±0.5cm for all measurements'
            }
          }
        ]
      },
      graphics: {
        title: 'Graphics & Details',
        content: parsed.graphics || {},
        subsections: [
          {
            title: 'Color & Pattern',
            content: {
              colors: item.design_spec_json?.colors || [],
              pattern: parsed.graphics?.pattern || 'Solid/Pattern as per design',
              placement: 'As per approved artwork'
            }
          },
          {
            title: 'Construction Details',
            content: {
              construction: parsed.graphics?.construction || this.getDefaultConstruction(item),
              stitches: parsed.graphics?.stitches || 'Lock stitch, 10-12 SPI',
              seams: 'French seams for durability',
              finishing: parsed.graphics?.cuffsAndHem || 'Clean finish all edges'
            }
          }
        ]
      },
      adornments: {
        title: 'Adornments & Hardware',
        content: parsed.adornments || {},
        subsections: [
          {
            title: 'Hardware Specifications',
            content: {
              zippers: this.getZipperSpecs(item),
              buttons: parsed.adornments?.buttons || this.getButtonSpecs(item),
              other: parsed.adornments?.hardware || 'As per design requirements'
            }
          },
          {
            title: 'Branding Elements',
            content: {
              mainLabel: 'Woven main label with brand logo',
              careLabel: 'Printed care label with symbols',
              hangTag: 'Custom branded hang tag',
              placement: parsed.adornments?.branding || 'As per brand guidelines'
            }
          }
        ]
      },
      construction: {
        title: 'Construction Process',
        content: parsed.construction || {},
        subsections: [
          {
            title: 'Assembly Instructions',
            content: {
              step1: 'Cut all pattern pieces according to markers',
              step2: 'Prepare components (interfacing, lining if applicable)',
              step3: parsed.construction?.assembly || this.getAssemblySteps(item),
              step4: 'Quality check at each stage',
              step5: 'Final pressing and finishing'
            }
          },
          {
            title: 'Technical Specifications',
            content: {
              stitching: parsed.construction?.stitching || '301 lockstitch for seams',
              seamAllowance: '1.5cm standard seam allowance',
              reinforcement: parsed.construction?.reinforcement || 'Bar tacks at stress points',
              threading: 'Color-matched polyester thread'
            }
          }
        ]
      },
      qualityControl: {
        title: 'Quality Control',
        content: parsed.qualityControl || {},
        subsections: [
          {
            title: 'Inspection Criteria',
            content: {
              visual: 'No visible defects, stains, or loose threads',
              dimensional: 'All measurements within tolerance',
              functional: 'All closures and features fully functional',
              aesthetic: parsed.qualityControl?.inspection || 'Consistent appearance across production'
            }
          },
          {
            title: 'Testing Requirements',
            content: {
              colorFastness: 'Grade 4 minimum for color fastness',
              shrinkage: 'Maximum 3% shrinkage after wash',
              durability: parsed.qualityControl?.testing || 'Tensile strength test for seams',
              safety: 'Compliance with relevant safety standards'
            }
          },
          {
            title: 'AQL Standards',
            content: {
              critical: '0 defects accepted',
              major: 'AQL 2.5',
              minor: 'AQL 4.0',
              sampling: parsed.qualityControl?.standards || 'As per AQL inspection standard'
            }
          }
        ]
      },
      packaging: {
        title: 'Packaging & Shipping',
        content: parsed.packaging || {},
        subsections: [
          {
            title: 'Individual Packaging',
            content: {
              folding: 'Professional folding with tissue paper',
              polybag: 'Clear recyclable polybag with warning',
              labeling: 'Size sticker and barcode on polybag',
              protection: parsed.packaging?.individual || 'Silica gel packet if required'
            }
          },
          {
            title: 'Bulk Packaging',
            content: {
              cartonSize: 'Standard export carton 60x40x50cm',
              quantity: this.getPackingQuantity(item),
              protection: 'Moisture-proof lining',
              marking: parsed.packaging?.bulk || 'Carton marking as per shipping requirements'
            }
          }
        ]
      }
    };
  }

  private createDefaultTechPack(item: CollectionItem): TechPack {
    console.log('📋 Creating default tech pack for:', item.name);

    // Create a basic but comprehensive tech pack structure
    const defaultStructure = {
      fabricType: {
        fabricTreatment: {
          material: this.getDefaultMaterial(item),
          printDesign: 'As per approved design and artwork',
          surface: 'Standard finish appropriate for material',
          care: 'Machine wash cold, tumble dry low, iron on medium',
          specialNotes: 'Ensure colorfastness and shrinkage within standards'
        }
      },
      measurements: {
        sizeChart: this.generateSizeChart(item, {}),
        tolerances: '±0.5cm for all measurements',
        fitNotes: this.getDefaultFit(item)
      },
      graphics: {
        fabricAndColor: item.design_spec_json?.colors?.map((c: any) =>
          typeof c === 'string' ? c : c.name
        ).join(', ') || 'As per design',
        pattern: item.design_spec_json?.pattern || 'Solid or as per design',
        construction: this.getDefaultConstruction(item),
        buttons: this.getButtonSpecs(item),
        cuffsAndHem: 'Clean finish with appropriate hemming',
        stitches: 'Lock stitch, 10-12 stitches per inch',
        texture: item.design_spec_json?.texture || 'As per material specification'
      },
      adornments: {
        hardware: this.getZipperSpecs(item) !== 'N/A' ? this.getZipperSpecs(item) : 'As per design',
        labels: 'Main label, care label, size label as per brand standards',
        embellishments: 'As shown in design reference',
        branding: 'Logo placement as per brand guidelines'
      },
      construction: {
        assembly: this.getAssemblySteps(item),
        stitching: '301 lockstitch for main seams, overlock for raw edges',
        seaming: 'French seams or overlock as appropriate',
        reinforcement: 'Bar tacks at all stress points'
      },
      qualityControl: {
        inspection: '100% inspection for first production, then AQL sampling',
        testing: 'Color fastness, shrinkage, tensile strength tests required',
        standards: 'AQL 2.5 for major defects, AQL 4.0 for minor',
        defects: 'Zero tolerance for critical defects'
      },
      packaging: {
        individual: 'Folded with tissue, individual polybag with warning label',
        bulk: `Export carton, ${this.getPackingQuantity(item)}`,
        labeling: 'Size sticker, barcode, and care instructions',
        shipping: 'As per buyer requirements and destination regulations'
      }
    };

    return this.formatTechPack(defaultStructure, item);
  }

  private generateFallbackTechPack(item: CollectionItem): TechPack {
    // This method is kept for backward compatibility
    return this.createDefaultTechPack(item);
  }

  private getDefaultMaterial(item: CollectionItem): string {
    const materials = item.design_spec_json?.materials || [];
    if (materials.length > 0) {
      const primary = materials[0];
      const materialName = typeof primary === 'string' ? primary : primary.name;

      switch (item.category.toLowerCase()) {
        case 'apparel':
          return `${materialName} - Premium quality, ${this.getMaterialWeight(item.subcategory)} weight`;
        case 'footwear':
          return `Upper: ${materialName}, Sole: Rubber/EVA composite, Lining: Breathable mesh`;
        case 'accessories':
          return `${materialName} with reinforced construction`;
        default:
          return materialName;
      }
    }
    return 'As per design specification';
  }

  private getMaterialWeight(subcategory: string): string {
    const weights: Record<string, string> = {
      'shirt': '120-150 GSM',
      'dress': '150-200 GSM',
      'jacket': '280-350 GSM',
      'pants': '200-250 GSM',
      'sweater': '300-400 GSM',
      'coat': '400-500 GSM',
      'default': '180-220 GSM'
    };
    return weights[subcategory.toLowerCase()] || weights.default;
  }

  private getDefaultFit(item: CollectionItem): string {
    const fits: Record<string, string> = {
      'shirt': 'Regular fit with standard ease',
      'dress': 'Fitted bodice with flared skirt',
      'jacket': 'Relaxed fit with movement ease',
      'pants': 'Slim fit with comfort stretch',
      'sweater': 'Comfortable relaxed fit',
      'coat': 'Classic fit with layering room',
      'sneaker': 'True to size with comfort insole',
      'boot': 'Standard width with ankle support',
      'hat': 'Adjustable fit with size band',
      'bag': 'Ergonomic design with adjustable straps',
      'belt': 'Standard sizing with 5-hole adjustment'
    };
    return fits[item.subcategory.toLowerCase()] || 'Standard fit as per size chart';
  }

  private getDefaultConstruction(item: CollectionItem): string {
    switch (item.category.toLowerCase()) {
      case 'apparel':
        return 'Cut and sew construction with reinforced seams';
      case 'footwear':
        return 'Cemented construction with vulcanized sole attachment';
      case 'accessories':
        return 'Precision crafted with attention to detail';
      default:
        return 'Professional construction methods';
    }
  }

  private generateSizeChart(item: CollectionItem, measurements: any): any {
    if (item.category.toLowerCase() === 'apparel') {
      return {
        sizes: ['XS', 'S', 'M', 'L', 'XL', 'XXL'],
        chest: [86, 91, 96, 101, 106, 111],
        waist: [71, 76, 81, 86, 91, 96],
        hip: [91, 96, 101, 106, 111, 116],
        length: this.getLengthMeasurements(item.subcategory)
      };
    } else if (item.category.toLowerCase() === 'footwear') {
      return {
        sizes: ['36', '37', '38', '39', '40', '41', '42', '43', '44'],
        us: ['5', '6', '7', '8', '9', '10', '11', '12', '13'],
        uk: ['3', '4', '5', '6', '7', '8', '9', '10', '11'],
        cm: ['22.5', '23.5', '24', '25', '25.5', '26.5', '27', '28', '28.5']
      };
    }
    return measurements?.sizeChart || { note: 'One size or as per design' };
  }

  private getLengthMeasurements(subcategory: string): number[] {
    const lengths: Record<string, number[]> = {
      'shirt': [68, 70, 72, 74, 76, 78],
      'dress': [85, 87, 89, 91, 93, 95],
      'jacket': [60, 62, 64, 66, 68, 70],
      'pants': [101, 103, 105, 107, 109, 111],
      'sweater': [62, 64, 66, 68, 70, 72],
      'coat': [85, 87, 89, 91, 93, 95]
    };
    return lengths[subcategory.toLowerCase()] || [70, 72, 74, 76, 78, 80];
  }

  private getZipperSpecs(item: CollectionItem): string {
    const category = item.category.toLowerCase();
    const subcategory = item.subcategory.toLowerCase();

    if (category === 'apparel') {
      if (subcategory === 'jacket' || subcategory === 'coat') {
        return 'YKK #5 metal zipper, two-way, antique brass finish';
      } else if (subcategory === 'dress') {
        return 'YKK #3 invisible zipper, color-matched';
      } else if (subcategory === 'pants') {
        return 'YKK #4 metal zipper with button closure';
      }
    } else if (category === 'accessories' && subcategory === 'bag') {
      return 'YKK #8 chunky zipper with custom pull';
    }
    return 'N/A';
  }

  private getButtonSpecs(item: CollectionItem): string {
    const subcategory = item.subcategory.toLowerCase();

    if (subcategory === 'shirt') {
      return '11mm 4-hole flat buttons, color-matched';
    } else if (subcategory === 'jacket' || subcategory === 'coat') {
      return '20mm custom branded metal buttons';
    } else if (subcategory === 'pants') {
      return '17mm metal shank button with rivets';
    }
    return 'As per design';
  }

  private getAssemblySteps(item: CollectionItem): string {
    const category = item.category.toLowerCase();

    if (category === 'apparel') {
      return `1. Join shoulder seams
2. Attach sleeves/armholes
3. Close side seams
4. Attach collar/neckline finishing
5. Hem bottom and sleeves
6. Add closures and trim
7. Final pressing`;
    } else if (category === 'footwear') {
      return `1. Cut upper pattern pieces
2. Stitch upper assembly
3. Attach lining
4. Last the upper
5. Attach midsole
6. Cement outsole
7. Finish and quality check`;
    } else if (category === 'accessories') {
      return `1. Cut main body pieces
2. Prepare hardware and attachments
3. Assemble main structure
4. Attach straps/handles
5. Add lining if applicable
6. Install closures
7. Final finishing`;
    }
    return 'As per standard construction methods';
  }

  private getPackingQuantity(item: CollectionItem): string {
    const category = item.category.toLowerCase();

    if (category === 'apparel') {
      return '24-36 pieces per carton (size ratio packed)';
    } else if (category === 'footwear') {
      return '12-18 pairs per carton';
    } else if (category === 'accessories') {
      return '48-72 pieces per carton';
    }
    return 'As per order quantity';
  }

  /**
   * Convert a saved raw JSON (from DB) back into a TechPack object.
   * The raw JSON is what toRawJson() produced.
   */
  formatFromSaved(raw: Record<string, any>, item: CollectionItem): TechPack {
    return this.formatTechPack(raw, item);
  }

  /**
   * Convert a TechPack into a plain JSON object for DB storage.
   * Extracts the content from each section so it can be round-tripped.
   */
  toRawJson(techPack: TechPack): Record<string, any> {
    const extractContent = (section: TechPackSection) => {
      if (section.subsections && section.subsections.length > 0) {
        const result: Record<string, any> = {};
        for (const sub of section.subsections) {
          const key = sub.title.replace(/[^a-zA-Z0-9]/g, '').replace(/^./, c => c.toLowerCase());
          result[key] = sub.content;
        }
        return result;
      }
      return section.content;
    };

    return {
      fabricType: extractContent(techPack.fabricType),
      measurements: extractContent(techPack.measurements),
      graphics: extractContent(techPack.graphics),
      adornments: extractContent(techPack.adornments),
      construction: extractContent(techPack.construction),
      qualityControl: extractContent(techPack.qualityControl),
      packaging: extractContent(techPack.packaging),
    };
  }
}

export const techPackGenerator = new TechPackGenerator();