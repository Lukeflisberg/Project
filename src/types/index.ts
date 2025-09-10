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
  
  distance?: number, 
  dependencies?: string[]; 
}

export interface Parent {
  id: string;
  name: string;
  color: string;
}

export interface PeriodLength {
  period: string;
  length_hrs: number;
}

export interface DragData {
  taskId: string;
  sourceParentId: string | null;
  sourceIndex: number;
}

export interface AppState {
  tasks: Task[];
  parents: Parent[];
  periods: string[];           
  period_lengths: Array<{ period: string; length_hrs: number }>; 

  selectedTaskId: string | null;
  selectedParentId: string | null;
  toggledNull: boolean;
  draggingTaskId_unassigned: string | null;
  draggingTaskId_gantt: string | null;
  totalHours: number | null; 
}