export interface Task {
  id: string;
  teamId: string | null; 
  startHour: number;    
  defaultSetup: number;    
  defaultDuration: number;   
  specialTeams: Record<string, number | 'X'>;
  invalidPeriods?: string[];
  location: {
    lat: number;
    lon: number;
  };
}

export interface Team {
  id: string;
  color: string;
}

export interface Period {
  id: string;
  name: string;
  length_h: number;
}

export interface DragData {
  taskId: string;
  sourceTeamId: string | null;
  sourceIndex: number;
}

export interface AppState {
  selectedTaskId: string | null;
  selectedTeamId: string | null;
  dragging_from_gantt: string | null;
  dragging_to_gantt: string | null; 
  totalHours: number;   
  
  toggledNull: boolean;
  toggledDrop: boolean;

  tasks: Task[];
  teams: Team[];
  periods: Period[];  
}