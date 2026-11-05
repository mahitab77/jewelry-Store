const formatter = new Intl.DateTimeFormat("en-GB", { timeZone: "Africa/Cairo", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23" });
export function cairoFields(instant: string | Date): { date: string; time: string } {
  const parts = Object.fromEntries(formatter.formatToParts(new Date(instant)).map((part) => [part.type, part.value]));
  return { date: `${parts.year}-${parts.month}-${parts.day}`, time: `${parts.hour}:${parts.minute}` };
}
// Match absolute instants against the named zone, never the host/browser zone.
// Sampling both sides of the date discovers DST offsets; zero/two matches reject
// nonexistent/ambiguous wall times rather than silently shifting the request.
export function cairoInstant(date: string, time: string): string {
  if (!/^\d{4}-\d\d-\d\d$/.test(date) || !/^\d\d:\d\d$/.test(time)) throw new Error("Use a valid Africa/Cairo date and time.");
  const wall = Date.parse(`${date}T${time}:00.000Z`);
  if (!Number.isFinite(wall) || new Date(wall).toISOString() !== `${date}T${time}:00.000Z`) throw new Error("Use a valid Africa/Cairo date and time.");
  const offsets = new Set<number>();
  for (const hours of [-36, -12, 0, 12, 36]) {
    const sample = wall + hours * 3600000, local = cairoFields(new Date(sample));
    offsets.add(Date.parse(`${local.date}T${local.time}:00.000Z`) - sample);
  }
  const matches = [...offsets].map((offset) => wall - offset).filter((instant) => {
    const local = cairoFields(new Date(instant)); return local.date === date && local.time === time;
  });
  if (matches.length !== 1) throw new Error("That Africa/Cairo time is unavailable or ambiguous because clocks change. Choose another time.");
  return new Date(matches[0]).toISOString();
}
