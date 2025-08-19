export interface Task {
  id: string;
  name: string;
  parentId: string | null; // null means unassigned
  startDate: Date;
  endDate: Date;
  location: {
    lat: number;
    lon: number;
  };
  dependencies: string[]; // array of task IDs that must be completed before this task
  status: 'pending' | 'in-progress' | 'completed';
}

export interface Parent {
  id: string;
  name: string;
  color: string;
}

export interface DragData {
  taskId: string;
  sourceParentId: string | null;
  sourceIndex: number;
}

export interface AppState {
  tasks: Task[];
  parents: Parent[];
  selectedTaskId: string | null;
  selectedParentId: string | null;
  dragData: DragData | null;
}