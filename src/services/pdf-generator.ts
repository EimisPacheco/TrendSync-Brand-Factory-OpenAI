/**
 * PDF Generator for Tech Packs
 *
 * Uses Foxit PDF Services API (server-side) to create professional
 * tech pack PDFs. The tech pack MUST be saved to DB first (single source of truth).
 */

import type { TechPack } from './techpack-generator';
import type { CollectionItem } from '../types/database';
import { generateTechPackPDF as apiGenerateTechPackPDF } from '../lib/api-client';
import { techPackGenerator } from './techpack-generator';

function base64ToBlob(base64: string, mimeType = 'application/pdf'): Blob {
  const binaryString = atob(base64);
  const bytes = new Uint8Array(binaryString.length);
  for (let i = 0; i < binaryString.length; i++) {
    bytes[i] = binaryString.charCodeAt(i);
  }
  return new Blob([bytes], { type: mimeType });
}

export class PDFGenerator {
  /**
   * Generate a professional tech pack PDF via Foxit API (server-side).
   * Requires the tech pack to be saved in the DB first.
   * Returns a Blob of the PDF.
   */
  public async generateTechPackPDF(
    item: CollectionItem,
    techPack: TechPack,
    brandName?: string,
  ): Promise<Blob> {
    // Check that techpack has been saved to DB
    if (!item.techpack_generated || !item.techpack_json) {
      throw new Error('Tech pack has not been generated yet. Please go to the Tech Pack tab first.');
    }

    // Convert TechPack to raw JSON for the backend
    const rawTechpack = item.techpack_json;

    const result = await apiGenerateTechPackPDF({
      product: {
        name: item.name,
        sku: item.sku,
        category: item.category,
        subcategory: item.subcategory,
        price_tier: item.price_tier,
        target_persona: item.target_persona,
        description: item.design_story || '',
        material:
          item.design_spec_json?.materials
            ?.map((m: { name?: string }) => (typeof m === 'string' ? m : m.name))
            .join(', ') || '',
        color_story:
          item.design_spec_json?.colors
            ?.map((c: { name?: string; hex?: string }) =>
              typeof c === 'string' ? c : `${c.name} (${c.hex})`,
            )
            .join(', ') || '',
        colors:
          item.design_spec_json?.colors
            ?.map((c: { name?: string; hex?: string }) =>
              typeof c === 'string' ? c : `${c.name} (${c.hex})`,
            )
            .join(', ') || '',
        season: item.design_spec_json?.season || '',
        silhouette: item.design_spec_json?.silhouette || '',
        fit: item.design_spec_json?.fit || '',
        materials: item.design_spec_json?.materials || [],
        details: item.design_spec_json?.details || [],
        inspiration: item.design_spec_json?.inspiration || '',
        design_story: item.design_story || '',
      },
      techpack: rawTechpack,
      brand_name: brandName || '',
    });

    return base64ToBlob(result.pdf_base64);
  }

  /**
   * Download the tech pack PDF to the user's device.
   */
  public async downloadPDF(
    item: CollectionItem,
    techPack: TechPack,
    brandName?: string,
  ): Promise<string> {
    const blob = await this.generateTechPackPDF(item, techPack, brandName);
    const fileName = `tech-pack-${item.sku}-${new Date().toISOString().split('T')[0]}.pdf`;

    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = fileName;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);

    return fileName;
  }
}

export const pdfGenerator = new PDFGenerator();
