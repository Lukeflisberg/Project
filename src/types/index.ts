export interface Task {
  id: string;
  name: string;
  parentId: string | null; // null means unassigned
  startHour: number;       
  durationHours: number;   
  setup?: number;           
  // Per-team duration override or exclusion: key is team/parent id; value is number (duration) or 'x' to disallow
  specialTeams?: Record<string, number | 'x'>;
  location: {
    lat: number;
    lon: number;
  };
  dependencies: string[]; // array of task IDs that must be completed before this task
  status?: 'not-started' | 'in-progress' | 'completed';
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
  draggingTaskId_unassigned: string | null;
  draggingTaskId_gantt: string | null;

  // Period metadata
  periods: string[];           // ordered list of period ids, e.g., ['P1', 'P2', ... 'P13']
  periodLengthHours: number;   // FIX: fixed length for each period in hours (40)
}