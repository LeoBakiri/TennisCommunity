// A scripted stand-in for the assistant, for the demo preview only: the live site talks to Claude.
// It picks a tool from a keyword and reads the result back, so the chat, the cards and the
// confirm step can all be tried without a server.
import type { AssistantReply, Block, Msg } from "./assistant";
import { addDays, dateKey } from "./time";

let seq = 0;
const call = (name: string, input: Record<string, unknown>): AssistantReply => ({ content: [{ type: "tool_use", id: `demo_${++seq}`, name, input }], stop_reason: "tool_use" });
const say = (text: string): AssistantReply => ({ content: [{ type: "text", text }], stop_reason: "end_turn" });

type Row = Record<string, unknown>;

function readBack(name: string, data: Row): string {
  if (name === "get_schedule") {
    const rows: Row[] = [...((data.community_sessions as Row[]) ?? []).map((s): Row => ({ ...s, what: `${s.type} (${s.booked}/${s.capacity} booked)` })), ...((data.lessons as Row[]) ?? []).map((l): Row => ({ ...l, what: `Lesson with ${(l.clients as string[]).join(", ")}` }))].sort((a, b) => (`${a.date} ${a.time}` < `${b.date} ${b.time}` ? -1 : 1));
    return rows.length ? `Here's your next week:\n${rows.map((r) => `- ${r.day}, ${r.time}: ${r.what}`).join("\n")}` : "Nothing on your schedule in the next week.";
  }
  if (name === "get_clients") {
    const cs = (data.clients as Row[]) ?? [];
    const chase = cs.filter((c) => c.status === "rebook" || c.status === "lapsed");
    return `You have ${cs.length} clients.${chase.length ? ` Worth a message: ${chase.map((c) => `${c.name} (${c.days_since_last} days since their last lesson)`).join(", ")}.` : " Everyone is booked or new."}${cs.some((c) => c.owes) ? `\nOwing you: ${cs.filter((c) => c.owes).map((c) => `${c.name} $${c.owes}`).join(", ")}.` : ""}`;
  }
  if (name === "get_earnings") {
    const e = data.earned_so_far as Row;
    const s = data.still_scheduled as Row;
    return `${data.period}: $${e.take_home} take-home so far from ${e.lessons} lessons and ${e.community_sessions} community sessions, with $${s.take_home} still scheduled.`;
  }
  return "Done.";
}

export function demoReply(messages: Msg[], now: Date): AssistantReply {
  const last = messages[messages.length - 1];
  const today = dateKey(now);
  if (typeof last.content !== "string") {
    // Tool results: read the first one back in words.
    const result = (last.content as Block[]).find((b) => b.type === "tool_result");
    const asked = messages.flatMap((m) => (typeof m.content === "string" ? [] : m.content)).find((b) => b.type === "tool_use" && b.id === result?.tool_use_id);
    if (!result || !asked?.name) return say("Done.");
    try {
      return say(readBack(asked.name, JSON.parse(result.content ?? "{}") as Row));
    } catch {
      // Drafts and changes answer in plain words.
      return say(asked.name === "draft_message" ? "There's a draft for you. Change anything you like before sending." : (result.content ?? "Done."));
    }
  }
  const q = last.content.toLowerCase();
  if (/\bbook\b|every (mon|tue|wed|thu|fri|sat|sun)/.test(q)) return call("book_lesson", { clients: ["Rachel Green"], date: addDays(today, 9), time: "08:00", minutes: 60, price: 100, weeks: 4 });
  if (/message|text|remind|whatsapp|nudge/.test(q)) return call("draft_message", { to: "Rachel Green", text: "Hi Rachel, it's been a few weeks since we worked on that second serve. I have Wednesday at 8am open next week. Want it?" });
  if (/earn|made|month|money|pay(day)?\b/.test(q) && !/owe/.test(q)) return call("get_earnings", { period: "month" });
  if (/client|rebook|owe|lapsed|who/.test(q)) return call("get_clients", {});
  if (/plan|drill/.test(q)) return say("Demo plan for a 60-minute lesson:\n- 0-10 Warm-up: mini tennis, then baseline rally. Cue: split step as they hit.\n- 10-30 Serve: toss placement, then targets. Cue: reach up, not forward.\n- 30-50 Serve plus one: serve, then attack the next ball.\n- 50-60 Tiebreak to 7, second serves only.\nOn the live site the plan is written for the players who are actually coming.");
  return call("get_schedule", { from: today, to: addDays(today, 6) });
}
