import { Demand, Task, Period, Month, Team, Distance } from "../types";
import { effectiveDuration, endHour } from "./taskUtils";

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

interface ProductQuantityByPeriod {
    [productName: string]: number[];
}
export function calculateProductionPerPeriod(
    tasks: Task[],
    periodBoundaries: PeriodBoundary[],
    assortmentGraph?: Array<{ assortment: string; assortment_group: string; include: number }>
): ProductQuantityByPeriod {
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

    const result: ProductQuantityByPeriod = {};
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

interface TeamProductionSummary {
    teamId: string;
    volume: number;
}
export function calculateProductionPerTeam(
    tasks: Task[],
    monthFilter: string,
    months: Month[],
    periodBoundaries: PeriodBoundary[]
): TeamProductionSummary[] {
    let monthStart: number;
    let monthEnd: number;

    const month = months.find(m => m.monthID === monthFilter)!;

    // Determine the time window for filtering
    if (monthFilter === 'all') {
        monthStart = 0;
        monthEnd = Infinity;
    } 
    else {
        const {start, end} = getMonthTimeWindow(month, periodBoundaries);
        monthStart = start;
        monthEnd = end;
    }

    // Group tasks by team and calculate proportional production
    const teamMap = new Map<string, Record<string, number>>();

    for (const task of tasks) {
        if (!task.duration.teamId) continue;
        if (!task.production) continue;
        
        const taskStart = task.duration.startHour;
        const taskEnd = endHour(task);
        const taskDuration = effectiveDuration(task);

        if (taskDuration <= 0) continue;

        // Calculate overlap with the month window
        const overlapStart = Math.max(taskStart, monthStart);
        const overlapEnd = Math.min(taskEnd, monthEnd);
        const overlap = Math.max(0, overlapEnd - overlapStart);

        if (overlap > 0) {
            const proportion = overlap / taskDuration;

            // Initialize team entry if needed
            if (!teamMap.has(task.duration.teamId)) {
                teamMap.set(task.duration.teamId, {});
            }

            const teamProducts = teamMap.get(task.duration.teamId)!;

            // Add proportional production for each product
            for (const [productName, quantity] of Object.entries(task.production)) {
                if (!teamProducts[productName]) {
                    teamProducts[productName] = 0;
                }
                teamProducts[productName] += quantity * proportion;
            }
        }
    }

    // Convert map to array
    const result: TeamProductionSummary[] = [];
    for (const [teamId, products] of teamMap.entries()) {
        const volume = Object.values(products).reduce((sum, qty) => sum + qty, 0);
        result.push({ teamId, volume });
    }

    // Sort by teamId to ensure consistent ordering
    result.sort((a, b) => a.teamId.localeCompare(b.teamId));
    console.log(result[0].volume);

    return result;
}

interface MonthProductionSummary {
    products: Record<string, number>; 
}
export function calculateProductionForMonth(
    tasks: Task[],
    monthFilter: string,
    months: Month[],
    periodBoundaries: PeriodBoundary[],
    assortmentGraph: Array<{ assortment: string; assortment_group: string; include: number }>
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
        monthEnd = Infinity;
    } else {
        const { start, end } = getMonthTimeWindow(month, periodBoundaries);
        monthStart = start;
        monthEnd = end;
    }

    // Calculate proportional production for the selected month filter
    const products: Record<string, number> = {};

    for (const task of tasks) {
        if (!task.duration?.teamId || !task.production) continue;

        const taskStart = task.duration.startHour;
        const taskEnd = endHour(task);
        const taskDuration = effectiveDuration(task);

        if (taskDuration <= 0) continue;

        // Calculate overlap with the month window
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

interface DemandQuantityByPeriod {
    [productName: string]: number[];
}
export function calculateDemandPerPeriod(
    demand: Demand[],
    assortmentGraph?: Array<{ assortment: string; assortment_group: string; include: number }>
): DemandQuantityByPeriod {
    // Create mapping from assortment to assortment_group if available
    const assortmentToGroup = new Map<string, string>();
    if (assortmentGraph) {
        for (const item of assortmentGraph) {
            if (item.include === 1) {
                assortmentToGroup.set(item.assortment, item.assortment_group);
            }
        }
    }

    const result: DemandQuantityByPeriod = {};

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
            result[groupKey][i] += demands[i].demand;
        }
    }

    return result;
}

export const calculateTotalTaskDuration = (tasks: Task[]): number => {
    return tasks.reduce((sum, task) => sum + effectiveDuration(task), 0);
};

