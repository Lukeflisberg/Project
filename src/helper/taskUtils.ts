import { Task, Period } from '../types';

export const clamp = (v: number, min: number, max: number) => Math.max(min, Math.min(max, v));

export const setupOf = (t: Task) => {
  const n = t.defaultSetup ?? 0;
  return Number.isFinite(n) ? Math.max(0, n) : 0;
};

export const effectiveDuration = (t: Task, parentId?: string | null) => {
  const pid = parentId !== undefined ? parentId : t.parentId;
  const ov = pid ? t.specialParents?.[pid] : undefined;
  return typeof ov === 'number' ? Math.max(1, ov + setupOf(t)) : Math.max(1, t.defaultDuration + setupOf(t));
};

export const isDisallowed = (t: Task, parentId?: string | null) => {
  const pid = parentId !== undefined ? parentId : t.parentId;
  const ov = pid ? t.specialParents?.[pid] : undefined;
  return ov === 'X';
};

export const endHour = (t: Task) => t.startHour + effectiveDuration(t);

export const findEarliestHour = (
  // Takes a task and a list of the other tasks. Then find the earliest starthour possible for that task where it doesnt overlap with any of the other tasks and doesnt lie in a invalid period
  t: Task, 
  tasks: Task[], 
  totalHour: number, 
  periods: Array<Period>
) => {  
  // Handle case where therer are no existing tasks
  if (tasks.length === 0) {
    // Check if task first within total hours
    if (effectiveDuration(t) <= totalHour && isInValidPeriod(t, 0, effectiveDuration(t), periods)) {
      return 0;
    }

    // Try to find the first valid period
    let cumulativeHour = 0;
    for (const { id, length_h } of periods) {
      if (!t.invalidPeriods?.includes(id)) {
        if (effectiveDuration(t) <= length_h && cumulativeHour + effectiveDuration(t) <= totalHour) {
          return cumulativeHour;
        }
      }
      cumulativeHour += length_h;
    }

    return null;
  }

  // Check if task can fit before the first task
  if (effectiveDuration(t) <= tasks[0].startHour && 
      isInValidPeriod(t, 0, effectiveDuration(t), periods)) {
    return 0;
  }

  // Iterate over gaps between consecutive tasks
  for (let i = 1; i < tasks.length; i++) {
    const currStart = tasks[i].startHour;
    const prevEnd = endHour(tasks[i-1]);

    console.log('[', prevEnd, '->', currStart, ']');

    // Check if t can be fitted between tasks and in valid periods
    if (prevEnd + effectiveDuration(t) <= currStart &&
        isInValidPeriod(t, prevEnd, effectiveDuration(t), periods)) {
      return prevEnd;
    }
  }

  // Check if t can be fitted after the final task and before total hours
  const lastTask = tasks[tasks.length - 1];
  const potentialStart = endHour(lastTask);
  if (potentialStart + effectiveDuration(t) <= totalHour && 
      isInValidPeriod(t, potentialStart, effectiveDuration(t), periods)) {
    return potentialStart;
  }

  // Can't be fitted anywhere
  return null;
}

// Helper function to check if a time slot overlaps with any invalid periods
export const isInValidPeriod = (
  t: Task, 
  startHour: number, 
  duration: number, 
  periods: Array<Period>
): boolean => {
if (!t.invalidPeriods || t.invalidPeriods.length === 0) {
  return true; // No invalid periods means all period area valid
}

const endHour = startHour + duration;
let cumulativeHour = 0;

// Build a map for period boundaries
for (const { id, length_h } of periods) {
  const periodStart = cumulativeHour;
  const periodEnd = cumulativeHour + length_h;

  // Check if this is an invalid period for the task
  if (t.invalidPeriods.includes(id)) {
    // Check if the task slot overlaps with this invalid period
    if (startHour < periodEnd && endHour > periodStart) {
      return false; // Overlaps with an invalid period
    }
  }

  cumulativeHour += length_h;
}

return true; // DOesnt overlap with any invalid periods
};