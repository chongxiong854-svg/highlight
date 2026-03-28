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
      } else if (onProgress) {
        if (m.status === 'loading tesseract core') onProgress(0.02);
        if (m.status === 'loading language traineddata') onProgress(0.03 + (m.progress || 0) * 0.05);
        if (m.status === 'initializing api') onProgress(0.09);
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

  const fullImageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
  const pixelData = fullImageData.data;
  const width = canvas.width;

  // Helper to get average color of the top-left region to avoid center text
  const getAverageColor = (x: number, y: number, w: number, h: number) => {
    const startX = Math.floor(x + w * 0.1);
    const startY = Math.floor(y + h * 0.1);
    const endX = Math.floor(startX + w * 0.25);
    const endY = Math.floor(startY + h * 0.25);
    
    let r = 0, g = 0, b = 0;
    let count = 0;
    
    for (let py = startY; py < endY; py++) {
      for (let px = startX; px < endX; px++) {
        if (px >= 0 && px < width && py >= 0 && py < canvas.height) {
          const idx = (py * width + px) * 4;
          r += pixelData[idx];
          g += pixelData[idx + 1];
          b += pixelData[idx + 2];
          count++;
        }
      }
    }
    
    if (count === 0) return { r: 255, g: 255, b: 255 };

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

  // Process cells in chunks to avoid blocking the main thread
  const chunkSize = 500;
  for (let i = 0; i < cells.length; i += chunkSize) {
    const chunk = cells.slice(i, i + chunkSize);
    for (const cell of chunk) {
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
    
    if (onProgress) {
      onProgress(0.7 + (i / cells.length) * 0.2); // 0.7 to 0.9
    }
    // Yield to main thread
    await new Promise(resolve => setTimeout(resolve, 0));
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

  const groups = Array.from(groupMap.values()).sort((a, b) => {
    const codeA = (a.code || '').trim();
    const codeB = (b.code || '').trim();
    
    const matchA = codeA.match(/^([A-Za-z]*)(.*)$/);
    const matchB = codeB.match(/^([A-Za-z]*)(.*)$/);
    
    const lettersA = (matchA ? matchA[1] : '').toUpperCase();
    const lettersB = (matchB ? matchB[1] : '').toUpperCase();
    
    if (lettersA !== lettersB) {
      return lettersA.localeCompare(lettersB);
    }
    
    const numA = parseInt(matchA ? matchA[2] : '0', 10);
    const numB = parseInt(matchB ? matchB[2] : '0', 10);
    
    if (!isNaN(numA) && !isNaN(numB) && numA !== numB) {
      return numA - numB;
    }
    
    return codeA.localeCompare(codeB, undefined, { numeric: true, sensitivity: 'base' });
  });

  if (onProgress) onProgress(1.0);

  return { parsedCells, groups };
}
