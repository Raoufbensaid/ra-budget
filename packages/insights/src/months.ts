/**
 * Mois au format « AAAA-MM ». Tous les calculs travaillent sur des chaînes
 * pour éviter les décalages de fuseau horaire des objets Date.
 */
export type MonthKey = string;

export function monthOf(isoDate: string): MonthKey {
  return isoDate.slice(0, 7);
}

/** Mois décalé de `delta` mois (négatif pour reculer). */
export function shiftMonth(month: MonthKey, delta: number): MonthKey {
  const [y = 1970, m = 1] = month.split("-").map(Number);
  const index = y * 12 + (m - 1) + delta;
  const year = Math.floor(index / 12);
  const mm = (index % 12) + 1;
  return `${year}-${String(mm).padStart(2, "0")}`;
}

export function daysInMonth(month: MonthKey): number {
  const [y = 1970, m = 1] = month.split("-").map(Number);
  return new Date(Date.UTC(y, m, 0)).getUTCDate();
}

/** Premier jour du mois (« AAAA-MM-01 »). */
export function firstDay(month: MonthKey): string {
  return `${month}-01`;
}

/** Dernier jour du mois (« AAAA-MM-JJ »). */
export function lastDay(month: MonthKey): string {
  return `${month}-${String(daysInMonth(month)).padStart(2, "0")}`;
}

/** Jour du mois (1 à 31) d'une date « AAAA-MM-JJ ». */
export function dayOf(isoDate: string): number {
  return Number(isoDate.slice(8, 10));
}

/**
 * Nombre de jours écoulés du mois à la date `today` : tout le mois s'il est
 * passé, 0 s'il est à venir.
 */
export function elapsedDays(month: MonthKey, today: string): number {
  const current = monthOf(today);
  if (month < current) return daysInMonth(month);
  if (month > current) return 0;
  return dayOf(today);
}
