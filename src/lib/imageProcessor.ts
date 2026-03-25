import Tesseract from 'tesseract.js';
import { STANDARD_COLORS, findClosestColor } from './colorMap';

export interface ParsedCell {
  row: number;
  col: number;
  colorCode: string;
  color: string;
  originalColor: string;
  groupId: string;
}

export interface ColorGroup {
  id: string;
  code: string;
  count: number;
  color: string;
}

export async function processGrid(
  cells: { x: number; y: number; width: number; height: number; row: number; col: number }[],
  imageElement: HTMLImageElement,
  rows: number,
  cols: number,
  onProgress?: (progress: number) => void
): Promise<{ parsedCells: ParsedCell[], groups: ColorGroup[] }> {
  
  const canvas = document.createElement('canvas');
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Could not get canvas context');

  canvas.width = imageElement.width;
  canvas.height = imageElement.height;
  ctx.drawImage(imageElement, 0, 0);

  if (onProgress) onProgress(0.1);

  // 1. Run Tesseract on the whole image
  const worker = await Tesseract.createWorker('eng', 1, {
    logger: m => {
      if (m.status === 'recognizing text' && onProgress) {
        onProgress(0.1 + m.progress * 0.5); // 0.1 to 0.6
      }
    }
  });
  
  const { data } = await worker.recognize(imageElement);
  await worker.terminate();

  if (onProgress) onProgress(0.6);

  // 2. Map words to cells
  const cellTextMap = new Map<string, string>();
  const words = (data as any)?.words || [];
  
  for (const word of words) {
    const cx = (word.bbox.x0 + word.bbox.x1) / 2;
    const cy = (word.bbox.y0 + word.bbox.y1) / 2;
    
    for (const cell of cells) {
      if (cx >= cell.x && cx <= cell.x + cell.width && cy >= cell.y && cy <= cell.y + cell.height) {
        const key = `${cell.row},${cell.col}`;
        const existing = cellTextMap.get(key) || "";
        const cleanText = word.text.replace(/[^A-Za-z0-9]/g, '').toUpperCase();
        if (cleanText) {
          cellTextMap.set(key, existing + cleanText);
        }
        break;
      }
    }
  }

  if (onProgress) onProgress(0.7);

  // Helper to get average color of the top-left region to avoid center text
  const getAverageColor = (x: number, y: number, w: number, h: number) => {
    const cx = x + w * 0.1;
    const cy = y + h * 0.1;
    const cw = w * 0.25;
    const ch = h * 0.25;
    
    const imageData = ctx.getImageData(cx, cy, cw, ch);
    const data = imageData.data;
    let r = 0, g = 0, b = 0;
    const count = data.length / 4;
    
    for (let i = 0; i < data.length; i += 4) {
      r += data[i];
      g += data[i + 1];
      b += data[i + 2];
    }
    
    return {
      r: Math.round(r / count),
      g: Math.round(g / count),
      b: Math.round(b / count)
    };
  };

  const colorDistance = (c1: {r: number, g: number, b: number}, c2: {r: number, g: number, b: number}) => {
    return Math.sqrt(Math.pow(c1.r - c2.r, 2) + Math.pow(c1.g - c2.g, 2) + Math.pow(c1.b - c2.b, 2));
  };

  const rgbToHex = (r: number, g: number, b: number) => 
    '#' + [r, g, b].map(x => x.toString(16).padStart(2, '0')).join('');

  const uniqueColors: { r: number, g: number, b: number, hex: string, id: string }[] = [];
  let colorCounter = 1;

  const parsedCells: ParsedCell[] = [];

  for (const cell of cells) {
    const avgColor = getAverageColor(cell.x, cell.y, cell.width, cell.height);
    
    // Find closest existing color group
    let matchedGroup = null;
    for (const uc of uniqueColors) {
      if (colorDistance(avgColor, uc) < 25) { // Threshold for color similarity
        matchedGroup = uc;
        break;
      }
    }

    if (!matchedGroup) {
      matchedGroup = {
        ...avgColor,
        hex: rgbToHex(avgColor.r, avgColor.g, avgColor.b),
        id: `G${colorCounter++}`
      };
      uniqueColors.push(matchedGroup);
    }

    const key = `${cell.row},${cell.col}`;
    let rawText = cellTextMap.get(key) || "";
    
    // Validate text: should be like A1, B12, M5, etc.
    let colorCode = "";
    const match = rawText.match(/([A-Z][0-9]{1,2})/);
    if (match) {
      colorCode = match[1];
    }

    parsedCells.push({
      row: cell.row,
      col: cell.col,
      colorCode: colorCode, // Might be empty
      color: matchedGroup.hex,
      originalColor: matchedGroup.hex,
      groupId: matchedGroup.id
    });
  }

  if (onProgress) onProgress(0.9);

  // Determine the most frequent code for each group
  const groupMap = new Map<string, ColorGroup>();
  
  for (const uc of uniqueColors) {
    let standardColor = STANDARD_COLORS.find(c => c.hex.toLowerCase() === uc.hex.toLowerCase());
    if (!standardColor) {
      standardColor = findClosestColor(uc.hex);
    }
    
    groupMap.set(uc.id, {
      id: uc.id,
      code: standardColor.code,
      count: 0,
      color: standardColor.hex.toLowerCase()
    });
  }

  // Assign the best code to all cells in the group and count
  for (const cell of parsedCells) {
    const group = groupMap.get(cell.groupId)!;
    cell.colorCode = group.code; // Unify code for the group
    cell.color = group.color; // Unify color for the group
    group.count++;
  }

  const groups = Array.from(groupMap.values()).sort((a, b) => b.count - a.count);

  if (onProgress) onProgress(1.0);

  return { parsedCells, groups };
}
