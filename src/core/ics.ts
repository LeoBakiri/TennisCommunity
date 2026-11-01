// Minimal iCalendar export so players can add sessions to Apple/Google/Outlook calendars.
const esc = (s: string) => s.replace(/\\/g, "\\\\").replace(/\n/g, "\\n").replace(/[,;]/g, (m) => `\\${m}`);
const stamp = (iso: string) => iso.replace(/[-:]/g, "").replace(/\.\d{3}/, "");

export function buildIcs(e: { uid: string; title: string; starts_at: string; ends_at: string; location: string; description?: string }): string {
  return [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//Leo Bakiri Tennis//Booking//EN",
    "CALSCALE:GREGORIAN",
    "BEGIN:VEVENT",
    `UID:${e.uid}@leobakiritennis`,
    `DTSTAMP:${stamp(new Date().toISOString())}`,
    `DTSTART:${stamp(new Date(e.starts_at).toISOString())}`,
    `DTEND:${stamp(new Date(e.ends_at).toISOString())}`,
    `SUMMARY:${esc(e.title)}`,
    `LOCATION:${esc(e.location)}`,
    `DESCRIPTION:${esc(e.description ?? "")}`,
    "BEGIN:VALARM",
    "TRIGGER:-PT2H",
    "ACTION:DISPLAY",
    `DESCRIPTION:${esc(e.title)}`,
    "END:VALARM",
    "END:VEVENT",
    "END:VCALENDAR",
  ].join("\r\n");
}

export function googleCalendarUrl(e: { title: string; starts_at: string; ends_at: string; location: string; description?: string }): string {
  const p = new URLSearchParams({
    action: "TEMPLATE",
    text: e.title,
    dates: `${stamp(new Date(e.starts_at).toISOString())}/${stamp(new Date(e.ends_at).toISOString())}`,
    location: e.location,
    details: e.description ?? "",
  });
  return `https://calendar.google.com/calendar/render?${p.toString()}`;
}
