import { Period, Month, Task, Team, Resource, Demand, Distances, Solution, HarvestCosts } from "../types";

export async function importDataFromFile(
  file: File
): Promise<{
  periods: string[];
  period_length: Period[];
  months: Month[];
  tasks: Task.Details[];
  teams: Team[];
  durations: Record<string, Task.Duration>[]; 
  harvestCosts: HarvestCosts[];
  production: Record<string, Task.Production>[];
  productivity: Record<string, Task.Productivity>[];
  resource: Resource[];
  demand: Demand[];
  distances: Distances[];
} | null> {
  return new Promise((resolve) => {
    const reader = new FileReader();
    reader.onload = (e) => {
      try {
        const text = e.target?.result as string;
        if (!text) {
          resolve({ periods: [], period_length: [], months: [], tasks: [], teams: [], durations: [], harvestCosts: [], production: [], productivity: [], resource: [], demand: [], distances: [] });
          return;
        }
        const json = JSON.parse(text);

        let periods: string[] = [];
        let period_length: Period[] = [];
        let months: Month[] = [];
        let tasks: Task.Details[] = [];
        let teams: Team[] = [];
        let durations: Record<string, Task.Duration>[] = [];
        let harvestCosts: HarvestCosts[] = [];
        let production: Record<string, Task.Production>[] = [];
        let productivity: Record<string, Task.Productivity>[] = [];
        let resource: Resource[] = [];
        let demand: Demand[] = [];
        let distances: Distances[] = [];

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
            if (json[0]?.productivity) productivity = json[0].productivity;
            if (json[0]?.resource) resource = json[0].resource;
            if (json[0]?.demand) demand = json[0].demand;
            if (json[0]?.distances) distances = json[0].distances;
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
          productivity = Array.isArray(json.productivity) ? json.productivity : [];
          resource = Array.isArray(json.resource) ? json.resource : [];
          demand = Array.isArray(json.demand) ? json.demand : [];
          distances = Array.isArray(json.distances) ? json.distances : [];
        }
        resolve({ periods, period_length, months, tasks, teams, durations, harvestCosts, production, productivity, resource, demand, distances });
      } catch (err) {
        alert('Failed to parse import file.');
        resolve({ periods: [], period_length: [], months: [], tasks: [], teams: [], durations: [], harvestCosts: [], production: [], productivity: [], resource: [], demand: [], distances: [] });
      }
    };
    reader.onerror = () => {
      alert('Failed to read file.');
      resolve({ periods: [], period_length: [], months: [], tasks: [], teams: [], durations: [], harvestCosts: [], production: [], productivity: [], resource: [], demand: [], distances: [] });
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