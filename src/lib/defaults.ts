import type { BrandStyleJSON } from '../types/database';

export const DEFAULT_BRAND_STYLE: BrandStyleJSON = {
  colorPalette: [
    { id: '1', name: 'Sage Green', hex: '#9DC183', designation: 'primary' },
    { id: '2', name: 'Terracotta', hex: '#E27B58', designation: 'secondary' },
    { id: '3', name: 'Sky Blue', hex: '#87CEEB', designation: 'accent' },
    { id: '4', name: 'Cream', hex: '#FFFDD0', designation: 'neutral' },
  ],
  cameraSettings: {
    fovMin: 40, fovMax: 80, fovDefault: 60,
    angleMin: 0, angleMax: 45, angleDefault: 30,
    distanceMin: 1, distanceMax: 10,
    heightMin: 0, heightMax: 2,
    allowedPresets: ['hero', 'detail', 'lifestyle', 'flatlay'],
  },
  lightingConfig: {
    keyIntensity: 80, fillIntensity: 40, rimIntensity: 20,
    colorTemperature: 5500, allowHDR: true, shadowSoftness: 0.7,
  },
  logoRules: {
    zone: 'bottom-right', minSize: 20, maxSize: 100,
    allowedPositions: [{ x: 0.8, y: 0.9 }], exclusionZones: [],
  },
  materialLibrary: [
    { id: '1', name: 'Organic Cotton', category: 'sustainable', description: 'Soft, breathable, eco-friendly cotton', seasons: ['spring', 'summer'] },
    { id: '2', name: 'Recycled Polyester', category: 'sustainable', description: 'Durable performance fabric from recycled materials', seasons: ['fall', 'winter'] },
  ],
  negativePrompts: ['cheap', 'tacky', 'gaudy', 'generic'],
  aspectRatios: [
    { width: 4, height: 5, name: 'Portrait' },
    { width: 1, height: 1, name: 'Square' },
    { width: 4, height: 3, name: 'Landscape' },
  ],
};
