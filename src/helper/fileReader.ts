export async function importProjectFromFile(
  file: File
): Promise<{
  periods: string[];
  period_length: Array<{ period: string; length_h: number }>;
  tasks: any[];
  parents: any[];
} | null> {
  return new Promise((resolve) => {
    const reader = new FileReader();
    reader.onload = (e) => {
      try {
        const text = e.target?.result as string;
        if (!text) {
          resolve({ tasks: [], parents: [], periods: [], period_length: [] });
          return;
        }
        const json = JSON.parse(text);

        let periods: string[] = [];
        let period_length: Array<{ period: string; length_h: number }> = [];
        let tasks: any[] = [];
        let parents: any[] = [];

        if (Array.isArray(json)) {
          if (json.length > 0) {
            if (json[0]?.periods) periods = json[0].periods;
            if (json[0]?.period_length) period_length = json[0].period_length;
            if (json[0]?.tasks) tasks = json[0].tasks;
            if (json[0]?.parents) parents = json[0].parents;
          }
        } else if (typeof json === 'object' && json !== null) {
          periods = Array.isArray(json.periods) ? json.periods : [];
          period_length = Array.isArray(json.period_length) ? json.period_length : [];
          tasks = Array.isArray(json.tasks) ? json.tasks : [];
          parents = Array.isArray(json.parents) ? json.parents : [];
        }
        resolve({ tasks, parents, periods, period_length });
      } catch (err) {
        alert('Failed to parse import file.');
        resolve({ tasks: [], parents: [], periods: [], period_length: [] });
      }
    };
    reader.onerror = () => {
      alert('Failed to read file.');
      resolve({ tasks: [], parents: [], periods: [], period_length: [] });
    };
    reader.readAsText(file);
  });
}