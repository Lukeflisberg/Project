import { Task } from "../types";

class HistoryManager {
    private history: Task[][] = [];
    private index = -1;

    // --- Core Methods --- 
    init(initialTasks: Task[]) {
        this.history = [this.deepCopyTasks(initialTasks)];
        this.index = 0;

        // console.log(`init called \nlength: (${this.history.length}) \nindex: (${this.index})`);
    }

    clear() {
        this.history = [];
        this.index = -1;
    }

    push(tasks: Task[]) {
        // Don't push if identical to current state
        if (this.index >= 0 && this.tasksEqual(tasks, this.history[this.index])) {
            return;
        }

        // Cut off any redo states
        this.history = this.history.slice(0, this.index + 1);

        // Store deep copy
        this.history.push(this.deepCopyTasks(tasks));
        this.index++;

        // console.log(`pushed called \nlength: (${this.history.length}) \nindex: (${this.index})`);
    }

    undo(): Task[] | null {
        if (this.index > 0) {
            this.index--;

            // console.log(`undo called \nlength: (${this.history.length}) \nindex: (${this.index})`);

            return this.deepCopyTasks(this.history[this.index]);
        }
        return null;
    }

    redo(): Task[] | null {
        if (this.index < this.history.length - 1) {
            this.index++;

            // console.log(`redo called \nlength: (${this.history.length}) \nindex: (${this.index})`);
        
            return this.deepCopyTasks(this.history[this.index]);
        }
        return null;
    }

    present(): Task[] {
        if (this.index >= 0 && this.index < this.history.length) {
            return this.deepCopyTasks(this.history[this.index]);
        }
        return [];
    }

    // --- Deep copy helper ---
    private deepCopyTasks(tasks: Task[]): Task[] {
        return tasks.map(task => ({
            task: { ...task.task },
            duration: { 
                ...task.duration,
                specialTeams: { ...task.duration.specialTeams },
                invalidPeriods: task.duration.invalidPeriods ? [...task.duration.invalidPeriods] : undefined
            },
            harvestCosts: task.harvestCosts.map(cost => ({ ...cost })),
            production: { ...task.production },
            productivity: { ...task.productivity }
        }));
    }

    // --- Equality check ---
    private tasksEqual(tasks1: Task[], tasks2: Task[]): boolean {
        if (tasks1.length !== tasks2.length) return false;
        
        // Quick check: compare JSON strings
        try {
            return JSON.stringify(tasks1) === JSON.stringify(tasks2);
        } catch {
            return false;
        }
    }

    // --- Helpers ---
    get canUndo() {
        return this.index > 0;
    }

    get canRedo() {
        return this.index < this.history.length - 1;
    }

    get currentIndex() {
        return this.index;
    }

    get length() {
        return this.history.length;
    }
}

// Export a single shared instance
export const historyManager = new HistoryManager();