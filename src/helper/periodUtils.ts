export function getPeriodData(
  periods: string[],
  periodLengthTable: Array<{ period: string; length_hrs: number }>,
  fallbackLen = 40
) {
  const periodLengths = periods.map((name, idx) => {
    const entry = periodLengthTable.find((e) => e && e.period === name) ?? periodLengthTable[idx];
    const num = Number(entry?.length_hrs);
    return Number.isFinite(num) && num > 0 ? num : fallbackLen;
  });
  let acc = 0;
  const periodOffsets = periodLengths.map((len) => { const off = acc; acc += len; return off; });
  const totalHours = Math.max(1, periodLengths.reduce((a, b) => a + b, 0));
  return { periodLengths, periodOffsets, totalHours };
}