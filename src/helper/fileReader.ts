import { Task } from "../types";

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
    }));

    return tasks;
}