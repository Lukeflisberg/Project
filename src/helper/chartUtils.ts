import { Demand, Task, Period, Month, Team, Distance } from "../types";
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

interface ProductionByPeriod {
    [productName: string]: number[];
}
export function getProductionByProduct(
    tasks: Task[],
    periodBoundaries: PeriodBoundary[]
): ProductionByPeriod {
    const periodCount = Math.max(0, periodBoundaries.length - 1);

    // Build the product set dynamically based on actual tasks to avoid missing keys
    const productKeys = Array.from(
        new Set(tasks.flatMap(t => Object.keys(t.production ?? {})))
    );

    const result: ProductionByPeriod = {};
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

interface ProductionByTeam {
    teamId: string;
    products: Record<string, number>; //name, quantity
}
export function getProductionByTeam(tasks: Task[]): ProductionByTeam[] {
    // Group tasks by team
    const teamMap = new Map<string, Task[]>();

    for (const task of tasks) {
        if (!task.duration.teamId) continue; // Skip tasks without a team

        if (!teamMap.has(task.duration.teamId)) {
            teamMap.set(task.duration.teamId, []);
        }
        teamMap.get(task.duration.teamId)!.push(task);
    }

    // Calculate production for each team
    const result: ProductionByTeam[] = [];

    for (const [teamId, teamTasks] of teamMap.entries()) {
        const products: Record<string, number> = {};

        for (const task of teamTasks) {
            if (!task.production) continue;

            // Add all products from this task
            for (const [productName, quantity] of Object.entries(task.production)) {
                if (!products[productName]) {
                    products[productName] = 0;
                }
                products[productName] += quantity;
            }
        }

        result.push({
            teamId,
            products
        });
    }

    return result;
}

interface DemandsByPeriod {
    [productName: string]: number[];
}

export function getDemandByProduct(demand: Demand[]): DemandsByPeriod {
    const result: DemandsByPeriod = {};

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

export function calcTotalCostDistribution(tasks: Task[], teams: Team[], demands: Demand[], periods: Period[], distances: Distance[]) {
    const assignedTasks = tasks.filter(t => t.duration.teamId !== null);
    let harvestCostCalculations: string[] = [];

    // Harvest Costs
    const harvestCosts = assignedTasks.reduce((total, task) => {
        const taskCost = task.harvestCosts.reduce((taskTotal, cost) => {
            // Only include cost if the team matches the task's assigned team
            if (cost.Team === task.duration.teamId) {
                return taskTotal + cost.harvesterCost + cost.forwarderCost + cost.travelingCost;
            }
            return taskTotal;
        }, 0);

        harvestCostCalculations.push(taskCost.toFixed(2));
        return total + taskCost;
    }, 0);
    
    console.log("Total Harvest Costs: ", harvestCosts);
    console.groupCollapsed("Harvest Cost Calcs")
    console.log(harvestCostCalculations.join('\n'));
    console.groupEnd();

    console.log("");

    // Wheeling Costs and Trailer Costs
    let wheelingCosts: number = 0;
    let trailerCosts: number = 0;
    let trailerCalcs: string[] = [`team.fixMovingCostWithTrailer * (distance / team.trailerAverageSpeed) * team.trailerCost`];
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
                trailerCosts += team.fixMovingCostWithTrailer * (distance / team.trailerAverageSpeed) * team.trailerCost;
                trailerCalcs.push(`${team.fixMovingCostWithTrailer} * (${distance} / ${team.trailerAverageSpeed}) * ${team.trailerCost}`);
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

    // Demand Costs
    // Get inventory balance
    const prodMap = getProductionByProduct(assignedTasks, createPeriodBoundaries(periods)); 
    const demMap = getDemandByProduct(demands);
    const balance: { [key: string]: number } = {};
    let demandCostCalc: string[] = [`result * goal`];

    Object.keys(prodMap).forEach(product => {
        const prodTotal = prodMap[product].reduce((sum, val) => sum + val, 0);
        const demandTotal = demMap[product].reduce((sum, val) => sum + val, 0);
        const diff = prodTotal - demandTotal;

        balance[product] = diff;
    })

    const demandCosts = demands.map(d => {
        const result = balance[d.Product] - demMap[d.Product].reduce((sum, val) => sum + val, 0);
        if (result > 0) {
            demandCostCalc.push(`>0: ${result} * ${d.demand[0].costAboveAckumGoal}`);
            return result * d.demand[0].costAboveAckumGoal;
        } else {
            demandCostCalc.push(`<0: ${result} * ${d.demand[0].costBelowAckumGoal}`);
            return result * d.demand[0].costBelowAckumGoal;
        }
    }).reduce((sum, val) => sum + val, 0);
    
    console.log("Total Demand cost: ", demandCosts);
    console.groupCollapsed("Demand Cost Calcs");
    console.log(demandCostCalc.join('\n'));
    console.groupEnd();

    console.groupCollapsed("Balance");
    console.log(balance);
    console.groupEnd();

    console.log("");    

    let industryValueCalcs: string[] = [`balance[p.Product] * d.value_prod or just 0`];
    
    // Industry Value
    const industryValue = demands.map(d => {
        if (balance[d.Product] > 0) {
            industryValueCalcs.push(`${balance[d.Product]} * ${d.value_prod}`)
            return balance[d.Product] * d.value_prod;
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
        harvestCosts: harvestCosts,
        wheelingCosts: wheelingCosts,
        trailerCosts: trailerCosts,
        demandCosts: demandCosts,
        industryValue: industryValue,
        total: harvestCosts + wheelingCosts + trailerCosts + demandCosts - industryValue
    }
}