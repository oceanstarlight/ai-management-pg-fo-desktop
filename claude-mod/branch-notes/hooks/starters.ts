// Project starters: prompt forms to fill in for the first prompt of a new
// project (no CLAUDE.md, no settled decisions). The app's prompt box
// (src/features/suggest) and its settings import this file too, so it has no
// engine imports. The user's own forms come in the export's
// `suggest.starters` (the app's `promptStarters` pref); without them the
// built-in forms in the user's language are used.

/** A prompt form. Lines starting with `*` are required fields. */
export type Starter = { id: string; name: string; text: string };

/** The app pref that holds the user's forms (a JSON `Starter[]`). */
export const STARTER_PREF = "promptStarters";

/** At most this many forms are kept. */
export const MAX_STARTERS = 8;
/** A form's text is cut to this many characters. */
export const MAX_STARTER_TEXT = 4000;

type Locale = "ko" | "en";

const INTRO: Record<Locale, string> = {
  ko: "새 프로젝트를 시작하려고 해. 아래 내용을 보고 계획부터 같이 세워줘.\n(* 표시는 필수, 나머지는 비워 두면 네가 추천해 줘)",
  en: "I'm starting a new project. Read the details below and plan it with me first.\n(* is required; suggest something for anything I leave blank)",
};

const STEPS: Record<Locale, string> = {
  ko: [
    "진행 방식:",
    "1. 바로 코드를 쓰지 말고, 빠졌거나 애매한 부분이 있으면 먼저 질문해 줘.",
    "2. 기술 스택과 폴더 구조를 이유와 함께 추천해 줘.",
    "3. 작은 단계로 나눈 개발 계획(MVP 먼저)을 보여 주고, 내가 확인하면 시작해.",
    "4. 정해진 내용은 CLAUDE.md에 정리해 줘.",
  ].join("\n"),
  en: [
    "How to proceed:",
    "1. Don't write code yet; ask me first about anything missing or unclear.",
    "2. Recommend a tech stack and folder layout, with reasons.",
    "3. Show a plan in small steps (MVP first) and start once I confirm.",
    "4. Write what we settle in CLAUDE.md.",
  ].join("\n"),
};

const FIELDS: Record<Locale, { id: string; name: string; fields: string[] }[]> = {
  ko: [
    {
      id: "general",
      name: "범용",
      fields: [
        "*프로젝트 주제: ",
        "*만들 형태: (웹사이트 / 모바일 앱 / 데스크톱 앱 / CLI·스크립트 / API 서버 / 기타) ",
        "*핵심 기능: (3개 이내) ",
        "대상 사용자: ",
        "참고하는 서비스·예시: ",
        "선호 기술 스택: (모르면 비워 두기) ",
        "제약 조건: (마감, 예산, 지원 OS·기기, 오프라인 등) ",
        "내 경험 수준: (처음 / 조금 해봄 / 익숙함) ",
      ],
    },
    {
      id: "web-app",
      name: "웹·앱",
      fields: [
        "*프로젝트 주제: ",
        "*플랫폼: (웹사이트 / 모바일 앱(iOS·Android) / 웹+앱 / 데스크톱) ",
        "*핵심 화면·기능: (3~5개) ",
        "대상 사용자: ",
        "로그인·회원: (필요 없음 / 이메일 / 소셜 로그인) ",
        "데이터 저장: (없음 / 기기에만 / 서버·DB) ",
        "디자인 느낌·참고 사이트: ",
        "결제·광고·푸시 알림: (필요한 것만) ",
        "배포·출시: (호스팅 / 앱스토어 / 사내 / 아직 모름) ",
        "선호 기술 스택: (모르면 비워 두기) ",
      ],
    },
    {
      id: "automation",
      name: "자동화·CLI",
      fields: [
        "*자동화할 일: ",
        "*실행 방식: (터미널 명령 / 정해진 시간마다 / 다른 프로그램이 호출 / 챗봇) ",
        "*입력과 결과: (무엇을 받아서 무엇을 내놓나) ",
        "실행 환경: (Windows / macOS / Linux / 서버·클라우드) ",
        "선호 언어: ",
        "연동할 서비스·API: ",
        "실패했을 때: (다시 시도 / 알림 / 기록만) ",
      ],
    },
    {
      id: "data-ai",
      name: "데이터·AI",
      fields: [
        "*목표: (분석 / 예측·분류 / LLM 기능·챗봇 / 대시보드) ",
        "*데이터 출처와 형태: (CSV, DB, API, 크롤링 등과 대략의 양) ",
        "*결과물: (보고서 / 노트북 / API / 웹 대시보드) ",
        "사용할 모델·서비스: ",
        "개인정보·민감 데이터: (있음 / 없음) ",
        "정확도·속도 기준: ",
        "실행 환경: (내 PC / 서버 / 클라우드) ",
      ],
    },
  ],
  en: [
    {
      id: "general",
      name: "General",
      fields: [
        "*Project topic: ",
        "*Type: (website / mobile app / desktop app / CLI or script / API server / other) ",
        "*Core features: (up to 3) ",
        "Who it's for: ",
        "Similar products or examples: ",
        "Preferred tech stack: (leave blank if unsure) ",
        "Constraints: (deadline, budget, supported OS or devices, offline...) ",
        "My experience: (new / some / comfortable) ",
      ],
    },
    {
      id: "web-app",
      name: "Web & app",
      fields: [
        "*Project topic: ",
        "*Platform: (website / mobile app (iOS, Android) / web + app / desktop) ",
        "*Core screens and features: (3-5) ",
        "Who it's for: ",
        "Sign-in: (none / email / social login) ",
        "Data: (none / on the device / server and database) ",
        "Look and feel, reference sites: ",
        "Payments, ads, push notifications: (only what's needed) ",
        "Release: (hosting / app stores / internal / not sure yet) ",
        "Preferred tech stack: (leave blank if unsure) ",
      ],
    },
    {
      id: "automation",
      name: "Automation & CLI",
      fields: [
        "*What to automate: ",
        "*How it runs: (terminal command / on a schedule / called by another program / chat bot) ",
        "*Input and output: (what it takes and what it produces) ",
        "Where it runs: (Windows / macOS / Linux / server or cloud) ",
        "Preferred language: ",
        "Services or APIs to connect: ",
        "On failure: (retry / notify / log only) ",
      ],
    },
    {
      id: "data-ai",
      name: "Data & AI",
      fields: [
        "*Goal: (analysis / prediction or classification / LLM feature or chat bot / dashboard) ",
        "*Data source and shape: (CSV, database, API, scraping... and roughly how much) ",
        "*Deliverable: (report / notebook / API / web dashboard) ",
        "Models or services to use: ",
        "Personal or sensitive data: (yes / no) ",
        "Accuracy and speed targets: ",
        "Where it runs: (my PC / server / cloud) ",
      ],
    },
  ],
};

