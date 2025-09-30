export async function importProjectFromFile(
  file: File
): Promise<{
  periods: Array<{id: string, name: string}>;
  period_lengths: Array<{ id: string; length_hrs: number }>;
  parents: any[];
  tasks: any[];
} | null> {
  return new Promise((resolve) => {
    const reader = new FileReader();
    reader.onload = (e) => {
      try {
        const text = e.target?.result as string;
        if (!text) {
          resolve({ periods: [], period_lengths: [], tasks: [], parents: [] });
          return;
        }
        const json = JSON.parse(text);

        let periods: Array<{id: string, name: string}> = [];
        let period_lengths: Array<{ id: string; length_hrs: number }> = [];
        let parents: any[] = [];
        let tasks: any[] = [];

        if (Array.isArray(json)) {
          if (json.length > 0) {
            if (json[0]?.periods) periods = json[0].periods;
            if (json[0]?.period_lengths) period_lengths = json[0].period_lengths;
            if (json[0]?.tasks) tasks = json[0].tasks;
            if (json[0]?.parents) parents = json[0].parents;
          }
        } else if (typeof json === 'object' && json !== null) {
          periods = Array.isArray(json.periods) ? json.periods : [];
          period_lengths = Array.isArray(json.period_lengths) ? json.period_lengths : [];
          tasks = Array.isArray(json.tasks) ? json.tasks : [];
          parents = Array.isArray(json.parents) ? json.parents : [];
        }
        resolve({ tasks, parents, periods, period_lengths });
      } catch (err) {
        alert('Failed to parse import file.');
        resolve({ periods: [], period_lengths: [], tasks: [], parents: [] });
      }
    };
    reader.onerror = () => {
      alert('Failed to read file.');
      resolve({ periods: [], period_lengths: [], tasks: [], parents: [] });
    };
    reader.readAsText(file);
  });
}