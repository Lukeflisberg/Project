import { Task, Parent } from "../types";

export async function importTasksFromFile(file: File, startingId: number): Promise<Task[]> {
    // Read the file text asynchronously
    const text = await file.text();
        
    // Parse JSON
    const raw = JSON.parse(text);

    // Convert raw data into Task[]
    const tasks: Task[] = raw.map((t: any, index: number) => ({
        id: String(startingId + index + 1), // Make dynamic
        name: String(t.name),
        parentId: t.parentId ?? null,
        startDate: new Date(t.startDate),
        endDate: new Date(t.endDate),
        location: {
        lat: Number(t.location.lat),
        lon: Number(t.location.lon),
        },
        dependencies: Array.isArray(t.dependencies) ? t.dependencies : [],
        status: t.status || 'not-started'
    }));

    return tasks;
}

// Check if two date ranges overlap
export function datesOverlap(
    start1: Date, 
    end1: Date, 
    start2: Date, 
    end2: Date
): boolean {
    return start1 <= end2 && start2 <= end1;
}

// Process imported tasks to handle overlaps and missing parents
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

    // Generate colors for new parents
    const parentColors = [
        '#EF4444', '#F97316', '#F59E0B', '#84CC16', 
        '#22C55E', '#06B6D4', '#3B82F6', '#6366F1', 
        '#8B5CF6', '#EC4899', '#F43F5E', '#64748B'
    ];
    const usedColors = new Set(existingParents.map(p => p.color));
    const availableColors = parentColors.filter(color => !usedColors.has(color));

    for (const task of importedTasks) {
        let hasConflict = false;

        // Check if parent exists, create if needed
        if (task.parentId && !existingParentIds.has(task.parentId)) {
            // Create new parent
            const newParent: Parent = {
                id: task.parentId,
                name: `Team ${task.parentId.charAt(0).toUpperCase() + task.parentId.slice(1)}`,
                color: availableColors.shift() || parentColors[parentsToCreate.length % parentColors.length]
            };
            parentsToCreate.push(newParent);
            existingParentIds.add(task.parentId);
        }

        // Check for date overlaps with existing tasks in the same parent
        if (task.parentId) {
            const sameParentTasks = existingTasks.filter(t => t.parentId === task.parentId);
            
            for (const existingTask of sameParentTasks) {
                if (datesOverlap(task.startDate, task.endDate, existingTask.startDate, existingTask.endDate)) {
                    hasConflict = true;
                    break;
                }
            }

            // Also check for overlaps with other imported tasks in the same parent
            if (!hasConflict) {
                const otherImportedInSameParent = tasksToAdd.filter(t => t.parentId === task.parentId);
                for (const otherTask of otherImportedInSameParent) {
                    if (datesOverlap(task.startDate, task.endDate, otherTask.startDate, otherTask.endDate)) {
                        hasConflict = true;
                        break;
                    }
                }
            }
        }

        if (hasConflict) {
            // Move to unassigned due to conflict
            conflictedTasks.push({ ...task, parentId: null });
        } else {
            tasksToAdd.push(task);
        }
    }

    return {
        tasksToAdd,
        parentsToCreate,
        conflictedTasks
    };
}