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
    periodBoundaries: PeriodBoundary[]
): ProductQuantityByPeriod {
    const periodCount = Math.max(0, periodBoundaries.length - 1);

    // Build the product set dynamically based on actual tasks to avoid missing keys
    const productKeys = Array.from(
        new Set(tasks.flatMap(t => Object.keys(t.production ?? {})))
    );

    const result: ProductQuantityByPeriod = {};
    for (const product of productKeys) {
        result[product] = new Array(periodCount).fill(0);
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

    // Determine the time window for filtering
    if (monthFilter === 'all') {
        monthStart = 0;
        monthEnd = Infinity;
    } 
    else {
        const {start, end} = getMonthTimeWindow(monthFilter, months, periodBoundaries);
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
    periodBoundaries: PeriodBoundary[]
): MonthProductionSummary {
    let monthStart: number;
    let monthEnd: number;

    // Determine the time window for filtering
    if (monthFilter === 'all') {
        monthStart = 0;
        monthEnd = Infinity;
    } else {
        const { start, end } = getMonthTimeWindow(monthFilter, months, periodBoundaries);
        monthStart = start;
        monthEnd = end;
    }

    // Calculate proportional production for the selected month filter
    const products: Record<string, number> = {};

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

            // Add proportional production for each product
            for (const [productName, quantity] of Object.entries(task.production)) {
                if (!products[productName]) {
                    products[productName] = 0;
                }
                products[productName] += quantity * proportion;
            }
        }
    }

    return { products };
}


interface DemandQuantityByPeriod {
    [productName: string]: number[];
}
export function calculateDemandPerPeriod(demand: Demand[]): DemandQuantityByPeriod {
    const result: DemandQuantityByPeriod = {};

    // Process each product's demand
    for (const d of demand) {
        const productName: string = d.Product;
        const demands: Demand["demand"] = d.demand;

        const periodDemands: number[] = [];

        // Get demand for each period
        for (const period of demands) {
            periodDemands.push(period.demand);
        }

        result[productName] = periodDemands;
    }

    return result;
}

export const calculateTotalTaskDuration = (tasks: Task[]): number => {
    return tasks.reduce((sum, task) => sum + effectiveDuration(task), 0);
};

