export interface Period {
  id: string;
  name: string;
  length_h: number;
}

export interface Month {
  monthId: string;
  periods: Period[];
}

export interface Task {
  task: Task.Details;
  duration: Task.Duration;
  harvestCosts: Task.Costs[];
  production: Task.Production;
  productivity: Task.Productivity;
}

export namespace Task {
  export interface Details {
    id: string;
    lat: number;
    lon: number;
    avvForm: string;
    barighet: string;
  }

  export interface Duration {
    teamId: string | null;
    startHour: number;
    defaultSetup: number;
    defaultDuration: number;
    specialTeams: Record<string, number | 'X'>;
    fixedCost: number;
    costPerHrs: number;
    
    invalidPeriods?: string[]; 
  }

  export interface Costs {
    Team: string;
    harvesterCost: number;
    forwarderCost: number;
    travelingCost: number;
  }

  export interface Production {
    gtk: number;
    gtn: number;
    ttk: number;
    ttn: number;
    asp: number;
    bmb: number;
    brv: number;
    gm: number;
    grot: number;
    lm: number;
    lt: number;
  }

  export interface Productivity {
    p1: string;
    p2: string;
    p3: string;
    p4: string;
    p5: string;
    p6: string;
    p7: string;
    p8: string;
    p9: string;
    p10: string;
    p11: string;
    p12: string;
    p13: string;
    p14: string;
    p15: string;
    p16: string;
  }
}

export interface Team {
  id: string;
  lat: number;
  lon: number;
  maxWheelingDist_km: number;
  fixWheelingTime: number;
  wheelingSpeed: number;
  fixMovingCostWithoutTrailer: number;
  fixMovingCostWithTrailer: number;
  fixTrailerTime: number;
  trailerCost: number;
  trailerAverageSpeed: number;
  color: string;
}

export interface HarvestCosts {
  activity: string;
  costs: {
    Team: string;
    harvesterCost: number;
    forwarderCost: number;
    travelingCost: number;
  }[];
}

export interface Resource {
  resource: string;
  costPerHrs: number;
  hrsPerWeek: number;
  periods: {
    p1: number;
    p2: number;
    p3: number;
    p4: number;
    p5: number;
    p6: number;
    p7: number;
    p8: number;
    p9: number;
    p10: number;
    p11: number;
    p12: number;
    p13: number;
    p14: number;
    p15: number;
    p16: number;
  }
} // Here. Change the entry to be [p1, p2, p3...]

export interface Demand {
  product: string;
  value_prod: number;
  demand: {
    period: string;
    demand: number;
    costBelowAckumGoal: number;
    costAboveAckumGoal: number;
  }[]
} 

export interface Distance {
  fromTo: string;
  [key: `T${string}`]: number;
} // Same here

export interface Solution {
  team: string;
  tasks: {
    task: string;
    startHour: number;
  }[];
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
  months: Month[];
  resources: Resource[];
  demand: Demand[];
  distances: Distance[];
}