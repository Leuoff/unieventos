import { Temporal } from "@js-temporal/polyfill";

export const INSTITUTIONAL_TIME_ZONE = "America/Sao_Paulo" as const;

/** Interpreta campos datetime-local no fuso institucional, nunca no fuso do dispositivo. */
export function institutionalToInstant(value: string): string {
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2})?$/.test(value)) throw new RangeError("Informe uma data e horário válidos.");
  const date = Temporal.PlainDateTime.from(value);
  return date.toZonedDateTime(INSTITUTIONAL_TIME_ZONE, { disambiguation: "reject" }).toInstant().toString();
}

export function instantToInstitutionalInput(value: string): string {
  return Temporal.Instant.from(value).toZonedDateTimeISO(INSTITUTIONAL_TIME_ZONE).toPlainDateTime().toString({ smallestUnit: "minute" });
}

export function institutionalDate(value: string): string {
  return Temporal.Instant.from(value).toZonedDateTimeISO(INSTITUTIONAL_TIME_ZONE).toPlainDate().toString();
}

export function todayInstitutional(): string { return institutionalDate(new Date().toISOString()); }

export function addDays(date: string, days: number): string {
  return Temporal.PlainDate.from(date).add({ days }).toString();
}

export function monthRange(date: string): { from: string; to: string } {
  const first = Temporal.PlainDate.from(date).with({ day: 1 });
  return { from: first.toString(), to: first.add({ months: 1 }).subtract({ days: 1 }).toString() };
}

export function weekRange(date: string): { from: string; to: string } {
  const day = Temporal.PlainDate.from(date);
  const first = day.subtract({ days: day.dayOfWeek % 7 });
  return { from: first.toString(), to: first.add({ days: 6 }).toString() };
}

/** Limites UTC para um intervalo de datas civis inclusivas. */
export function institutionalDayRange(from: string, to: string) {
  return {
    startsAt: Temporal.PlainDate.from(from).toZonedDateTime(INSTITUTIONAL_TIME_ZONE).toInstant().toString(),
    endsAt: Temporal.PlainDate.from(addDays(to, 1)).toZonedDateTime(INSTITUTIONAL_TIME_ZONE).toInstant().toString(),
  };
}

export function eventOverlapsDay(startsAt: string, endsAt: string, date: string): boolean {
  const range = institutionalDayRange(date, date);
  return new Date(startsAt).getTime() < new Date(range.endsAt).getTime() && new Date(endsAt).getTime() > new Date(range.startsAt).getTime();
}

export function formatEventRange(startsAt: string, endsAt: string): string {
  const format = new Intl.DateTimeFormat("pt-BR", { day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit", timeZone: INSTITUTIONAL_TIME_ZONE });
  const time = new Intl.DateTimeFormat("pt-BR", { hour: "2-digit", minute: "2-digit", timeZone: INSTITUTIONAL_TIME_ZONE });
  return `${format.format(new Date(startsAt))} – ${institutionalDate(startsAt) === institutionalDate(endsAt) ? time.format(new Date(endsAt)) : format.format(new Date(endsAt))}`;
}
