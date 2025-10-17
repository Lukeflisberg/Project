import { Task, Period } from '../types';

export const clamp = (v: number, min: number, max: number): number => Math.max(min, Math.min(max, v));

export const setupOf = (t: Task): number => {
  const n = t.duration.defaultSetup ?? 0;
  return Number.isFinite(n) ? Math.max(0, n) : 0;
};

export const effectiveDuration = (t: Task, teamId?: string | null): number => {
  const pid = teamId !== undefined ? teamId : t.duration.teamId;
  const ov = pid ? t.duration.specialTeams?.[pid] : undefined;
  return typeof ov === 'number' ? Math.max(1, ov + setupOf(t)) : Math.max(1, t.duration.defaultDuration + setupOf(t));
};

export const isDisallowed = (t: Task, teamId?: string | null): boolean => {
  const pid = teamId !== undefined ? teamId : t.duration.teamId;
  const ov = pid ? t.duration.specialTeams?.[pid] : undefined;
  return ov === 'X';
};

export const endHour = (t: Task): number => t.duration.startHour + effectiveDuration(t);

export const findEarliestHour = (
  // Takes a task and a list of the other tasks. Then find the earliest starthour possible for that task where it doesnt overlap with any of the other tasks and doesnt lie in a invalid period
  t: Task, 
  tasks: Task[], 
  totalHour: number, 
  periods: Array<Period>,
  future_teamId: string
): number | null => {  
  const taskDuration = effectiveDuration(t, future_teamId);
  console.log(`\nFinding earliest hour for task (duration: ${taskDuration}h, total available: ${totalHour}h)`);
  
  // Handle case where there are no existing tasks
  if (tasks.length === 0) {
    console.log(`No existing tasks - checking from hour 0`);
    
    // Check if task fits within total hours
    if (taskDuration <= totalHour && isInValidPeriod(t, 0, taskDuration, periods)) {
      console.log(`✓ Task fits at hour 0`);
      return 0;
    }

    // Try to find the first valid period
    console.log(`✗ Hour 0 invalid, searching through periods...`);
    let cumulativeHour = 0;
    for (const { id, length_h } of periods) {
      if (!t.duration.invalidPeriods?.includes(id)) {
        if (taskDuration <= length_h && cumulativeHour + taskDuration <= totalHour) {
          console.log(`✓ Found valid slot at hour ${cumulativeHour} (in period ${id})`);
          return cumulativeHour;
        }
      }
      cumulativeHour += length_h;
    }

    console.log(`✗ No valid period found for task`);
    return null;
  }

  console.log(`Checking ${tasks.length} existing tasks for gaps`);

  // Check if task can fit before the first task
  const firstTaskStart = tasks[0].duration.startHour;
  console.log(`\n▪ Gap before first task: [0 → ${firstTaskStart}] (${firstTaskStart}h available)`);
  if (taskDuration <= firstTaskStart && 
      isInValidPeriod(t, 0, taskDuration, periods)) {
    console.log(`  ✓ Task fits at hour 0`);
    return 0;
  }
  console.log(`  ✗ Gap too small or invalid period (need ${taskDuration}h)`);

  // Iterate over gaps between consecutive tasks
  for (let i = 1; i < tasks.length; i++) {
    const currStart = tasks[i].duration.startHour;
    const prevEnd = endHour(tasks[i-1]);
    const gapSize = currStart - prevEnd;

    console.log(`\n▪ Gap ${i}: [${prevEnd} → ${currStart}] (${gapSize}h available)`);

    // Check if t can be fitted between tasks and in valid periods
    if (prevEnd + taskDuration <= currStart &&
        isInValidPeriod(t, prevEnd, taskDuration, periods)) {
      console.log(`  ✓ Task fits at hour ${prevEnd}`);
      return prevEnd;
    }
    console.log(`  ✗ Gap too small or invalid period (need ${taskDuration}h)`);
  }

  // Check if t can be fitted after the final task and before total hours
  const lastTask = tasks[tasks.length - 1];
  const potentialStart = endHour(lastTask);
  const remainingHours = totalHour - potentialStart;
  console.log(`\n▪ Gap after last task: [${potentialStart} → ${totalHour}] (${remainingHours}h available)`);
  
  if (potentialStart + taskDuration <= totalHour && 
      isInValidPeriod(t, potentialStart, taskDuration, periods)) {
    console.log(`  ✓ Task fits at hour ${potentialStart}`);
    return potentialStart;
  }
  console.log(`  ✗ Gap too small or invalid period (need ${taskDuration}h)`);

  // Can't be fitted anywhere
  console.log(`\n⚠️  No valid slot found - task cannot be placed`);
  return null;
}

// Helper function to check if a time slot overlaps with any invalid periods
export const isInValidPeriod = (
  t: Task, 
  startHour: number, 
  duration: number, 
  periods: Array<Period>
): boolean => {
if (!t.duration.invalidPeriods || t.duration.invalidPeriods.length === 0) {
  return true; // No invalid periods means all period area valid
}

const endHour = startHour + duration;
let cumulativeHour = 0;

// Build a map for period boundaries
for (const { id, length_h } of periods) {
  const periodStart = cumulativeHour;
  const periodEnd = cumulativeHour + length_h;

  // Check if this is an invalid period for the task
  if (t.duration.invalidPeriods.includes(id)) {
    // Check if the task slot overlaps with this invalid period
    if (startHour < periodEnd && endHour > periodStart) {
      return false; // Overlaps with an invalid period
    }
  }

  cumulativeHour += length_h;
}

return true; // Doesn't overlap with any invalid periods
};

// Checks if a task's scheduled time overlaps with any invalid period.
export function isInInvalidPeriod(task: Task, startHour: number, endHour: number, periods: Period[], periodOffsets: number[]): boolean {
  if (!task.duration.invalidPeriods || !task.duration.invalidPeriods.length) return false;

  for (const invalidPeriod of task.duration.invalidPeriods) {
    const idx: number = periods.findIndex(p => p.id === invalidPeriod)
    if (idx === -1) continue;
    const periodStart: number = periodOffsets[idx];
    const periodEnd: number = periodStart + periods[idx].length_h;
    // If any overlap
    if (startHour < periodEnd && endHour > periodStart) return true;
  }
  return false;
}

// ----------------------
// Task Color Mapping
// ----------------------
// Returns a color based on the task's avvForm value
export function getTaskColor(task: Task, teamColorEntry: string | undefined): string {
  const teamColor = teamColorEntry ?? "#5F8A8B";
  const colorMap: Record<string, string> = {
    '�A': '#f59e0b', // amber-500
    'n/a': teamColor, // fallback to team color
  };
  
  return colorMap[task.task.avvForm] || teamColor;
}