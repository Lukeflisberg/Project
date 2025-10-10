import { Period, Month, Team, Task } from "../types";

export async function importDataFromFile(
  file: File
): Promise<{
  periods: string[];
  period_length: Period[];
  months: Month[];
  tasks: Task.TaskDetails[];
  teams: Team[];
  durations: any[];
} | null> {
  return new Promise((resolve) => {
    const reader = new FileReader();
    reader.onload = (e) => {
      try {
        const text = e.target?.result as string;
        if (!text) {
          resolve({ periods: [], period_length: [], months: [], tasks: [], teams: [], durations: [] });
          return;
        }
        const json = JSON.parse(text);

        let periods: string[] = [];
        let period_length: Period[] = [];
        let months: Month[] = [];
        let tasks: Task.TaskDetails[] = [];
        let teams: Team[] = [];
        let durations: any[] = [];

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
        }
        resolve({ periods, period_length, months, tasks, teams, durations });
      } catch (err) {
        alert('Failed to parse import file.');
        resolve({ periods: [], period_length: [], months: [], tasks: [], teams: [], durations: [] });
      }
    };
    reader.onerror = () => {
      alert('Failed to read file.');
      resolve({ periods: [], period_length: [], months: [], tasks: [], teams: [], durations: [] });
    };
    reader.readAsText(file);
  });
}

export async function importSolutionFromFile(
  file: File
): Promise<{
  solution: Array<{team: string, tasks: Array<{task: string, start: number}>}>;
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

        let solution: Array<{team: string, tasks: Array<{task: string, start: number}>}> = [];

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