/** The built-in forms in the user's language. */
export function defaultStarters(locale: Locale): Starter[] {
  return (FIELDS[locale] ?? FIELDS.en).map(({ id, name, fields }) => ({
    id,
    name,
    text: `${INTRO[locale] ?? INTRO.en}\n\n${fields.join("\n")}\n\n${STEPS[locale] ?? STEPS.en}`,
  }));
}

/** The user's forms when they are usable, else the built-in ones. */
export function startersFor(custom: unknown, locale: Locale): Starter[] {
  const list = parseStarters(custom);
  return list.length ? list : defaultStarters(locale);
}

/** Valid forms from a pref value (a JSON string) or a parsed list. */
export function parseStarters(value: unknown): Starter[] {
  let list = value;
  if (typeof list === "string") {
    try {
      list = JSON.parse(list);
    } catch {
      return [];
    }
  }
  if (!Array.isArray(list)) return [];
  const out: Starter[] = [];
  for (const item of list) {
    const name = typeof item?.name === "string" ? item.name.trim() : "";
    const text = typeof item?.text === "string" ? item.text.slice(0, MAX_STARTER_TEXT) : "";
    if (!name || !text.trim()) continue;
    const id = typeof item?.id === "string" && item.id ? item.id : `s${out.length}`;
    out.push({ id, name, text });
    if (out.length >= MAX_STARTERS) break;
  }
  return out;
}

/** What follows a field's colon without its `(hint)`: the hint is the whole
 * rest in parentheses (which may hold more), or a leading one. */
function withoutHint(rest: string): { value: string; hint: string } {
  const t = rest.trim();
  if (/^\(.*\)$/.test(t)) return { value: "", hint: t.slice(1, -1).trim() };
  const m = /^\(([^)]*)\)\s*(.*)$/.exec(t);
  return m ? { value: (m[2] ?? "").trim(), hint: (m[1] ?? "").trim() } : { value: t, hint: "" };
}

/**
 * The required fields (`*name: `) still left blank. A field counts as blank
 * when nothing but its `(hint)` follows the colon.
 */
export function missingFields(text: string): string[] {
  const out: string[] = [];
  for (const line of text.split(/\r?\n/)) {
    const m = /^\s*\*([^\s*:：][^:：]*)[:：](.*)$/.exec(line);
    if (!m) continue;
    if (!withoutHint(m[2] ?? "").value) out.push((m[1] ?? "").trim());
  }
  return out;
}

/** A field of a form: a `label: (hint)` line with nothing filled in yet. */
export type StarterField = { line: number; label: string; hint: string; required: boolean };

/**
 * The fields to fill in: `*label: (hint)` lines (`*` for required) with
 * nothing but the hint after the colon. A heading such as `Steps:` followed
 * by a list is not a field.
 */
export function starterFields(text: string): StarterField[] {
  const lines = text.split(/\r?\n/);
  const out: StarterField[] = [];
  lines.forEach((line, i) => {
    const m = /^\s*(\*?)([^\s*:：(][^:：]*)[:：](.*)$/.exec(line);
    if (!m) return;
    const { value, hint } = withoutHint(m[3] ?? "");
    if (value) return;
    const next = lines.slice(i + 1).find((l) => l.trim());
    if (next && /^\s*(\d+[.)]|[-•])\s/.test(next)) return;
    out.push({ line: i, label: (m[2] ?? "").trim(), hint, required: m[1] === "*" });
  });
  return out;
}

/**
 * The prompt from a form and the values typed for its fields (by line):
 * filled fields become `label: value`, empty optional ones are left out.
 */
export function fillStarter(text: string, values: Record<number, string>): string {
  const fields = new Map(starterFields(text).map((f) => [f.line, f]));
  const out: string[] = [];
  text.split(/\r?\n/).forEach((line, i) => {
    const f = fields.get(i);
    if (!f) {
      out.push(line);
      return;
    }
    const value = (values[i] ?? "").trim().replace(/\s*\n\s*/g, ", ");
    if (value) out.push(`${f.required ? "*" : ""}${f.label}: ${value}`);
    else if (f.required) out.push(line.trimEnd());
  });
  return out
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/** Whether a project is new: no CLAUDE.md and nothing settled yet. */
export function isNewProject(hasClaudeMd: boolean, decisions: string[]): boolean {
  return !hasClaudeMd && decisions.length === 0;
}
