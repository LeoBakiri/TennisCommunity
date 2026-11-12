// The coach assistant: a chat button on every coach page.
// The model answers from the server; everything it looks up or changes runs here as the coach,
// and a change is only saved after the coach taps Confirm on its card.
import { useCallback, useEffect, useRef, useState } from "react";
import { useNav, useToast, withQuery, type NavApi } from "./nav";
import { Icon } from "./icons";
import { cx } from "./kit";
import { blocksOf, DRAFT_TOOL, READ_TOOLS, toolCalls, toolResult, WRITE_TOOLS, type Block, type Msg, type Proposal } from "@/core/assistant";
import { whatsappHref } from "@/core/clients";

type Card =
  | { kind: "draft"; to: string; text: string; phone: string | null }
  | { kind: "change"; proposal: Proposal; status: "waiting" | "saving" | "done" | "declined" | "failed"; result?: string };

interface Chat {
  messages: Msg[];
  cards: Record<string, Card>;
}

// Kept outside the component so the chat is still there after moving between pages.
let saved: Chat = { messages: [], cards: {} };

const MAX_TURNS = 12;
const SUGGESTIONS = ["What's on tomorrow?", "Who should I rebook?", "Who owes me money?", "Plan my next lesson", "How's this month going?"];

/** A chat left mid-step (the page changed while a card was waiting) drops that unfinished step. */
function tidy(chat: Chat): Chat {
  const last = chat.messages[chat.messages.length - 1];
  if (last?.role === "assistant" && blocksOf(last).some((b) => b.type === "tool_use")) return { ...chat, messages: chat.messages.slice(0, -1) };
  return chat;
}

