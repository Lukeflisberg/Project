import { Demand, Task, Period, Month, QuantityByPeriod, PeriodBoundary, TeamProductionSummary, MonthProductionSummary, TimeWindow } from "../types";
import { effectiveDuration, endHour } from "./taskUtils";

// ============================================================================
// Helper Functions
// ============================================================================

function createAssortmentMapping(assortmentGraph?: Array<{ assortment: string; assortment_group: string; include: number }>) {
    const assortmentToGroup = new Map<string, string>();
    const excludedAssortments = new Set<string>();
    
    if (assortmentGraph) {
        for (const item of assortmentGraph) {
            if (item.include === 1) {
                assortmentToGroup.set(item.assortment, item.assortment_group);
            } else if (item.include === 0) {
                excludedAssortments.add(item.assortment);
            }
        }
    }
    
    return { assortmentToGroup, excludedAssortments };
}

function getTimeWindow(
    monthFilter: string,
    months: Month[],
    periodBoundaries: PeriodBoundary[],
    totalHour: number
): TimeWindow {
    if (monthFilter === 'all') {
        return { start: 0, end: totalHour };
    }
    
    const month = months.find(m => m.monthID === monthFilter)!;
    const window = getMonthTimeWindow(month, periodBoundaries);
    return { start: window.start, end: Math.min(window.end, totalHour) };
}

function calculateOverlap(
    taskStart: number,
    taskEnd: number,
    windowStart: number,
    windowEnd: number
): number {
    const overlapStart = Math.max(taskStart, windowStart);
    const overlapEnd = Math.min(taskEnd, windowEnd);
    return Math.max(0, overlapEnd - overlapStart);
}

// ============================================================================
// Public API Functions
// ============================================================================

export function createPeriodBoundaries(periods: Period[]): PeriodBoundary[] {
    const periodBoundaries: PeriodBoundary[] = [{ id: "P0", total: 0 }];
    let cumulativeHours = 0;
    
    for (const period of periods) {
        cumulativeHours += period.length_h;
        periodBoundaries.push({ id: period.id, total: cumulativeHours });
    }

    return periodBoundaries;
}

export function calculateProductionPerPeriod(
    tasks: Task[],
    periodBoundaries: PeriodBoundary[],
    assortmentGraph?: Array<{ assortment: string; assortment_group: string; include: number }>,
    totalHour?: number
): QuantityByPeriod {
    const periodCount = Math.max(0, periodBoundaries.length - 1);
    const { assortmentToGroup } = createAssortmentMapping(assortmentGraph);

    // Build the product set dynamically
    const productKeys = Array.from(
        new Set(tasks.flatMap(t => Object.keys(t.production ?? {})))
    );

    const result: QuantityByPeriod = {};
    for (const product of productKeys) {
        const groupKey = assortmentToGroup.get(product) || product;
        if (!result[groupKey]) {
            result[groupKey] = new Array(periodCount).fill(0);
        }
    }

    // Process each task
    for (const task of tasks) {
        const taskStart = task.duration.startHour;
        const taskEnd = endHour(task);
        const taskDuration = effectiveDuration(task);

        if (task.duration.teamId === null || taskDuration <= 0) continue;

        const effectiveTaskEnd = totalHour !== undefined ? Math.min(taskEnd, totalHour) : taskEnd;
        const effectiveTaskDuration = Math.max(0, effectiveTaskEnd - taskStart);

        if (effectiveTaskDuration <= 0) continue;

        // Distribute production across periods
        for (let i = 1; i < periodBoundaries.length; i++) {
            const periodStart = periodBoundaries[i - 1].total;
            const periodEnd = periodBoundaries[i].total;

            const overlap = calculateOverlap(taskStart, effectiveTaskEnd, periodStart, periodEnd);

            if (overlap > 0) {
                const proportionInPeriod = overlap / taskDuration;

                for (const [key, value] of Object.entries(task.production)) {
                    const groupKey = assortmentToGroup.get(key) || key;
                    if (!result[groupKey]) {
                        result[groupKey] = new Array(periodCount).fill(0);
                    }
                    result[groupKey][i - 1] += value * proportionInPeriod;
                }
            }
        }
    }

    return result;
}