export const getMonthTimeWindow = (monthId: string, months: Month[], periodBoundaries: PeriodBoundary[]): { start: number, end: number } => {
    const month = months.find(m => m.monthID === monthId);

    if (!month || !month.periods || month.periods.length === 0) {
        return { start: 0, end: 0 };
    }

    // Identify the first and last period IDs for the month
    const firstId = month.periods[0];
    const lastId = month.periods[month.periods.length - 1];

    const firstIdx: number = periodBoundaries.findIndex(item => item.id === firstId);
    const lastIdx: number = periodBoundaries.findIndex(item => item.id === lastId);

    // Validate lookups (firstIdx must be >= 1 to allow access to the start boundary)
    if (firstIdx <= 0 || lastIdx < 0) {
        console.warn("cost panel: invalid period IDs for month", { firstId, lastId });
        return { start: 0, end: 0 };
    }

    return {
        start: periodBoundaries[firstIdx - 1].total, // start of first period in month
        end: periodBoundaries[lastIdx].total        // end of last period in month
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
export function calculateTotalCostBreakdown(tasks: Task[], teams: Team[], demands: Demand[], periods: Period[], distances: Distance[]): CostBreakdown {
    const assignedTasks = tasks.filter(t => t.duration.teamId !== null);
    let harvesterCostCalculations: string[] = [];
    let forwarderCostCalculations: string[] = [];
    let travelingCostCalculations: string[] = [];

    // Harvester Costs
    const harvesterCosts = assignedTasks.reduce((total, task) => {
        const taskCost = task.harvestCosts.reduce((taskTotal, cost) => {
            if (cost.Team === task.duration.teamId) {
                return taskTotal + cost.harvesterCost;
            }
            return taskTotal;
        }, 0);

        harvesterCostCalculations.push(taskCost.toFixed(2));
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

        forwarderCostCalculations.push(taskCost.toFixed(2));
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

        travelingCostCalculations.push(taskCost.toFixed(2));
        return total + taskCost;
    }, 0);
    
    console.log("Total Harvester Costs: ", harvesterCosts);
    console.log("Total Forwarder Costs: ", forwarderCosts);
    console.log("Total Traveling Costs: ", travelingCosts);

    console.groupCollapsed("Harvester Cost Calcs");
    console.log(harvesterCostCalculations.join('\n'));
    console.groupEnd();

    console.groupCollapsed("Forwarder Cost Calcs");
    console.log(forwarderCostCalculations.join('\n'));
    console.groupEnd();

    console.groupCollapsed("Traveling Cost Calcs");
    console.log(travelingCostCalculations.join('\n'));
    console.groupEnd();

    console.log("");

    // Wheeling Costs and Trailer Costs
    let wheelingCosts: number = 0;
    let trailerCosts: number = 0;
    let trailerCalcs: string[] = [`team.fixMovingCostWithTrailer + (distance / team.trailerAverageSpeed) * team.trailerCost`];
    let wheelingCalcs: string[] = [`distance * team.fixMovingCostWithoutTrailer`];

    for (const team of teams) {
        const teamTasks: Task[] = assignedTasks.filter(t => t.duration.teamId === team.id);
       
        // Iterate through consecutive pairs of tasks
        for (let i = 0; i < teamTasks.length - 1; i++) {
            const fromId: string = teamTasks[i].task.id;
            const toId: string = teamTasks[i + 1].task.id;

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
            
            if (distance > team.maxWheelingDist_km) {
                trailerCosts += team.fixMovingCostWithTrailer + (distance / team.trailerAverageSpeed) * team.trailerCost;
                trailerCalcs.push(`${team.fixMovingCostWithTrailer} + (${distance} / ${team.trailerAverageSpeed}) * ${team.trailerCost}`);
            } else {
                wheelingCosts += distance * team.fixMovingCostWithoutTrailer
                wheelingCalcs.push(`${distance} * ${team.fixMovingCostWithoutTrailer}`);
            }
        }
    }

    console.log("Total Wheeling Cost: ", wheelingCosts);
    console.groupCollapsed("Wheeling Cost Calcs")
    console.log(wheelingCalcs.join('\n'));
    console.groupEnd();
    
    console.log("Total Trailer Cost: ", trailerCosts);
    console.groupCollapsed("Trailer Cost Calcs")
    console.log(trailerCalcs.join('\n'));
    console.groupEnd();

    console.log("");

    // Demand Penalty Costs
    // Get inventory balance
    const productionByPeriod = calculateProductionPerPeriod(assignedTasks, createPeriodBoundaries(periods)); 
    const demandByPeriod = calculateDemandPerPeriod(demands);
    const inventoryBalance: { [key: string]: number } = {};
    let demandCostCalc: string[] = [`difference * penaltyCost`];

    Object.keys(productionByPeriod).forEach(product => {
        const totalProduction = productionByPeriod[product].reduce((sum, val) => sum + val, 0);
        const totalDemand = demandByPeriod[product].reduce((sum, val) => sum + val, 0);
        const difference = totalProduction - totalDemand;

        inventoryBalance[product] = difference;
    })

    const demandPenaltyCosts = demands.map(d => {
        const difference = inventoryBalance[d.Product] - demandByPeriod[d.Product].reduce((sum, val) => sum + val, 0);
        if (difference > 0) {
            demandCostCalc.push(`>0: ${difference} * ${d.demand[0].costAboveAckumGoal}`);
            return difference * d.demand[0].costAboveAckumGoal;
        } else {
            demandCostCalc.push(`<0: ${difference} * ${d.demand[0].costBelowAckumGoal}`);
            return (-1 * difference) * d.demand[0].costBelowAckumGoal;
        }
    }).reduce((sum, val) => sum + val, 0);
    
    console.log("Total Demand Penalty Cost: ", demandPenaltyCosts);
    console.groupCollapsed("Demand Penalty Cost Calcs");
    console.log(demandCostCalc.join('\n'));
    console.groupEnd();

    console.groupCollapsed("Inventory Balance");
    console.log(inventoryBalance);
    console.groupEnd();

    console.log("");    

    let industryValueCalcs: string[] = [`surplusQuantity * unitValue`];
    
    // Industry Value (revenue from surplus production)
    const industryValue = demands.map(d => {
        if (inventoryBalance[d.Product] > 0) {
            industryValueCalcs.push(`${inventoryBalance[d.Product]} * ${d.value_prod}`)
            return inventoryBalance[d.Product] * d.value_prod;
        } else {
            industryValueCalcs.push(`0`);
            return 0;
        }
    }).reduce((sum, val) => sum + val, 0);

    console.log("Total Industry Value: ", industryValue);
    console.groupCollapsed("Industry Value Calc");
    console.log(industryValueCalcs.join('\n'));
    console.groupEnd();

    return {
        harvesterCosts: harvesterCosts,
        forwarderCosts: forwarderCosts,
        travelingCosts: travelingCosts,
        wheelingCosts: wheelingCosts,
        trailerCosts: trailerCosts,
        demandPenaltyCosts: demandPenaltyCosts,
        industryValue: industryValue,
        totalCost: harvesterCosts + forwarderCosts + travelingCosts + wheelingCosts + trailerCosts + demandPenaltyCosts - industryValue
    }
}