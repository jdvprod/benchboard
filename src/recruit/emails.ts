/** Emails a volleyball recruit sends college coaches, written from a short form. Pure: unit tested.
 * Short, specific and easy to answer: what a college coach can read in 30 seconds between practices. */

export interface Athlete {
  first: string; last: string; grad: string; pos: string; height: string; reach?: string; approach?: string; block?: string;
  club?: string; clubNum?: string; school?: string; city?: string; gpa?: string; major?: string;
  video?: string; profile?: string; email?: string; phone?: string; clubCoach?: string; clubCoachEmail?: string;
  stats?: string; // one line, e.g. "3.4 kills/set, .285 hitting, 2.1 digs/set"
}
export interface Target { coach?: string; school?: string; why?: string; camp?: string; events?: string }
export type EmailKind = "intro" | "schedule" | "camp" | "thanks" | "video";
export const EMAIL_KINDS: [EmailKind, string, string][] = [
  ["intro", "First email", "Introduce yourself to a program you want to play for."],
  ["schedule", "Tournament schedule", "Tell coaches where to watch you play, a week or two before."],
  ["camp", "After a camp or clinic", "Follow up within two days of a camp, clinic or visit."],
  ["video", "New video", "Send updated film when you have something better."],
  ["thanks", "Thank you", "After a call, a visit or a coach watching you play."],
];

const cap = (s: string) => s.trim().replace(/\s+/g, " ");
const full = (a: Athlete) => cap(`${a.first} ${a.last}`);
const greet = (t: Target) => `Dear ${t.coach?.trim() ? "Coach " + cap(t.coach).replace(/^coach\s+/i, "") : "Coach"},`;
const tag = (a: Athlete) => [a.grad && `Class of ${a.grad}`, a.pos, a.height].filter(Boolean).join(" · ");
const measures = (a: Athlete) => [a.approach && `${a.approach} approach`, a.block && `${a.block} block`, a.reach && `${a.reach} standing reach`].filter(Boolean).join(", ");

function signature(a: Athlete): string {
  return [full(a), tag(a), [a.club && `${a.club}${a.clubNum ? " #" + a.clubNum : ""}`, a.school].filter(Boolean).join(" · "), a.gpa && `GPA ${a.gpa}`,
    a.video && `Highlights: ${a.video}`, a.profile && `Verified stats: ${a.profile}`, [a.email, a.phone].filter(Boolean).join(" · "),
    a.clubCoach && `Club coach: ${a.clubCoach}${a.clubCoachEmail ? " (" + a.clubCoachEmail + ")" : ""}`].filter(Boolean).join("\n");
}
const lines = (s: string) => s.split(/\n|;/).map((x) => x.trim()).filter(Boolean);

export function writeEmail(kind: EmailKind, a: Athlete, t: Target = {}): { subject: string; body: string } {
  const who = `${full(a) || "[Your name]"}${a.grad ? ` (${a.grad}` : ""}${a.pos ? (a.grad ? ", " : " (") + a.pos : ""}${a.grad || a.pos ? ")" : ""}`;
  const school = t.school?.trim() || "[school]";
  const m = measures(a), stat = a.stats?.trim();
  const facts = [stat && `This season: ${stat}.`, m && `Measurables: ${m}.`, a.gpa && `I carry a ${a.gpa} GPA${a.major ? " and want to study " + a.major : ""}.`].filter(Boolean).join(" ");
  const links = [a.video && `Highlight video: ${a.video}`, a.profile && `Verified stats and game log: ${a.profile}`].filter(Boolean).join("\n");
  const ev = t.events ? lines(t.events) : [];
  let subject = "", body = "";
  switch (kind) {
    case "intro":
      subject = `${who}${a.club ? " · " + a.club : ""} · interested in ${t.school?.trim() || "your program"}`;
      body = [greet(t), "",
        `My name is ${full(a) || "[your name]"}, a ${[a.grad && a.grad + " graduate", a.height, a.pos].filter(Boolean).join(" ") || "[class, height, position]"}${a.club ? ` playing for ${a.club}` : ""}${a.school ? ` and ${a.school}` : ""}${a.city ? ` in ${a.city}` : ""}. I'm very interested in ${school}${t.why?.trim() ? ` because ${t.why.trim().replace(/\.$/, "")}` : " [one specific reason: the style of play, a major, something you saw]"}.`,
        "", facts, links && "", links,
        ...(ev.length ? ["", "I'll be playing at:", ...ev.map((x) => "• " + x)] : []),
        "", `I would love to hear what you look for in a ${a.pos || "player"} and whether I could be a fit for ${school}.`, "", "Thank you for your time,", signature(a)].filter((x, i, arr) => !(x === "" && arr[i - 1] === "")).join("\n");
      break;
    case "schedule":
      subject = `${who} · where to watch${ev.length ? " · " + ev[0].split(/[,·]/)[0] : ""}`;
      body = [greet(t), "", `I wanted to share where I'll be playing next${t.school?.trim() ? ` in case you or anyone from ${school} will be there` : ""}:`, "",
        ...(ev.length ? ev.map((x) => "• " + x) : ["• [Tournament], [dates], [city] · court and times once posted"]), "",
        `I'm wearing #${a.clubNum || "[number]"}${a.club ? ` for ${a.club}` : ""}. ${facts}`.trim(), links && "", links, "", "Thank you,", signature(a)].join("\n");
      break;
    case "camp":
      subject = `Thank you for ${t.camp?.trim() || "camp"} · ${who}`;
      body = [greet(t), "", `Thank you for ${t.camp?.trim() ? t.camp.trim() : "the camp [name, date]"}. ${t.why?.trim() ? t.why.trim().replace(/\.$/, "") + "." : "[One thing you learned or a drill you liked, in your own words.]"}`, "",
        `I'm still very interested in ${school} and would love to know what I should work on to be a fit for your program.`, links && "", links, "", "Thank you again,", signature(a)].join("\n");
      break;
    case "video":
      subject = `New film · ${who}`;
      body = [greet(t), "", `I have new film from ${ev[0] || "[tournament or match]"} I wanted to share with you.`, "", links || "Highlight video: [link]", "", facts, "",
        `I'm still very interested in ${school}. Thank you for taking a look.`, "", signature(a)].filter((x, i, arr) => !(x === "" && arr[i - 1] === "")).join("\n");
      break;
    case "thanks":
      subject = `Thank you · ${who}`;
      body = [greet(t), "", `Thank you for ${t.camp?.trim() || "taking the time to [talk with me / watch me play / show me campus]"}. ${t.why?.trim() ? t.why.trim().replace(/\.$/, "") + "." : "[One specific thing that stood out to you.]"}`, "",
        `I'm excited about ${school} and look forward to staying in touch.`, "", "Thank you,", signature(a)].join("\n");
      break;
  }
  return { subject, body };
}

/** What's missing before the email is ready to send. */
export function emailGaps(kind: EmailKind, a: Athlete, t: Target): string[] {
  const out: string[] = [];
  if (!a.first || !a.last) out.push("your name");
  if (!a.grad) out.push("graduation year");
  if (!a.pos) out.push("position");
  if (!t.coach) out.push("the coach's name (find it on the school's roster page)");
  if (!t.school) out.push("the school");
  if ((kind === "intro" || kind === "video") && !a.video) out.push("a highlight video link");
  if (kind === "intro" && !t.why) out.push("one specific reason you like the school");
  if (kind === "schedule" && !t.events) out.push("your tournament schedule");
  if (!a.email) out.push("your email");
  return out;
}
