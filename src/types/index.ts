export interface Task {
  id: string;
  name: string;
  parentId: string | null; 
  startHour: number;       
  durationHours: number;   
  setup: number;        
  specialTeams?: Record<string, number | 'x'>;
  invalidPeriods?: string[];
  location: {
    lat: number;
    lon: number;
  };
  
  //TODO
  distance?: number, 
  dependencies?: string[]; 
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
  totalHours: number | null;

  // Period metadata
  periods: string[];           
  period_lengths: Array<{ period: string; length_hrs: number }>; 
}