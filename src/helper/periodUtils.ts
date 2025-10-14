import { Period } from "../types";

export function getPeriodData(
  periods: Period[],
  fallbackLen = 1
) {
  const periodLengths: number[] = periods.map((period) => {
    const num: number = Number(period?.length_h);
    return Number.isFinite(num) && num > 0 ? num : fallbackLen;
  });
  let acc = 0;
  const periodOffsets: number[] = periodLengths.map((len) => { 
    const off: number = acc;
    acc += len;
    return off; 
  });

  // Add the final boundary at totalHours
  const totalHours: number = Math.max(1, periodLengths.reduce((a, b) => a + b, 0));
  
  return { periodOffsets, totalHours };
}