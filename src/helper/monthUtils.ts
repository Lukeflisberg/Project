import { Month } from "../types";

export function earliestMonth(months: Month[]) : string {
    if (!months || months.length === 0) {
        return '';
    }

    const monthsMap: Record<string, number> = {
        'jan': 1,
        'feb': 2,
        'mar': 3,
        'apr': 4,
        'may': 5,
        'jun': 6,
        'jul': 7,
        'aug': 8,
        'sep': 9,
        'okt': 10,
        'nov': 11,
        'dec': 12
    };

    let earliestMonth = months[0];

    for (const month of months) {
        if (monthsMap[month.monthID.trim()] < monthsMap[earliestMonth.monthID.trim()]) {
            earliestMonth = month;
        }
    }

    return earliestMonth.monthID;
}