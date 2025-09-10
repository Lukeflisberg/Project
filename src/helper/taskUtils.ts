import { Task } from '../types';

export const clamp = (v: number, min: number, max: number) => Math.max(min, Math.min(max, v));

export const setupOf = (t: Task) => {
  const n = t.setup ?? 0;
  return Number.isFinite(n) ? Math.max(0, n) : 0;
};

export const effectiveDuration = (t: Task, parentId?: string | null) => {
  const pid = parentId !== undefined ? parentId : t.parentId;
  const ov = pid ? t.specialTeams?.[pid] : undefined;
  return typeof ov === 'number' ? Math.max(1, ov + setupOf(t)) : Math.max(1, t.durationHours + setupOf(t));
};

export const isDisallowed = (t: Task, parentId?: string | null) => {
  const pid = parentId !== undefined ? parentId : t.parentId;
  const ov = pid ? t.specialTeams?.[pid] : undefined;
  return ov === 'x';
};

export const endHour = (t: Task) => t.startHour + effectiveDuration(t);