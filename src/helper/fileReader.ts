import { Period } from "../types";

export async function importDataFromFile(
  file: File
): Promise<{
  periods: string[];
  period_length: Period[];
  tasks: Array<{id: string, lat: number, lon: number}>;
  teams: string[];
  durations: Array<{Activity: string, "Fixed cost": number, "Cost/hrs": number, "Default Setup (hrs)": number, "Default Duration (hrs)": number, "Special Teams": Record<string, string | number>}>; 
} | null> {
  return new Promise((resolve) => {
    const reader = new FileReader();
    reader.onload = (e) => {
      try {
        const text = e.target?.result as string;
        if (!text) {
          resolve({ periods: [], period_length: [], tasks: [], teams: [], durations: [] });
          return;
        }
        const json = JSON.parse(text);

        let periods: string[] = [];
        let period_length: Period[] = [];
        let tasks: Array<{id: string, lat: number, lon: number}> = [];
        let teams: string[] = [];
        let durations: Array<{Activity: string, "Fixed cost": number, "Cost/hrs": number, "Default Setup (hrs)": number, "Default Duration (hrs)": number, "Special Teams": Record<string, string | number>}> = [];

        if (Array.isArray(json)) {
          if (json.length > 0) {
            if (json[0]?.periods) periods = json[0].periods;
            if (json[0]?.period_length) period_length = json[0].period_length;
            if (json[0]?.tasks) tasks = json[0].tasks;
            if (json[0]?.teams) teams = json[0].teams;
            if (json[0]?.durations) durations = json[0].durations;
          }
        } else if (typeof json === 'object' && json !== null) {
          periods = Array.isArray(json.periods) ? json.periods : [];
          period_length = Array.isArray(json.period_length) ? json.period_length : [];
          tasks = Array.isArray(json.tasks) ? json.tasks: [];
          teams = Array.isArray(json.teams) ? json.teams : [];
          durations = Array.isArray(json.durations) ? json.durations : [];
        }
        resolve({ periods, period_length, tasks, teams, durations });
      } catch (err) {
        alert('Failed to parse import file.');
        resolve({ periods: [], period_length: [], tasks: [], teams: [], durations: [] });
      }
    };
    reader.onerror = () => {
      alert('Failed to read file.');
      resolve({ periods: [], period_length: [], tasks: [], teams: [], durations: [] });
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