interface TimeWindow {
    start: number;
    end: number;
}
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
): number {
    // Compute the month window [monthStart, monthEnd)
    const monthStart: number = monthTimeWindow.start;
    const monthEnd: number = monthTimeWindow.end;

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

function calculateTaskProportion(task: Task, timeWindow: { start: number, end: number }): number {
    const taskStart = task.duration.startHour;
    const taskEnd = endHour(task);
    const taskDuration = effectiveDuration(task);

    if (taskDuration <= 0) return 0;

    const overlapStart = Math.max(taskStart, timeWindow.start);
    const overlapEnd = Math.min(taskEnd, timeWindow.end);
    const overlap = Math.max(0, overlapEnd - overlapStart);

    return overlap / taskDuration;
}

interface CostBreakdown {
    harvesterCosts: number;
    forwarderCosts: number;
    travelingCosts: number;
    wheelingCosts: number;
    trailerCosts: number;
    demandPenaltyCosts: number;
    industryValue: number;
    totalCost: number;
}
export function calculateTotalCostBreakdown(
    tasks: Task[], 
    teams: Team[], 
    demands: Demand[], 
    periods: Period[], 
    distances: Distance[],
    monthFilter?: Month  // Optional month for filtered calculations
): CostBreakdown {
    const assignedTasks = tasks.filter(t => t.duration.teamId !== null);
    
    // Calculate time window if month is provided
    let timeWindow: TimeWindow | undefined;
    if (monthFilter) {
        const periodBoundaries = createPeriodBoundaries(periods);
        timeWindow = getMonthTimeWindow(monthFilter, periodBoundaries);
    }
    
    // Harvester Costs
    const harvesterCosts = assignedTasks.reduce((total, task) => {
        const taskCost = task.harvestCosts.reduce((taskTotal, cost) => {
            if (cost.Team === task.duration.teamId) {
                return taskTotal + cost.harvesterCost;
            }
            return taskTotal;
        }, 0);

        // Apply proportional cost if time window is specified
        if (timeWindow) {
            const proportion = calculateTaskProportion(task, timeWindow);
            return total + (taskCost * proportion);
        }
        
        return total + taskCost;
    }, 0);

    // Forwarder Costs
    const forwarderCosts = assignedTasks.reduce((total, task) => {
        const taskCost = task.harvestCosts.reduce((taskTotal, cost) => {
            if (cost.Team === task.duration.teamId) {
                return taskTotal + cost.forwarderCost;
            }
            return taskTotal;
        }, 0);

        if (timeWindow) {
            const proportion = calculateTaskProportion(task, timeWindow);
            return total + (taskCost * proportion);
        }
        
        return total + taskCost;
    }, 0);

    // Traveling Costs
    const travelingCosts = assignedTasks.reduce((total, task) => {
        const taskCost = task.harvestCosts.reduce((taskTotal, cost) => {
            if (cost.Team === task.duration.teamId) {
                return taskTotal + cost.travelingCost;
            }
            return taskTotal;
        }, 0);

        if (timeWindow) {
            const proportion = calculateTaskProportion(task, timeWindow);
            return total + (taskCost * proportion);
        }
        
        return total + taskCost;
    }, 0);

    // Wheeling Costs and Trailer Costs
    let wheelingCosts: number = 0;
    let trailerCosts: number = 0;

    for (const team of teams) {
        const teamTasks: Task[] = assignedTasks.filter(t => t.duration.teamId === team.id);
       
        // Iterate through consecutive pairs of tasks
        for (let i = 0; i < teamTasks.length - 1; i++) {
            const fromTask = teamTasks[i];
            const toTask = teamTasks[i + 1];
            const fromId: string = fromTask.task.id;
            const toId: string = toTask.task.id;

            // Find the distance object from the fromTask
            const distanceEntry: Distance | undefined = distances.find(d => d["From/To"] === fromId);
            if (!distanceEntry) {
                console.error(`No distance data found for task ${fromId}`);
                continue;
            }
            
            const distance: number = distanceEntry[toId] as number;
            if (distance === undefined) {
                console.error(`No distance from ${fromId} to ${toId}`);
                continue;
            }
            
            // Check if this movement occurs within the time window
            let includeMovement = true;
            if (timeWindow) {
                // Movement happens at the end of fromTask
                const movementTime = endHour(fromTask);
                includeMovement = movementTime >= timeWindow.start && movementTime < timeWindow.end;
            }

            if (includeMovement) {
                if (distance > team.maxWheelingDist_km) {
                    trailerCosts += team.fixMovingCostWithTrailer + (distance / team.trailerAverageSpeed) * team.trailerCost;
                } else {
                    wheelingCosts += distance * team.fixMovingCostWithoutTrailer;
                }
            }
        }
    }

    // Demand Penalty Costs and Industry Value
    const periodBoundaries = createPeriodBoundaries(periods);
    const productionByPeriod = calculateProductionPerPeriod(assignedTasks, periodBoundaries); 
    const demandByPeriod = calculateDemandPerPeriod(demands);

    let demandCost = 0;
    let industryValue = 0;

    if (monthFilter && monthFilter.periods) {
        // Monthly calculation with inventory balance tracking
        const monthPeriodIds = new Set(monthFilter.periods);
        const inventoryBalance: { [key: string]: number } = {};
        let deliveredVolume: { [key: string]: number } = {};
        
        // Get period indices that belong to this month
        const monthPeriodIndices: number[] = [];
        periodBoundaries.forEach((boundary, index) => {
            if (index > 0 && monthPeriodIds.has(boundary.id)) {
                monthPeriodIndices.push(index - 1); // Adjust for productionByPeriod indexing
            }
        });

        // Extract month-specific production and demand data
        const m0_productionByPeriod: { [key: string]: number[] } = {};
        const m0_demandByPeriod: { [key: string]: number[] } = {};

        // Build month-specific arrays by extracting only the periods in this month
        Object.keys(productionByPeriod).forEach(product => {
            m0_productionByPeriod[product] = monthPeriodIndices.map(idx => productionByPeriod[product][idx] || 0);
        });

        console.log(m0_productionByPeriod);

        Object.keys(demandByPeriod).forEach(product => {
            m0_demandByPeriod[product] = monthPeriodIndices.map(idx => demandByPeriod[product][idx] || 0);
        });

        console.log(m0_demandByPeriod);

        // Calculate inventory balance period by period within the month
        Object.keys(m0_productionByPeriod).forEach(product => {
            let balance = 0;

            m0_productionByPeriod[product].forEach((production, index) => {
                const demand = m0_demandByPeriod[product]?.[index] || 0;
                balance = balance + production - demand;
            });

            inventoryBalance[product] = balance;
        });

        // Calculate demand cost based on cumulative balance within the month
        demandCost = demands.map(d => {
            const totalDemand = m0_demandByPeriod[d.Product]?.reduce((sum, val) => sum + val, 0) || 0;
            const balance = inventoryBalance[d.Product] || 0;
            const remainder = balance - totalDemand;

            if (remainder > 0) {
                // Overproduction penalty
                return remainder * d.demand[0].costAboveAckumGoal;
            } else {
                // Underproduction penalty
                return -remainder * d.demand[0].costBelowAckumGoal;
            }
        }).reduce((sum, val) => sum + val, 0);

        // Calculate industry value for the month
        Object.keys(m0_productionByPeriod).forEach(product => {
            const totalProduction = m0_productionByPeriod[product].reduce((sum, val) => sum + val, 0);
            deliveredVolume[product] = totalProduction;
        });

        industryValue = demands.map(d => {
            return (deliveredVolume[d.Product] || 0) * d.value_prod;
        }).reduce((sum, val) => sum + val, 0);
        
    } else {
        // Original calculation for full horizon
        const inventoryBalance: { [key: string]: number } = {};

        Object.keys(productionByPeriod).forEach(product => {
            let balance = 0;

            productionByPeriod[product].forEach((production, index) => {
                const demand = demandByPeriod[product][index] || 0;
                balance = balance + production - demand;
            });

            inventoryBalance[product] = balance;
        });

        demandCost = demands.map(d => {
            const remainder = inventoryBalance[d.Product] - demandByPeriod[d.Product].reduce((sum, val) => sum + val, 0);

            if (remainder > 0) {
                return remainder * d.demand[0].costAboveAckumGoal;
            } else {
                return -remainder * d.demand[0].costBelowAckumGoal;
            }
        }).reduce((sum, val) => sum + val, 0);

        let deliveredVolume: { [key: string]: number } = {};
        Object.keys(productionByPeriod).forEach(product => {
            const totalProduction = productionByPeriod[product].reduce((sum, val) => sum + val, 0);
            deliveredVolume[product] = totalProduction;
        });

        industryValue = demands.map(d => {
            return deliveredVolume[d.Product] * d.value_prod;
        }).reduce((sum, val) => sum + val, 0);
    }

    return {
        harvesterCosts: harvesterCosts,
        forwarderCosts: forwarderCosts,
        travelingCosts: travelingCosts,
        wheelingCosts: wheelingCosts,
        trailerCosts: trailerCosts,
        demandPenaltyCosts: demandCost,
        industryValue: industryValue,
        totalCost: harvesterCosts + forwarderCosts + travelingCosts + wheelingCosts + trailerCosts + demandCost - industryValue
    };
}