import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export function sortColorCodes(a: string, b: string) {
  const codeA = (a || '').trim();
  const codeB = (b || '').trim();
  
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
}
