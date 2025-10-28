import { Demand, Task, Period, Month, QuantityByPeriod, PeriodBoundary, TeamProductionSummary, MonthProductionSummary, TimeWindow } from "../types";
import { effectiveDuration, endHour } from "./taskUtils";


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

export function calculateProductionPerPeriod(
    tasks: Task[],
    periodBoundaries: PeriodBoundary[],
    assortmentGraph?: Array<{ assortment: string; assortment_group: string; include: number }>,
    totalHour?: number
): QuantityByPeriod {
    const periodCount = Math.max(0, periodBoundaries.length - 1);

    // Build the product set dynamically based on actual tasks to avoid missing keys
    const productKeys = Array.from(
        new Set(tasks.flatMap(t => Object.keys(t.production ?? {})))
    );

    // Create mapping from assortment to assortment_group if available
    const assortmentToGroup = new Map<string, string>();
    if (assortmentGraph) {
        for (const item of assortmentGraph) {
            if (item.include === 1) {
                assortmentToGroup.set(item.assortment, item.assortment_group);
            }
        }
    }

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

        if (task.duration.teamId === null || taskDuration <= 0) continue; // skip

        // Clamp task to totalHour boundary if specified
        const effectiveTaskEnd = totalHour !== undefined ? Math.min(taskEnd, totalHour) : taskEnd;
        const effectiveTaskDuration = Math.max(0, effectiveTaskEnd - taskStart);

        if (effectiveTaskDuration <= 0) continue;

        // Distribute production across periods based on overlap
        for (let i = 1; i < periodBoundaries.length; i++) {
            const periodStart = periodBoundaries[i - 1].total;
            const periodEnd = periodBoundaries[i].total;

            // Calculate overlap between task and period
            const overlapStart = Math.max(taskStart, periodStart);
            const overlapEnd = Math.min(effectiveTaskEnd, periodEnd);
            const overlap = Math.max(0, overlapEnd - overlapStart);

            if (overlap > 0) {
                const proportionInPeriod = overlap / taskDuration;

                // Add proportional production to this period
                for (const [key, value] of Object.entries(task.production)) {
                    const groupKey = assortmentToGroup.get(key) || key;
                    if (!result[groupKey]) {
                        // Initialize missing product keys on-the-fly
                        result[groupKey] = new Array(periodCount).fill(0);
                    }
                    // Write to i - 1 due to [start, end) period windows mapping
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
    let monthStart: number;
    let monthEnd: number;

    const month = months.find(m => m.monthID === monthFilter)!;

    // Determine the time window for filtering
    if (monthFilter === 'all') {
        monthStart = 0;
        monthEnd = totalHour;
    } 
    else {
        const {start, end} = getMonthTimeWindow(month, periodBoundaries);
        monthStart = start;
        monthEnd = Math.min(end, totalHour); // Clamp to totalHour
    }

    // Group tasks by team and calculate proportional production per avvForm
    const teamMap = new Map<string, Record<string, number>>();

    for (const task of tasks) {
        if (!task.duration.teamId) continue;
        if (!task.production) continue;
        if (!task.task.avvForm) continue;
        
        const taskStart = task.duration.startHour;
        const taskEnd = endHour(task);
        const taskDuration = effectiveDuration(task);

        if (taskDuration <= 0) continue;

        // Calculate overlap with the month window (already clamped to totalHour)
        const overlapStart = Math.max(taskStart, monthStart);
        const overlapEnd = Math.min(taskEnd, monthEnd);
        const overlap = Math.max(0, overlapEnd - overlapStart);

        if (overlap > 0) {
            const proportion = overlap / taskDuration;

            // Initialize team entry if needed
            if (!teamMap.has(task.duration.teamId)) {
                teamMap.set(task.duration.teamId, {});
            }

            const teamAvvForms = teamMap.get(task.duration.teamId)!;

            // Calculate total production for this task
            const totalProduction = Object.values(task.production).reduce((sum, quantity) => sum + quantity, 0);
            
            // Add proportional production to the avvForm
            teamAvvForms[task.task.avvForm] = (teamAvvForms[task.task.avvForm] || 0) + totalProduction * proportion;
        }
    }

    // Convert map to array
    const result: TeamProductionSummary[] = [];
    for (const [teamId, avvForms] of teamMap.entries()) {
        const volume = Object.values(avvForms).reduce((sum, quantity) => sum + quantity, 0);
        result.push({ teamId, volume, avvForms });
    }

    // Sort by teamId to ensure consistent ordering
    result.sort((a, b) => a.teamId.localeCompare(b.teamId));

    return result;
}

export function calculateProductionForMonth(
    tasks: Task[],
    monthFilter: string,
    months: Month[],
    periodBoundaries: PeriodBoundary[],
    assortmentGraph: Array<{ assortment: string; assortment_group: string; include: number }>,
    totalHour: number
): MonthProductionSummary {
    // Create mapping from assortment to assortment_group
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

    // Determine the time window for filtering
    let monthStart: number;
    let monthEnd: number;

    const month = months.find(m => m.monthID === monthFilter)!;
    
    if (monthFilter === 'all') {
        monthStart = 0;
        monthEnd = totalHour;
    } else {
        const { start, end } = getMonthTimeWindow(month, periodBoundaries);
        monthStart = start;
        monthEnd = Math.min(end, totalHour); // Clamp to totalHour
    }

    // Calculate proportional production for the selected month filter
    const products: Record<string, number> = {};

    for (const task of tasks) {
        if (!task.duration?.teamId || !task.production) continue;

        const taskStart = task.duration.startHour;
        const taskEnd = endHour(task);
        const taskDuration = effectiveDuration(task);

        if (taskDuration <= 0) continue;

        // Calculate overlap with the month window (already clamped to totalHour)
        const overlapStart = Math.max(taskStart, monthStart);
        const overlapEnd = Math.min(taskEnd, monthEnd);
        const overlap = Math.max(0, overlapEnd - overlapStart);

        if (overlap > 0) {
            const proportion = overlap / taskDuration;

            // Add proportional production for each product
            for (const [key, quantity] of Object.entries(task.production)) {
                // Skip if this assortment is explicitly excluded
                if (excludedAssortments.has(key)) {
                    continue;
                }
                
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
    // Create mapping from assortment to assortment_group if available
    const assortmentToGroup = new Map<string, string>();
    if (assortmentGraph) {
        for (const item of assortmentGraph) {
            if (item.include === 1) {
                assortmentToGroup.set(item.assortment, item.assortment_group);
            }
        }
    }

    const result: QuantityByPeriod = {};

    // Process each product's demand
    for (const d of demand) {
        const productName: string = d.Product;
        const groupKey = assortmentToGroup.get(productName) || productName;
        const demands: Demand["demand"] = d.demand;

        // Initialize group if not exists
        if (!result[groupKey]) {
            result[groupKey] = new Array(demands.length).fill(0);
        }

        // Get demand for each period and aggregate by group
        for (let i = 0; i < demands.length; i++) {
            if (!demandType) {
                result[groupKey][i] += demands[i].demand;
            } else {
                demandType === 'min' 
                    ? result[groupKey][i] += demands[i].demand // Change too demandMin
                    : result[groupKey][i] += demands[i].demand // Change too demandGoal
            }
        }
    }

    return result;
}

export const calculateTotalTaskDuration = (tasks: Task[], totalHour: number): number => {
    let sum = 0;
    for (const task of tasks) {
        const taskStart = task.duration.startHour;
        const taskEnd = endHour(task);
        // Clamp task to totalHour boundary
        const effectiveTaskEnd = Math.min(taskEnd, totalHour);
        const effectiveDur = Math.max(0, effectiveTaskEnd - taskStart);
        sum += effectiveDur;
    }
    return Math.min(sum, totalHour);
};

export function getMonthTimeWindow(month: Month, periodBoundaries: Array<{ id: string; total: number }>): TimeWindow {
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
    monthTimeWindow: { start: number, end: number },
    tasks: Task[],
    totalHour: number
): number {
    // Compute the month window [monthStart, monthEnd), clamped to totalHour
    const monthStart: number = monthTimeWindow.start;
    const monthEnd: number = Math.min(monthTimeWindow.end, totalHour);

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

export function calculateTaskProportion(task: Task, timeWindow: { start: number, end: number }): number {
    const taskStart = task.duration.startHour;
    const taskEnd = endHour(task);
    const taskDuration = effectiveDuration(task);

    if (taskDuration <= 0) return 0;

    const overlapStart = Math.max(taskStart, timeWindow.start);
    const overlapEnd = Math.min(taskEnd, timeWindow.end);
    const overlap = Math.max(0, overlapEnd - overlapStart);

    return overlap / taskDuration;
}