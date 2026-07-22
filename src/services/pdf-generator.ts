/**
 * PDF Generator for Tech Packs
 *
 * Uses Foxit PDF Services API (server-side) to create professional
 * tech pack PDFs. The tech pack MUST be saved to DB first (single source of truth).
 */

import type { TechPack } from './techpack-generator';
import type { CollectionItem } from '../types/database';
import {
  generateTechPackPDF as apiGenerateTechPackPDF,
  generateTechPackDOCX as apiGenerateTechPackDOCX,
  createTechPackMiroBoard as apiCreateTechPackMiroBoard,
} from '../lib/api-client';

function base64ToBlob(base64: string, mimeType = 'application/pdf'): Blob {
  const binaryString = atob(base64);
  const bytes = new Uint8Array(binaryString.length);
  for (let i = 0; i < binaryString.length; i++) {
    bytes[i] = binaryString.charCodeAt(i);
  }
  return new Blob([bytes], { type: mimeType });
}

export class PDFGenerator {
  private buildPayload(item: CollectionItem) {
    return {
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
        color_palette: item.design_spec_json?.colors || [],
        season: item.design_spec_json?.season || '',
        silhouette: item.design_spec_json?.silhouette || '',
        fit: item.design_spec_json?.fit || '',
        materials: item.design_spec_json?.materials || [],
        details: item.design_spec_json?.details || [],
        inspiration: item.design_spec_json?.inspiration || '',
        design_story: item.design_story || '',
        image_url: item.image_url || '',
        video_url: item.video_url || '',
      },
      techpack: item.techpack_json,
    };
  }

  private assertTechPackSaved(item: CollectionItem) {
    if (!item.techpack_generated || !item.techpack_json) {
      throw new Error('Tech pack has not been generated yet. Please go to the Tech Pack tab first.');
    }
  }

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
    void techPack;
    this.assertTechPackSaved(item);

    const payload = this.buildPayload(item);
    const result = await apiGenerateTechPackPDF({
      product: payload.product,
      techpack: payload.techpack || undefined,
      brand_name: brandName || '',
    });

    return base64ToBlob(result.pdf_base64);
  }

  /**
   * Generate a professional tech pack DOCX using the same source payload as PDF.
   * Returns a Blob of the DOCX.
   */
  public async generateTechPackDOCX(
    item: CollectionItem,
    techPack: TechPack,
    brandName?: string,
  ): Promise<Blob> {
    void techPack;
    this.assertTechPackSaved(item);

    const payload = this.buildPayload(item);
    const result = await apiGenerateTechPackDOCX({
      product: payload.product,
      techpack: payload.techpack || undefined,
      brand_name: brandName || '',
    });

    return base64ToBlob(
      result.docx_base64,
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    );
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

  /**
   * Download the tech pack DOCX to the user's device.
   */
  public async downloadDOCX(
    item: CollectionItem,
    techPack: TechPack,
    brandName?: string,
  ): Promise<string> {
    const blob = await this.generateTechPackDOCX(item, techPack, brandName);
    const fileName = `tech-pack-${item.sku}-${new Date().toISOString().split('T')[0]}.docx`;

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

  /**
   * Create a new Miro board for the tech pack and email the board link.
   */
  public async sendToMiro(
    item: CollectionItem,
    techPack: TechPack,
    boardName?: string,
    brandName?: string,
  ): Promise<{ boardId: string; boardUrl: string; itemId: string; docUrl: string }> {
    void techPack;
    this.assertTechPackSaved(item);

    const payload = this.buildPayload(item);
    const result = await apiCreateTechPackMiroBoard({
      product: payload.product,
      techpack: payload.techpack || undefined,
      brand_name: brandName || '',
      board_name: boardName || '',
      x: 0,
      y: 0,
    });

    return {
      boardId: result.board_id,
      boardUrl: result.board_url,
      itemId: result.item_id,
      docUrl: result.doc_url,
    };
  }
}

export const pdfGenerator = new PDFGenerator();
