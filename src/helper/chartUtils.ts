import { Demand, Task, Period, Month } from "../types";
import { effectiveDuration, endHour } from "./taskUtils";

// Shared type for period boundaries
export type PeriodBoundary = { id: string; total: number };

export function createPeriodBoundaries(periods: Period[]): PeriodBoundary[] {
    // Start from 0 to avoid off-by-one issues and align with [start, end) semantics
    const periodBoundaries: PeriodBoundary[] = [{ id: "P0", total: 0 }];
    let cumulativeHours = 0;
    for (const period of periods) {
        cumulativeHours += period.length_h;
        periodBoundaries.push({ id: period.id, total: cumulativeHours });
    }

    return periodBoundaries;
}

interface CumulativeProduction {
    [productName: string]: number[];
}

export function getCumulativeProductionByProduct(
    tasks: Task[],
    periodBoundaries: PeriodBoundary[]
): CumulativeProduction {
    const periodCount = Math.max(0, periodBoundaries.length - 1);

    // Build the product set dynamically based on actual tasks to avoid missing keys
    const productKeys = Array.from(
        new Set(tasks.flatMap(t => Object.keys(t.production ?? {})))
    );

    const result: CumulativeProduction = {};
    for (const product of productKeys) {
        result[product] = new Array(periodCount).fill(0);
    }

    // Process each task
    for (const task of tasks) {
        const taskStart = task.duration.startHour;
        const taskEnd = endHour(task);
        const taskDuration = effectiveDuration(task);

        if (taskDuration <= 0) continue;

        // Distribute production across periods based on overlap
        for (let i = 1; i < periodBoundaries.length; i++) {
            const periodStart = periodBoundaries[i - 1].total;
            const periodEnd = periodBoundaries[i].total;

            // Calculate overlap between task and period
            const overlapStart = Math.max(taskStart, periodStart);
            const overlapEnd = Math.min(taskEnd, periodEnd);
            const overlap = Math.max(0, overlapEnd - overlapStart);

            if (overlap > 0) {
                const proportionInPeriod = overlap / taskDuration;

                // Add proportional production to this period
                for (const [key, value] of Object.entries(task.production)) {
                    if (!result[key]) {
                        // Initialize missing product keys on-the-fly
                        result[key] = new Array(periodCount).fill(0);
                    }
                    // Write to i - 1 due to [start, end) period windows mapping
                    result[key][i - 1] += value * proportionInPeriod;
                }
            }
        }
    }

    // Convert to cumulative totals
    for (const product of Object.keys(result)) {
        for (let i = 1; i < result[product].length; i++) {
            result[product][i] += result[product][i - 1];
        }
    }

    return result;
}

interface CumulativeDemands {
    [productName: string]: number[];
}

export function getCumulativeDemandByProduct(demand: Demand[]): CumulativeDemands {
    const result: CumulativeDemands = {};

    // Process each product's demand
    for (const d of demand) {
        const productName: string = d.Product;
        const demands: Demand["demand"] = d.demand;

        const cumulative: number[] = [];
        let runningTotal = 0;

        // Calculate cumulative demand
        for (const period of demands) {
            runningTotal += period.demand;
            cumulative.push(runningTotal);
        }

        result[productName] = cumulative;
    }

    return result;
}

export const totalHarvesterCost = (task: Task): number | null => {
    const costs: Task.Costs | undefined = task.harvestCosts.find(t => t.Team === task.duration.teamId);
    console.log(costs);
    if (costs) {
        return (costs.harvesterCost + costs.forwarderCost + costs.travelingCost);
    } else {
        return null;
    }
};

export const calcDurationOf = (tasks: Task[]): number => {
    return tasks.reduce((sum, task) => sum + effectiveDuration(task), 0);
};

export function calcMonthlyDurations(
    month: Month,
    tasks: Task[],
    periodBoundaries: PeriodBoundary[]
): number {
    // Guard: if month has no periods, total duration is zero
    if (!month.periods || month.periods.length === 0) return 0;

    // Identify the first and last period IDs for the month
    const firstId: string = month.periods[0];
    const lastId: string = month.periods[month.periods.length - 1];

    const firstIdx: number = periodBoundaries.findIndex(item => item.id === firstId);
    const lastIdx: number = periodBoundaries.findIndex(item => item.id === lastId);

    // Validate lookups (firstIdx must be >= 1 to allow access to the start boundary)
    if (firstIdx <= 0 || lastIdx < 0) {
        console.warn("calcMonthlyDurations: invalid period IDs for month", { firstId, lastId });
        return 0;
    }

    // Compute the month window [monthStart, monthEnd)
    const monthStart: number = periodBoundaries[firstIdx - 1].total; // start of first period in month
    const monthEnd: number = periodBoundaries[lastIdx].total;        // end of last period in month

    // Sum overlap durations for tasks intersecting with the month window
    let duration = 0;
    for (const task of tasks) {
        const s = task.duration.startHour;
        const e = endHour(task);
        const overlapStart = Math.max(s, monthStart);
        const overlapEnd = Math.min(e, monthEnd);
        duration += Math.max(0, overlapEnd - overlapStart);
    }

    return duration;
}