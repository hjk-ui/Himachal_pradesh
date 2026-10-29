export type DashboardStatCard = {
  label: string;
  value: string;
  delta: string;
  icon: string;
  color: string;
  border: string;
};

export type DashboardAlertItem = {
  id: string;
  clientId: string;
  clientName: string;
  clientImage?: string | null;
  type: string;
  severity: 'high' | 'medium' | 'low';
  time: string;
  mood: number;
};

export type DashboardAppointmentItem = {
  id: string;
  clientId: string;
  clientName: string;
  clientImage?: string | null;
  time: string;
  type: string;
  status: 'upcoming' | 'completed';
  isVirtual: boolean;
};

export type DashboardClientItem = {
  id: string;
  name: string;
  image?: string | null;
  lastCheckIn: string;
  mood: number;
  risk: 'high' | 'medium' | 'low';
  streak: number;
};

export type DashboardWeeklyPoint = {
  label: string;
  mood: number;
  checkIns: number;
  appointments: number;
  alerts: number;
};

export type DashboardRiskSlice = {
  name: string;
  value: number;
  fill: string;
};

export type DashboardOverview = {
  stats: DashboardStatCard[];
  alerts: DashboardAlertItem[];
  appointments: DashboardAppointmentItem[];
  clients: DashboardClientItem[];
  weekly: DashboardWeeklyPoint[];
  riskBreakdown: DashboardRiskSlice[];
};
