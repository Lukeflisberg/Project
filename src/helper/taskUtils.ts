import { Task, Period } from '../types';

export const clamp = (v: number, min: number, max: number): number => Math.max(min, Math.min(max, v));
export const endHour = (t: Task): number => t.duration.startHour + effectiveDuration(t);
export const occStart = (t: Task) => t.duration.startHour;
export const occEnd = (t: Task) => endHour(t);

export const setupOf = (t: Task): number => {
  const n = t.duration.defaultSetup ?? 0;
  return Number.isFinite(n) ? Math.max(0, n) : 0;
};

export const effectiveDuration = (t: Task, teamId?: string | null): number => {
  const pid = teamId !== undefined ? teamId : t.duration.teamId;
  const ov = pid ? t.duration.specialTeams?.[pid] : undefined;
  const baseDuration = typeof ov === 'number' ? ov : t.duration.defaultDuration;
  return Math.max(1, baseDuration + setupOf(t));
};

export const isDisallowed = (t: Task, teamId?: string | null): boolean => {
  const pid = teamId !== undefined ? teamId : t.duration.teamId;
  const ov = pid ? t.duration.specialTeams?.[pid] : undefined;
  return ov === 'X';
};

export const findEarliestHour = (
  t: Task, 
  tasks: Task[], 
  totalHour: number, 
  periods: Array<Period>,
  future_teamId: string
): number | null => {  
  const taskDuration = effectiveDuration(t, future_teamId);
  
  // Helper to check if task fits at a given start hour
  const canFitAt = (start: number): boolean => 
    start + taskDuration <= totalHour && isInValidPeriod(t, start, taskDuration, periods);

  // Handle case where there are no existing tasks
  if (tasks.length === 0) {
    if (canFitAt(0)) return 0;

    // Try to find the first valid period
    let cumulativeHour = 0;
    for (const { id, length_h } of periods) {
      if (!t.duration.invalidPeriods?.includes(id) && taskDuration <= length_h && canFitAt(cumulativeHour)) {
        return cumulativeHour;
      }
      cumulativeHour += length_h;
    }
    return null;
  }

  // Check gaps: before first task, between tasks, and after last task
  const gapsToCheck = [
    { start: 0, end: tasks[0].duration.startHour },
    ...tasks.slice(0, -1).map((task, i) => ({ start: endHour(task), end: tasks[i + 1].duration.startHour })),
    { start: endHour(tasks[tasks.length - 1]), end: totalHour }
  ];

  for (const gap of gapsToCheck) {
    if (taskDuration <= gap.end - gap.start && canFitAt(gap.start)) {
      return gap.start;
    }
  }

  console.log(`\n⚠️  No valid slot found - task cannot be placed`);
  return null;
};

// Check if a time slot is in valid periods (doesn't overlap invalid ones)
export const isInValidPeriod = (
  t: Task, 
  startHour: number, 
  duration: number, 
  periods: Array<Period>
): boolean => {
  if (!t.duration.invalidPeriods?.length) return true;

  const endHour = startHour + duration;
  let cumulativeHour = 0;

  for (const { id, length_h } of periods) {
    if (t.duration.invalidPeriods.includes(id)) {
      const periodStart = cumulativeHour;
      const periodEnd = cumulativeHour + length_h;
      
      // Check if the task slot overlaps with this invalid period
      if (startHour < periodEnd && endHour > periodStart) {
        return false;
      }
    }
    cumulativeHour += length_h;
  }

  return true;
};

// Checks if a task's scheduled time overlaps with any invalid period
export function isInInvalidPeriod(task: Task, startHour: number, endHour: number, periods: Period[], periodOffsets: number[]): boolean {
  if (!task.duration.invalidPeriods?.length) return false;

  return task.duration.invalidPeriods.some(invalidPeriod => {
    const idx = periods.findIndex(p => p.id === invalidPeriod);
    if (idx === -1) return false;
    
    const periodStart = periodOffsets[idx];
    const periodEnd = periodStart + periods[idx].length_h;
    return startHour < periodEnd && endHour > periodStart;
  });
}

export function getTaskColor(task: Task): string {
  return task.task.color;
}

// Returns planned positions for tasks after a move, ensuring no overlaps
export function planSequentialLayoutHours(
  siblings: Task[],
  movedTaskId: string,
  movedNewStartHour: number,
  maxHour: number
): { updates: Array<{ id: string; startHour: number; defaultDuration: number }>; unassign: string[] } {
  const local = siblings.map(t => ({ ...t }));
  const moved = local.find(t => t.task.id === movedTaskId);
  if (!moved) return { updates: [], unassign: [] };

  // Apply moved task's new start
  moved.duration.startHour = clamp(movedNewStartHour, 0, Math.max(0, maxHour));

  // Sort and reorder tasks
  const others = local.filter(t => t.task.id !== movedTaskId)
                      .sort((a, b) => a.duration.startHour - b.duration.startHour);
  
  const movedStart = moved.duration.startHour;
  const insertIndex = others.findIndex(t => t.duration.startHour >= movedStart);
  const orderedTasks = insertIndex === -1 
    ? [...others, moved]
    : [...others.slice(0, insertIndex), moved, ...others.slice(insertIndex)];

  const updates: Array<{ id: string; startHour: number; defaultDuration: number }> = [];
  const unassign: string[] = [];
  
  // Resolve overlaps by pushing tasks right
  const working = orderedTasks.map(t => ({
    task: t,
    duration: effectiveDuration(t, t.duration.teamId),
  }));

  let changed = true;
  let iterations = 0;
  const maxIterations = working.length * 2;

  while (changed && iterations < maxIterations) {
    changed = false;
    iterations++;

    for (let i = 1; i < working.length; i++) {
      const prev = working[i - 1];
      const curr = working[i];
      const prevEnd = prev.task.duration.startHour + prev.duration;
      const currStart = curr.task.duration.startHour;
      
      if (currStart < prevEnd) {
        const newStart = prevEnd;

        // Check if this pushes task beyond boundary
        if (newStart + curr.duration > maxHour) {
          unassign.push(curr.task.task.id);
          working.splice(i, 1);
          i--;
          changed = true;
          continue;
        }

        const clampedStart = clamp(newStart, 0, Math.max(0, maxHour));
        if (clampedStart !== curr.task.duration.startHour) {
          curr.task.duration.startHour = clampedStart;
          changed = true;
        }
      }
    }
  }

  // Generate updates for all tasks that weren't unassigned
  for (const item of working) {
    updates.push({
      id: item.task.task.id,
      startHour: item.task.duration.startHour,
      defaultDuration: item.task.duration.defaultDuration
    });
  }

  return { updates, unassign };
}