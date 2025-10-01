import { Period } from "../types";

export function getPeriodData(
  periods: Array<Period>,
  fallbackLen = 1
) {
  const periodLengths = periods.map((period) => {
    const num = Number(period?.length_h);
    return Number.isFinite(num) && num > 0 ? num : fallbackLen;
  });
  let acc = 0;
  const periodOffsets = periodLengths.map((len) => { 
    const off = acc;
    acc += len;
    return off; 
  });

  // Add the final boundary at totalHours
  const totalHours = Math.max(1, periodLengths.reduce((a, b) => a + b, 0));
  
  return { periodOffsets, totalHours };
}