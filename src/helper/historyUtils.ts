import { Task } from "../types";

// Helper function to check if tasks have actually changed
export function tasksEqual(tasks1: Task[], tasks2: Task[]): boolean {
if (tasks1.length !== tasks2.length) return false;

// Quick check: compare JSON strings
try {
    return JSON.stringify(tasks1) === JSON.stringify(tasks2);
} catch {
    return false;
}
}