export function calculateProductionPerTeam(
    tasks: Task[],
    monthFilter: string,
    months: Month[],
    periodBoundaries: PeriodBoundary[],
    totalHour: number
): TeamProductionSummary[] {
    const timeWindow = getTimeWindow(monthFilter, months, periodBoundaries, totalHour);
    const teamMap = new Map<string, Record<string, number>>();

    for (const task of tasks) {
        if (!task.duration.teamId || !task.production || !task.task.avvForm) continue;
        
        const taskStart = task.duration.startHour;
        const taskEnd = endHour(task);
        const taskDuration = effectiveDuration(task);

        if (taskDuration <= 0) continue;

        const overlap = calculateOverlap(taskStart, taskEnd, timeWindow.start, timeWindow.end);

        if (overlap > 0) {
            const proportion = overlap / taskDuration;

            if (!teamMap.has(task.duration.teamId)) {
                teamMap.set(task.duration.teamId, {});
            }

            const teamAvvForms = teamMap.get(task.duration.teamId)!;
            const totalProduction = Object.values(task.production).reduce((sum, qty) => sum + qty, 0);
            
            teamAvvForms[task.task.avvForm] = (teamAvvForms[task.task.avvForm] || 0) + totalProduction * proportion;
        }
    }

    // Convert map to sorted array
    const result: TeamProductionSummary[] = Array.from(teamMap.entries()).map(
        ([teamId, avvForms]) => ({
            teamId,
            volume: Object.values(avvForms).reduce((sum, qty) => sum + qty, 0),
            avvForms
        })
    );

    return result.sort((a, b) => a.teamId.localeCompare(b.teamId));
}

export function calculateProductionForMonth(
    tasks: Task[],
    monthFilter: string,
    months: Month[],
    periodBoundaries: PeriodBoundary[],
    assortmentGraph: Array<{ assortment: string; assortment_group: string; include: number }>,
    totalHour: number
): MonthProductionSummary {
    const { assortmentToGroup, excludedAssortments } = createAssortmentMapping(assortmentGraph);
    const timeWindow = getTimeWindow(monthFilter, months, periodBoundaries, totalHour);
    const products: Record<string, number> = {};

    for (const task of tasks) {
        if (!task.duration?.teamId || !task.production) continue;

        const taskStart = task.duration.startHour;
        const taskEnd = endHour(task);
        const taskDuration = effectiveDuration(task);

        if (taskDuration <= 0) continue;

        const overlap = calculateOverlap(taskStart, taskEnd, timeWindow.start, timeWindow.end);

        if (overlap > 0) {
            const proportion = overlap / taskDuration;

            for (const [key, quantity] of Object.entries(task.production)) {
                if (excludedAssortments.has(key)) continue;
                
                const groupKey = assortmentToGroup.get(key) || key;
                products[groupKey] = (products[groupKey] || 0) + quantity * proportion;
            }
        }
    }

    return { products };
}

export function calculateDemandPerPeriod(
    demand: Demand[],
    demandType?: string,
    assortmentGraph?: Array<{ assortment: string; assortment_group: string; include: number }>
): QuantityByPeriod {
    const { assortmentToGroup } = createAssortmentMapping(assortmentGraph);
    const result: QuantityByPeriod = {};

    for (const d of demand) {
        const groupKey = assortmentToGroup.get(d.Product) || d.Product;
        const demands = d.demand;

        if (!result[groupKey]) {
            result[groupKey] = new Array(demands.length).fill(0);
        }

        for (let i = 0; i < demands.length; i++) {
            result[groupKey][i] += demandType === 'goal' 
                ? demands[i].demand_goal 
                : demands[i].demand;
        }
    }

    return result;
}

export const calculateTotalTaskDuration = (tasks: Task[], totalHour: number): number => {
    let sum = 0;
    for (const task of tasks) {
        const effectiveEnd = Math.min(endHour(task), totalHour);
        const duration = Math.max(0, effectiveEnd - task.duration.startHour);
        sum += duration;
    }
    return Math.min(sum, totalHour);
};

export function getMonthTimeWindow(
    month: Month, 
    periodBoundaries: Array<{ id: string; total: number }>
): TimeWindow {
    if (!month.periods || month.periods.length === 0) {
        return { start: 0, end: 0 };
    }

    const firstId = month.periods[0];
    const lastId = month.periods[month.periods.length - 1];

    const firstIdx = periodBoundaries.findIndex(item => item.id === firstId);
    const lastIdx = periodBoundaries.findIndex(item => item.id === lastId);

    if (firstIdx <= 0 || lastIdx < 0) {
        console.warn("Invalid period IDs for month", { firstId, lastId });
        return { start: 0, end: 0 };
    }

    return {
        start: periodBoundaries[firstIdx - 1].total,
        end: periodBoundaries[lastIdx].total
    };
}

export function calculateMonthlyTaskDuration(
    monthTimeWindow: TimeWindow,
    tasks: Task[],
    totalHour: number
): number {
    const windowEnd = Math.min(monthTimeWindow.end, totalHour);
    let duration = 0;
    
    for (const task of tasks) {
        duration += calculateOverlap(
            task.duration.startHour,
            endHour(task),
            monthTimeWindow.start,
            windowEnd
        );
    }

    return duration;
}

export function calculateTaskProportion(task: Task, timeWindow: TimeWindow): number {
    const taskDuration = effectiveDuration(task);
    if (taskDuration <= 0) return 0;

    const overlap = calculateOverlap(
        task.duration.startHour,
        endHour(task),
        timeWindow.start,
        timeWindow.end
    );

    return overlap / taskDuration;
}