const plain = (text: string) => text.replace(/\*\*(.+?)\*\*/g, "$1").replace(/^#+\s*/gm, "").trim();

function DraftCard({ card }: { card: Extract<Card, { kind: "draft" }> }) {
  const toast = useToast();
  const href = `${card.phone ? whatsappHref(card.phone) : "https://wa.me/"}?text=${encodeURIComponent(card.text)}`;
  return (
    <div className="rounded-xl border border-ink/10 bg-card">
      <div className="flex items-center gap-2 border-b border-ink/[0.07] px-3.5 py-2 text-[12.5px] font-semibold text-ink/60">
        <Icon name="message" size={14} /> Message for {card.to}
      </div>
      <p className="px-3.5 py-3 text-[14.5px] leading-relaxed whitespace-pre-wrap">{card.text}</p>
      <div className="flex gap-2 px-3.5 pb-3">
        <button
          className="btn btn-outline btn-sm"
          onClick={async () => {
            try {
              await navigator.clipboard.writeText(card.text);
              toast("Copied.");
            } catch {
              toast("Couldn't copy. Press and hold the message to copy it.", "error");
            }
          }}
        >
          <Icon name="copy" size={15} /> Copy
        </button>
        <a className="btn btn-primary btn-sm" href={href} target="_blank" rel="noreferrer">
          <Icon name="external" size={15} /> {card.phone ? "Open in WhatsApp" : "WhatsApp"}
        </a>
      </div>
    </div>
  );
}

function ChangeCard({ card, onDecide }: { card: Extract<Card, { kind: "change" }>; onDecide: (ok: boolean) => void }) {
  const p = card.proposal;
  return (
    <div className={cx("rounded-xl border bg-card", card.status === "waiting" ? "border-brand/40 shadow-sm" : "border-ink/10")}>
      <div className="px-3.5 pt-3 text-[14.5px] font-semibold">{p.title}</div>
      <ul className="space-y-0.5 px-3.5 pt-1 pb-3 text-[14px] text-ink/75">
        {p.lines.map((l, i) => (
          <li key={i}>{l}</li>
        ))}
      </ul>
      {card.status === "waiting" || card.status === "saving" ? (
        <div className="flex gap-2 px-3.5 pb-3">
          <button className={cx("btn btn-sm", p.danger ? "btn-danger" : "btn-primary")} disabled={card.status === "saving"} onClick={() => onDecide(true)}>
            {card.status === "saving" ? "Saving…" : p.confirm}
          </button>
          <button className="btn btn-ghost btn-sm" disabled={card.status === "saving"} onClick={() => onDecide(false)}>
            {p.danger ? "Keep it" : "Cancel"}
          </button>
        </div>
      ) : (
        <div className={cx("flex items-center gap-1.5 border-t border-ink/[0.07] px-3.5 py-2 text-[13px] font-medium", card.status === "done" ? "text-brand" : card.status === "failed" ? "text-[#7A2E24]" : "text-ink/50")}>
          <Icon name={card.status === "done" ? "check" : "x"} size={14} />
          {card.status === "declined" ? "Not changed" : card.result}
        </div>
      )}
    </div>
  );
}

export function CoachAssistant({ firstName }: { firstName: string }) {
  const nav = useNav();
  const latest = useRef<NavApi>(nav);
  latest.current = nav;
  const [open, setOpen] = useState(false);
  const [chat, setChatState] = useState<Chat>(() => tidy(saved));
  const [status, setStatus] = useState<string | null>(null); // what the assistant is doing right now
  const [error, setError] = useState<string | null>(null);
  const [draft, setDraft] = useState("");
  const deciders = useRef(new Map<string, (ok: boolean) => void>());
  const run = useRef(0);
  const scroller = useRef<HTMLDivElement>(null);
  const box = useRef<HTMLTextAreaElement>(null);

  const setChat = useCallback((next: (c: Chat) => Chat) => {
    setChatState((c) => (saved = next(c)));
  }, []);

  useEffect(() => {
    const el = scroller.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [chat, status, open]);
  useEffect(() => {
    if (open && window.matchMedia("(pointer: fine)").matches) box.current?.focus();
  }, [open]);
  // Any card still waiting when the panel goes away counts as turned down.
  useEffect(() => () => deciders.current.forEach((d) => d(false)), []);

  const waiting = Object.values(chat.cards).some((c) => c.kind === "change" && (c.status === "waiting" || c.status === "saving"));
  const busy = status !== null || waiting;

  async function answer(call: Block, mine: number): Promise<Block> {
    const id = call.id!;
    const name = call.name!;
    const input = call.input ?? {};
    const api = latest.current.assistant;
    const setCard = (card: Card) => setChat((c) => ({ ...c, cards: { ...c.cards, [id]: card } }));
    try {
      if (name in READ_TOOLS) {
        setStatus(`${READ_TOOLS[name]}…`);
        return toolResult(id, await api.read(name, input));
      }
      if (name === DRAFT_TOOL) {
        const to = String(input.to ?? "");
        setCard({ kind: "draft", to, text: String(input.text ?? ""), phone: await api.contact(to).catch(() => null) });
        return toolResult(id, "Shown to the coach with copy and WhatsApp buttons. Not sent.");
      }
      if (WRITE_TOOLS.has(name)) {
        const proposal = await api.propose(name, input);
        setCard({ kind: "change", proposal, status: "waiting" });
        setStatus(null);
        const ok = await new Promise<boolean>((resolve) => deciders.current.set(id, resolve));
        deciders.current.delete(id);
        if (!ok || mine !== run.current) {
          setCard({ kind: "change", proposal, status: "declined" });
          return toolResult(id, "The coach tapped Cancel. Nothing was changed.");
        }
        setCard({ kind: "change", proposal, status: "saving" });
        const r = await latest.current.act(proposal.action, proposal.input);
        setCard({ kind: "change", proposal, status: r.ok ? "done" : "failed", result: r.ok ? (r.message ?? "Done.") : r.error });
        if (r.ok) {
          // Show the change on the page behind the chat.
          const now = latest.current;
          now.push(withQuery(now.path, now.search));
        }
        return toolResult(id, r.ok ? (r.message ?? "Saved.") : `Not saved: ${r.error}`, !r.ok);
      }
      return toolResult(id, `Unknown tool ${name}.`, true);
    } catch (e) {
      return toolResult(id, e instanceof Error ? e.message : "That didn't work.", true);
    }
  }

  async function send(text: string) {
    const question = text.trim();
    if (!question || busy) return;
    const mine = ++run.current;
    setDraft("");
    setError(null);
    let messages: Msg[] = [...chat.messages, { role: "user", content: question }];
    const commit = () => setChat((c) => ({ ...c, messages }));
    commit();
    try {
      for (let turn = 0; turn < MAX_TURNS; turn++) {
        setStatus("Thinking…");
        const reply = await latest.current.assistant.ask(messages);
        if (mine !== run.current) return;
        const calls = reply.stop_reason === "tool_use" ? toolCalls(reply) : [];
        if (!calls.length) {
          // A reply cut short can hold half a tool call that can't be answered: keep its words only.
          const cut = reply.content.some((b) => b.type === "tool_use");
          messages = [...messages, { role: "assistant", content: cut ? reply.content.filter((b) => b.type === "text") : reply.content }];
          if (cut && !blocksOf(messages[messages.length - 1]).length) messages = [...messages.slice(0, -1), { role: "assistant", content: [{ type: "text", text: "That got too long to finish. Try asking for one thing at a time." }] }];
          commit();
          return;
        }
        messages = [...messages, { role: "assistant", content: reply.content }];
        commit();
        // Look-ups run together; cards wait for the coach, each on its own.
        const results = await Promise.all(calls.map((c) => answer(c, mine)));
        if (mine !== run.current) return;
        messages = [...messages, { role: "user", content: results }];
        commit();
      }
      setError("That took too many steps. Try asking for one thing at a time.");
    } catch (e) {
      if (mine !== run.current) return;
      // Leave the question in the box's history so it can be asked again, but drop any half-finished step.
      setChat((c) => tidy(c));
      setError(e instanceof Error && e.message && !/failed to fetch|load failed|networkerror/i.test(e.message) ? e.message : "Couldn't reach the assistant. Check your connection and try again.");
    } finally {
      if (mine === run.current) setStatus(null);
    }
  }

  function reset() {
    run.current++;
    deciders.current.forEach((d) => d(false));
    deciders.current.clear();
    setStatus(null);
    setError(null);
    setChat(() => ({ messages: [], cards: {} }));
  }

  if (!open) {
    return (
      <button className="assistant-fab btn btn-primary shadow-lg" onClick={() => setOpen(true)} aria-label="Open the assistant">
        <Icon name="spark" size={18} className="text-accent" />
        <span>Assistant</span>
      </button>
    );
  }

  const empty = !chat.messages.length;
  return (
    <div className="assistant-panel fixed inset-0 z-50 flex flex-col bg-paper md:inset-auto md:right-6 md:bottom-6 md:overflow-hidden md:rounded-2xl md:border md:border-ink/10 md:shadow-2xl" role="dialog" aria-label="Assistant">
      <div className="assistant-head flex items-center gap-2.5 bg-brand px-4 pb-3 text-paper">
        <Icon name="spark" size={19} className="text-accent" />
        <div className="flex-1 font-display text-[16px] font-semibold">Assistant</div>
        {!empty && (
          <button onClick={reset} className="rounded-lg px-2.5 py-1.5 text-[13px] font-medium text-paper/75 hover:bg-paper/10 hover:text-paper">
            New chat
          </button>
        )}
        <button onClick={() => setOpen(false)} className="-mr-1.5 rounded-lg p-1.5 text-paper/75 hover:bg-paper/10 hover:text-paper" aria-label="Close the assistant">
          <Icon name="x" />
        </button>
      </div>

      <div ref={scroller} className="flex-1 space-y-3 overflow-y-auto px-4 py-4">
        {empty && (
          <div className="pt-2">
            <p className="font-display text-[19px] leading-snug font-semibold">Hi {firstName}. What do you need?</p>
            <p className="mt-1.5 text-[14px] leading-relaxed text-ink/60">Ask about your schedule, clients and earnings, get a message or a lesson plan written, or have me book and update lessons. I'll always show you a change before it's saved.</p>
            <div className="mt-4 flex flex-wrap gap-2">
              {SUGGESTIONS.map((s) => (
                <button key={s} onClick={() => send(s)} className="rounded-full border border-ink/12 bg-card px-3.5 py-2 text-[13.5px] font-medium text-ink/80 hover:border-brand/40 hover:text-brand">
                  {s}
                </button>
              ))}
            </div>
            <p className="mt-5 text-[12px] leading-relaxed text-ink/45">Answers are written by Claude, an AI from Anthropic. What you ask, and the schedule, client names and notes it looks up to answer, are sent to it. Phone numbers and emails are not.</p>
          </div>
        )}
        {chat.messages.map((m, i) => {
          if (m.role === "user") {
            return typeof m.content === "string" ? (
              <div key={i} className="flex justify-end">
                <div className="max-w-[85%] rounded-2xl rounded-br-md bg-brand px-3.5 py-2.5 text-[14.5px] leading-relaxed whitespace-pre-wrap text-paper">{m.content}</div>
              </div>
            ) : null;
          }
          return blocksOf(m).map((b, j) => {
            if (b.type === "text" && b.text?.trim()) {
              return (
                <div key={`${i}.${j}`} className="max-w-[92%] text-[14.5px] leading-relaxed whitespace-pre-wrap text-ink">
                  {plain(b.text)}
                </div>
              );
            }
            const card = b.type === "tool_use" && b.id ? chat.cards[b.id] : undefined;
            if (!card) return null;
            return card.kind === "draft" ? <DraftCard key={`${i}.${j}`} card={card} /> : <ChangeCard key={`${i}.${j}`} card={card} onDecide={(ok) => deciders.current.get(b.id!)?.(ok)} />;
          });
        })}
        {status && (
          <div className="flex items-center gap-2 text-[13.5px] text-ink/50" role="status">
            <span className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-brand border-r-transparent" />
            {status}
          </div>
        )}
        {error && <div className="rounded-xl bg-[#7A2E24]/[0.08] px-3.5 py-2.5 text-[13.5px] text-[#7A2E24]">{error}</div>}
      </div>

      <form
        className="assistant-foot flex items-end gap-2 border-t border-ink/[0.08] bg-card px-3 pt-3"
        onSubmit={(e) => {
          e.preventDefault();
          void send(draft);
        }}
      >
        <textarea
          ref={box}
          value={draft}
          rows={1}
          maxLength={4000}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            // Enter sends with a keyboard; on a phone it starts a new line and the button sends.
            if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing && window.matchMedia("(pointer: fine)").matches) {
              e.preventDefault();
              void send(draft);
            }
          }}
          placeholder={waiting ? "Confirm or cancel above first" : "Ask anything about your coaching"}
          disabled={waiting}
          className="input assistant-input flex-1 resize-none"
          aria-label="Message the assistant"
        />
        <button type="submit" className="btn btn-primary h-11 w-11 shrink-0 p-0!" disabled={busy || !draft.trim()} aria-label="Send">
          <Icon name="arrow" size={18} />
        </button>
      </form>
    </div>
  );
}
