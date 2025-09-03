import { Task, Parent } from "../types";

const DEFAULT_PERIODS = ['P1','P2','P3','P4','P5','P6','P7','P8','P9','P10','P11','P12','P13'];
const DEFAULT_PERIOD_LEN = 40; // hours per period

function periodToHourIndex(period: string, periods: string[], periodLen: number) {
  const idx = Math.max(0, periods.indexOf(period));
  return idx * periodLen;
}

export async function importTasksFromFile(file: File, startingId: number): Promise<Task[]> {
  const text = await file.text();
  const raw = JSON.parse(text);

  const periods: string[] = Array.isArray(raw?.periods) ? raw.periods : DEFAULT_PERIODS;
  const periodLen: number = Number(raw?.period_length_hours ?? DEFAULT_PERIOD_LEN);

  // Support both array-only tasks and object with { tasks: [...] }
  const tasksRaw: any[] = Array.isArray(raw) ? raw : (raw.tasks ?? raw);

  const tasks: Task[] = tasksRaw.map((t: any, index: number) => {
    let startHour: number;
    let durationHours: number;

    if (t.startHour !== undefined && (t.durationHours !== undefined || t.duration !== undefined)) {
      startHour = Number(t.startHour);
      durationHours = Number(t.durationHours ?? t.duration);
    } else if (t.startPeriod !== undefined || t.start_period !== undefined) {
      const sp = String(t.startPeriod ?? t.start_period ?? 'P1');
      const ep = String(t.endPeriod ?? t.end_period ?? sp);
      const sH = periodToHourIndex(sp, periods, periodLen);
      const eHExclusive = periodToHourIndex(ep, periods, periodLen) + periodLen; // inclusive period -> exclusive hour
      startHour = sH;
      durationHours = eHExclusive - sH;
    } else {
      // Fallback for legacy date format (estimate into hours as 0) - but we expect new format
      startHour = 0;
      durationHours = periodLen; // default 1 period
    }

    return {
      id: String(startingId + index + 1),
      name: String(t.name),
      parentId: t.parentId ?? null,
      startHour,
      durationHours,
      location: {
        lat: Number(t.location?.lat ?? 0),
        lon: Number(t.location?.lon ?? 0),
      },
      dependencies: Array.isArray(t.dependencies) ? t.dependencies : [],
      status: t.status || 'not-started'
    } as Task;
  });

  return tasks;
}

// Check if two hour ranges overlap (end exclusive)
export function hoursOverlap(
  start1: number,
  duration1: number,
  start2: number,
  duration2: number
): boolean {
  const end1 = start1 + duration1;
  const end2 = start2 + duration2;
  return start1 < end2 && start2 < end1;
}

// Process imported tasks to handle overlaps and missing parents (hour-based)
export function processImportedTasks(
  importedTasks: Task[],
  existingTasks: Task[],
  existingParents: Parent[]
): {
  tasksToAdd: Task[];
  parentsToCreate: Parent[];
  conflictedTasks: Task[];
} {
  const tasksToAdd: Task[] = [];
  const conflictedTasks: Task[] = [];
  const parentsToCreate: Parent[] = [];
  const existingParentIds = new Set(existingParents.map(p => p.id));

  const parentColors = [
    '#EF4444', '#F97316', '#F59E0B', '#84CC16',
    '#22C55E', '#06B6D4', '#3B82F6', '#6366F1',
    '#8B5CF6', '#EC4899', '#F43F5E', '#64748B'
  ];
  const usedColors = new Set(existingParents.map(p => p.color));
  const availableColors = parentColors.filter(color => !usedColors.has(color));

  for (const task of importedTasks) {
    let hasConflict = false;

    if (task.parentId && !existingParentIds.has(task.parentId)) {
      const newParent: Parent = {
        id: task.parentId,
        name: `Team ${task.parentId.charAt(0).toUpperCase() + task.parentId.slice(1)}`,
        color: availableColors.shift() || parentColors[parentsToCreate.length % parentColors.length]
      };
      parentsToCreate.push(newParent);
      existingParentIds.add(task.parentId);
    }

    if (task.parentId) {
      const sameParentExisting = existingTasks.filter(t => t.parentId === task.parentId);
      for (const existingTask of sameParentExisting) {
        if (hoursOverlap(task.startHour, task.durationHours, existingTask.startHour, existingTask.durationHours)) {
          hasConflict = true;
          break;
        }
      }

      if (!hasConflict) {
        const otherImportedInSameParent = tasksToAdd.filter(t => t.parentId === task.parentId);
        for (const otherTask of otherImportedInSameParent) {
          if (hoursOverlap(task.startHour, task.durationHours, otherTask.startHour, otherTask.durationHours)) {
            hasConflict = true;
            break;
          }
        }
      }
    }

    if (hasConflict) {
      conflictedTasks.push({ ...task, parentId: null });
    } else {
      tasksToAdd.push(task);
    }
  }

  return { tasksToAdd, parentsToCreate, conflictedTasks };
}