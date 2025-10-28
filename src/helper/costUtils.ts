import { Task, Team, Demand, Period, Distance, Month, TimeWindow, CostBreakdown } from "../types";
import { calculateDemandPerPeriod, calculateProductionPerPeriod, calculateTaskProportion, createPeriodBoundaries, getMonthTimeWindow } from "./chartUtils";
import { endHour } from "./taskUtils";

export function calculateTotalCostBreakdown(
    tasks: Task[], 
    teamFilter: string,
    teams: Team[], 
    demands: Demand[], 
    periods: Period[], 
    distances: Distance[],
    totalHour: number,
    monthFilter?: Month  // Optional month for filtered calculations
): CostBreakdown {
    const assignedTasks = teamFilter === 'all' 
        ? tasks.filter(t => t.duration.teamId !== null).sort((a, b) => a.duration.startHour - b.duration.startHour)
        : tasks.filter(t => t.duration.teamId === teamFilter).sort((a, b,) => a.duration.startHour - b.duration.startHour);
    
    const filteredTeams = teamFilter === 'all' 
        ? teams
        : teams.filter(t => t.id === teamFilter);

    // Calculate time window if month is provided
    let timeWindow: TimeWindow | undefined;
    if (monthFilter) {
        const periodBoundaries = createPeriodBoundaries(periods);
        const monthWindow = getMonthTimeWindow(monthFilter, periodBoundaries);
        // Clamp to totalHour
        timeWindow = {
            start: monthWindow.start,
            end: Math.min(monthWindow.end, totalHour)
        };
    } else {
        // For full horizon, use totalHour as boundary
        timeWindow = {
            start: 0,
            end: totalHour
        };
    }
    
    // Harvester Costs
    const harvesterCosts = assignedTasks.reduce((total, task) => {
        const taskCost = task.harvestCosts.reduce((taskTotal, cost) => {
            if (cost.Team === task.duration.teamId) {
                return taskTotal + cost.harvesterCost;
            }
            return taskTotal;
        }, 0);

        // Apply proportional cost based on time window
        const proportion = calculateTaskProportion(task, timeWindow);
        return total + (taskCost * proportion);
    }, 0);

    // Forwarder Costs
    const forwarderCosts = assignedTasks.reduce((total, task) => {
        const taskCost = task.harvestCosts.reduce((taskTotal, cost) => {
            if (cost.Team === task.duration.teamId) {
                return taskTotal + cost.forwarderCost;
            }
            return taskTotal;
        }, 0);

        const proportion = calculateTaskProportion(task, timeWindow);
        return total + (taskCost * proportion);
    }, 0);

    // Traveling Costs
    const travelingCosts = assignedTasks.reduce((total, task) => {
        const taskCost = task.harvestCosts.reduce((taskTotal, cost) => {
            if (cost.Team === task.duration.teamId) {
                return taskTotal + cost.travelingCost;
            }
            return taskTotal;
        }, 0);

        const proportion = calculateTaskProportion(task, timeWindow);
        return total + (taskCost * proportion);
    }, 0);

    // Wheeling Costs and Trailer Costs
    let wheelingCosts: number = 0;
    let trailerCosts: number = 0;

    for (const team of filteredTeams) {
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
                
            ///////////////////////////

            // option1: travel cost occures when the next task starts
            // option2: travel cost occures during the time between the intial task and the next task

            // option 1:
            if (endHour(fromTask) < timeWindow.end) {
                // get the time between the tasks
                const travelStartHour = endHour(fromTask);
                const travelEndHour = toTask.duration.startHour;
                const timeBetween = travelEndHour - travelStartHour;

                // check the proportion of travel time that falls within the timeWindow
                const overlapStart = Math.max(travelStartHour, timeWindow.start);
                const overlapEnd = Math.min(travelEndHour, timeWindow.end);
                const overlap = Math.max(0, overlapEnd - overlapStart);

                // calculate costs based on that
                const proportion =  overlap / timeBetween;
                // console.log('Travel Start: ', travelStartHour, '\nTravel End: ', travelEndHour, '\nOverlap Start: ', overlapStart, '\nOverlap End: ', overlapEnd, '\nOverlap: ', overlap, '\nTime Between: ', timeBetween, '\nProportion: ', proportion);

                const adjustedDistance = distance * proportion;

                if (distance > team.maxWheelingDist_km) {
                    trailerCosts += (team.fixMovingCostWithTrailer + (adjustedDistance / team.trailerAverageSpeed) * team.trailerCost);
                } else {
                    wheelingCosts += (adjustedDistance * team.fixMovingCostWithoutTrailer);
                }
            }

            // option 2:
            // if (toTask.duration.startHour < timeWindow.end) {
            //     const includeMovement = endHour(fromTask) >= timeWindow.start && endHour(fromTask) < timeWindow.end;

            //     if (includeMovement) {
            //         if (distance > team.maxWheelingDist_km) {
            //             trailerCosts += team.fixMovingCostWithTrailer + (distance / team.trailerAverageSpeed) * team.trailerCost;
            //         } else {
            //             wheelingCosts += distance * team.fixMovingCostWithoutTrailer;
            //         }
            //     }
            // }
        }
    }

    // Demand Penalty Costs and Industry Value
    const periodBoundaries = createPeriodBoundaries(periods);
    const productionByPeriod = calculateProductionPerPeriod(assignedTasks, periodBoundaries, undefined, totalHour); 
    const demandByPeriod = calculateDemandPerPeriod(demands);

    console.log('\n========== DEMAND PENALTY & INDUSTRY VALUE CALCULATION ==========');
    console.log('Period Boundaries:', periodBoundaries.map(p => ({ id: p.id, start: p.total })));
    console.log('\nProduction by Period:', productionByPeriod);
    console.log('\nDemand by Period:', demandByPeriod);

    let demandCost = 0;
    let industryValue = 0;

    if (monthFilter && monthFilter.periods) {
        console.log('\n--- MONTHLY CALCULATION MODE ---');
        console.log('Month Filter Periods:', Array.from(monthFilter.periods));
        
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
        console.log('\nMonth Period Indices:', monthPeriodIndices);

        // Extract month-specific production and demand data
        const m0_productionByPeriod: { [key: string]: number[] } = {};
        const m0_demandByPeriod: { [key: string]: number[] } = {};

        // Build month-specific arrays by extracting only the periods in this month
        Object.keys(productionByPeriod).forEach(product => {
            m0_productionByPeriod[product] = monthPeriodIndices.map(idx => productionByPeriod[product][idx] || 0);
        });

        Object.keys(demandByPeriod).forEach(product => {
            m0_demandByPeriod[product] = monthPeriodIndices.map(idx => demandByPeriod[product][idx] || 0);
        });

        console.log('\nMonth-Specific Production:', m0_productionByPeriod);
        console.log('Month-Specific Demand:', m0_demandByPeriod);

        // Calculate inventory balance period by period within the month
        console.log('\n--- INVENTORY BALANCE CALCULATION ---');
        Object.keys(m0_productionByPeriod).forEach(product => {
            let balance = 0;
            console.log(`\nProduct: ${product}`);

            m0_productionByPeriod[product].forEach((production, index) => {
                const demand = m0_demandByPeriod[product]?.[index] || 0;
                const previousBalance = balance;
                balance = balance + production - demand;
                console.log(`  Period ${index}: Production=${production}, Demand=${demand}, Balance: ${previousBalance} + ${production} - ${demand} = ${balance}`);
            });

            inventoryBalance[product] = balance;
            console.log(`  Final Balance for ${product}: ${balance}`);
        });

        console.log('\n--- DEMAND COST CALCULATION ---');
        const demandCostBreakdown = demands.map(d => {
            const totalDemand = m0_demandByPeriod[d.Product]?.reduce((sum, val) => sum + val, 0) || 0;
            const balance = inventoryBalance[d.Product] || 0;
            const remainder = balance - totalDemand;
            
            console.log(`\nProduct: ${d.Product}`);
            console.log(`  Total Demand: ${totalDemand}`);
            console.log(`  Final Balance: ${balance}`);
            console.log(`  Remainder: ${balance} - ${totalDemand} = ${remainder}`);

            let cost = 0;
            if (remainder > 0) {
                // Overproduction penalty
                cost = remainder * d.demand[0].costAboveAckumGoal;
                console.log(`  Overproduction: ${remainder} × ${d.demand[0].costAboveAckumGoal} = ${cost}`);
            } else {
                // Underproduction penalty
                cost = -remainder * d.demand[0].costBelowAckumGoal;
                console.log(`  Underproduction: ${-remainder} × ${d.demand[0].costBelowAckumGoal} = ${cost}`);
            }
            
            return cost;
        });
        
        demandCost = demandCostBreakdown.reduce((sum, val) => sum + val, 0);
        console.log(`\nTotal Demand Cost: ${demandCost}`);

        // Calculate industry value for the month
        console.log('\n--- INDUSTRY VALUE CALCULATION ---');
        Object.keys(m0_productionByPeriod).forEach(product => {
            const totalProduction = m0_productionByPeriod[product].reduce((sum, val) => sum + val, 0);
            deliveredVolume[product] = totalProduction;
            console.log(`Product ${product}: Total Production = ${totalProduction}`);
        });

        const industryValueBreakdown = demands.map(d => {
            const volume = deliveredVolume[d.Product] || 0;
            const value = volume * d.value_prod;
            console.log(`  ${d.Product}: ${volume} × ${d.value_prod} = ${value}`);
            return value;
        });
        
        industryValue = industryValueBreakdown.reduce((sum, val) => sum + val, 0);
        console.log(`\nTotal Industry Value: ${industryValue}`);
        
    } else {
        console.log('\n--- FULL HORIZON CALCULATION MODE ---');
        
        // Original calculation for full horizon
        const inventoryBalance: { [key: string]: number } = {};

        console.log('\n--- INVENTORY BALANCE CALCULATION ---');
        Object.keys(productionByPeriod).forEach(product => {
            let balance = 0;
            console.log(`\nProduct: ${product}`);

            productionByPeriod[product].forEach((production, index) => {
                const demand = demandByPeriod[product][index] || 0;
                const previousBalance = balance;
                balance = balance + production - demand;
                console.log(`  Period ${index}: Production=${production}, Demand=${demand}, Balance: ${previousBalance} + ${production} - ${demand} = ${balance}`);
            });

            inventoryBalance[product] = balance;
            console.log(`  Final Balance for ${product}: ${balance}`);
        });

        console.log('\n--- DEMAND COST CALCULATION ---');
        const demandCostBreakdown = demands.map(d => {
            const totalDemand = demandByPeriod[d.Product].reduce((sum, val) => sum + val, 0);
            const balance = inventoryBalance[d.Product];
            const remainder = balance - totalDemand;
            
            console.log(`\nProduct: ${d.Product}`);
            console.log(`  Total Demand: ${totalDemand}`);
            console.log(`  Final Balance: ${balance}`);
            console.log(`  Remainder: ${balance} - ${totalDemand} = ${remainder}`);

            let cost = 0;
            if (remainder > 0) {
                cost = remainder * d.demand[0].costAboveAckumGoal;
                console.log(`  Overproduction: ${remainder} × ${d.demand[0].costAboveAckumGoal} = ${cost}`);
            } else {
                cost = -remainder * d.demand[0].costBelowAckumGoal;
                console.log(`  Underproduction: ${-remainder} × ${d.demand[0].costBelowAckumGoal} = ${cost}`);
            }
            
            return cost;
        });
        
        demandCost = demandCostBreakdown.reduce((sum, val) => sum + val, 0);
        console.log(`\nTotal Demand Cost: ${demandCost}`);

        console.log('\n--- INDUSTRY VALUE CALCULATION ---');
        let deliveredVolume: { [key: string]: number } = {};
        Object.keys(productionByPeriod).forEach(product => {
            const totalProduction = productionByPeriod[product].reduce((sum, val) => sum + val, 0);
            deliveredVolume[product] = totalProduction;
            console.log(`Product ${product}: Total Production = ${totalProduction}`);
        });

        const industryValueBreakdown = demands.map(d => {
            const volume = deliveredVolume[d.Product];
            const value = volume * d.value_prod;
            console.log(`  ${d.Product}: ${volume} × ${d.value_prod} = ${value}`);
            return value;
        });
        
        industryValue = industryValueBreakdown.reduce((sum, val) => sum + val, 0);
        console.log(`\nTotal Industry Value: ${industryValue}`);
    }

    console.log('\n========== FINAL RESULTS ==========');
    console.log(`Demand Penalty Cost: ${demandCost}`);
    console.log(`Industry Value: ${industryValue}`);
    console.log('===================================\n');

    return {
        harvesterCosts: harvesterCosts,
        forwarderCosts: forwarderCosts,
        travelingCosts: travelingCosts,
        wheelingCosts: wheelingCosts,
        trailerCosts: trailerCosts,
        demandCost: demandCost,
        industryValue: industryValue,
        totalCost: harvesterCosts + forwarderCosts + travelingCosts + wheelingCosts + trailerCosts
    };
}