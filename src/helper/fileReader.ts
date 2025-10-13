import { Period, Month, Task, Team, Resource, Demand, Distances, Solution, HarvestCosts } from "../types";

export async function importDataFromFile(
  file: File
): Promise<{
  periods: string[];
  period_length: Period[];
  months: Month[];
  tasks: Task.Details[];
  teams: Team[];
  durations: ({Activity: string} & Task.Duration)[]; 
  harvestCosts: HarvestCosts[];
  production: ({Activity: string} & Task.Production)[];
  Productivity: ({Activity: string} & Task.Productivity)[];
  Resource: Resource[];
  Demand: Demand[];
  Distances: Distances[];
} | null> {
  return new Promise((resolve) => {
    const reader = new FileReader();
    reader.onload = (e) => {
      try {
        const text = e.target?.result as string;
        if (!text) {
          resolve({ periods: [], period_length: [], months: [], tasks: [], teams: [], durations: [], harvestCosts: [], production: [], Productivity: [], Resource: [], Demand: [], Distances: [] });
          return;
        }
        const json = JSON.parse(text);

        let periods: string[] = [];
        let period_length: Period[] = [];
        let months: Month[] = [];
        let tasks: Task.Details[] = [];
        let teams: Team[] = [];
        let durations: ({Activity: string} & Task.Duration)[] = [];
        let harvestCosts: HarvestCosts[] = [];
        let production: ({Activity: string} & Task.Production)[] = [];
        let Productivity: ({Activity: string} & Task.Productivity)[] = [];
        let Resource: Resource[] = [];
        let Demand: Demand[] = [];
        let Distances: Distances[] = [];

        if (Array.isArray(json)) {
          if (json.length > 0) {
            if (json[0]?.periods) periods = json[0].periods;
            if (json[0]?.period_length) period_length = json[0].period_length;
            if (json[0]?.months) months = json[0].months;
            if (json[0]?.tasks) tasks = json[0].tasks;
            if (json[0]?.teams) {
              teams = json[0].teams.map((team: any) => ({ 
                ...team,
                color: "#5F8A8B"
              }));
            }
            if (json[0]?.durations) durations = json[0].durations;
            if (json[0]?.harvestCosts) harvestCosts = json[0].harvestCosts;
            if (json[0]?.production) production = json[0].production;
            if (json[0]?.Productivity) Productivity = json[0].Productivity;
            if (json[0]?.Resource) Resource = json[0].Resource;
            if (json[0]?.Demand) Demand = json[0].Demand;
            if (json[0]?.Distances) Distances = json[0].Distances;
          }
        } else if (typeof json === 'object' && json !== null) {
          periods = Array.isArray(json.periods) ? json.periods : [];
          period_length = Array.isArray(json.period_length) ? json.period_length : [];
          months = Array.isArray(json.months) ? json.months : [];
          tasks = Array.isArray(json.tasks) ? json.tasks: [];
          teams = Array.isArray(json.teams) 
            ? json.teams.map((team: any) => ({
              ...team,
              color: "#5F8A8B"
            })) 
            : [];
          durations = Array.isArray(json.durations) ? json.durations : [];
          harvestCosts = Array.isArray(json.harvestCosts) ? json.harvestCosts : [];
          production = Array.isArray(json.production) ? json.production : [];
          Productivity = Array.isArray(json.Productivity) ? json.Productivity : [];
          Resource = Array.isArray(json.resource) ? json.resource : [];
          Demand = Array.isArray(json.demand) ? json.demand : [];
          Distances = Array.isArray(json.distances) ? json.distances : [];
        }
        resolve({ periods, period_length, months, tasks, teams, durations, harvestCosts, production, Productivity, Resource, Demand, Distances });
      } catch (err) {
        alert('Failed to parse import file.');
        resolve({ periods: [], period_length: [], months: [], tasks: [], teams: [], durations: [], harvestCosts: [], production: [], Productivity: [], Resource: [], Demand: [], Distances: [] });
      }
    };
    reader.onerror = () => {
      alert('Failed to read file.');
      resolve({ periods: [], period_length: [], months: [], tasks: [], teams: [], durations: [], harvestCosts: [], production: [], Productivity: [], Resource: [], Demand: [], Distances: [] });
    };
    reader.readAsText(file);
  });
}

export async function importSolutionFromFile(
  file: File
): Promise<{
  solution: Solution[];
} | null> {
  return new Promise((resolve) => {
    const reader = new FileReader();
    reader.onload = (e) => {
      try {
        const text = e.target?.result as string;
        if (!text) {
          resolve({ solution: [] });
          return;
        }
        const json = JSON.parse(text);

        let solution: Solution[] = [];

        if (Array.isArray(json)) {
          if (json.length > 0) {
            if (json[0]?.solution) solution = json[0].solution;
          }
        } else if (typeof json === 'object' && json !== null) {
          solution = Array.isArray(json.solution) ? json.solution : [];
        }
        resolve({ solution });
      } catch (err) {
        alert('Failed to parse import file.');
        resolve({ solution: [] });
      }
    };
    reader.onerror = () => {
      alert('Failed to read file.');
      resolve({ solution: [] });
    };
    reader.readAsText(file);
  });
}