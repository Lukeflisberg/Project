import { Demand, Task, Period } from "../types";
import { endHour } from "./taskUtils";

export function getCumulativeProductionByProduct(tasks: Task[], periods: Period[]) {
    interface CumulativeProduction {
        [productName: string]: number[];
    }

    // Calculate period boundaries (cumulative hours)
    const periodBoundaries: number[] = [];
    let cumulativeHours = 0;
    for (const period of periods) {
        cumulativeHours += period.length_h;
        periodBoundaries.push(cumulativeHours);
    }

    const productNames: string[] = ['GTK', 'GTN', 'TTK', 'TTN', 'ASP', 'BMB', 'BRV', 'GM', 'GROT', 'LM', 'LT'];
    const result: CumulativeProduction = {};
    for (const product of productNames) {
        result[product] = new Array(periodBoundaries.length).fill(0);
    }

    // Process each task
    for (const task of tasks) {
        // Find which period this task completes in
        let completionPeriodIndex = -1;
        for (let i = 0; i < periodBoundaries.length; i++) {
            if (endHour(task) <= periodBoundaries[i]) {
                completionPeriodIndex = i;
                break;
            }
        }

        // If task completes within the planning horizon, add its production
        if (completionPeriodIndex !== -1) {
            for (const [key, value] of Object.entries(task.production)) {
            result[key][completionPeriodIndex] += value;
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

export function getCumulativeDemandByProduct(demand: Demand[]) {
    interface CumulativeDemands {
        [productName: string]: number[];
    }

    const result: CumulativeDemands = {};

    for (const d of demand) {
        const productName: string = d.product;
        const demands: Demand["demand"] = d.demand;

        const cumulative: number[] = [];
        let runningTotal = 0;

        for (const period of demands) {
            runningTotal += period.demand;
            cumulative.push(runningTotal);
        }

        result[productName] = cumulative;
    }

    return result;
}

export const totalHarvesterCost = (task: Task) => {
    const costs: Task.Costs | undefined = task.harvestCosts.find(t => t.Team === task.duration.teamId)
    if (costs) {
        return (costs.harvesterCost + costs.forwarderCost + costs.travelingCost);
    } else {
        return null
    }
}