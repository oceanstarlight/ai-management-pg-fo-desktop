// What may help with a prompt: modules and combinations (from the user's
// file) and catalog blocks (skills, rules, instructions, subagents), picked
// by the same keyword matching the Claude Code mod uses. Claude itself
// judges the shortlist, so no extra model is called here.
import {
  buildCandidates,
  type Candidate,
  keywordRank,
  type SuggestExport,
  tokens,
} from "../../../claude-mod/branch-notes/hooks/suggest";
import { type Block, catalog, type Lang, lang } from "./data";
import type { Hub } from "./store";

export interface Picked {
  modules: { name: string; kind: string; description: string; confidence: number }[];
  combos: {
    name: string;
    goal: string;
    members: { module: string; role: string }[];
    confidence: number;
  }[];
  blocks: {
    id: string;
    kind: Block["kind"];
    name: string;
    title: string;
    summary: string;
    confidence: number;
  }[];
}

const LIMITS = { modules: 3, combos: 2, blocks: 4 };

function blockExport(blocks: Block[], l: Lang): SuggestExport {
  return {
    mode: "keyword",
    library: [],
    extensions: [],
    blocks: blocks.map((b) => ({
      id: b.id,
      kind: b.kind,
      name: b.name,
      title: b.title[l],
      summary: b.summary[l],
      category: b.category[l],
      description: b.description,
    })),
  };
}

function moduleCandidates(hub: Hub): Candidate[] {
  return hub.modules
    .filter((m) => m.inHub)
    .map((m) => ({
      key: `mod:${m.name}`,
      kind: "mcp" as const,
      source: "installed" as const,
      name: m.name,
      description: [m.description, m.tools.map((t) => t.name).join(" ")].join(" "),
      // Its own words count as keywords too: a module described in Korean
      // then matches a Korean request.
      keywords: [
        ...[...m.tags, ...m.capabilities, ...m.inputs, ...m.outputs].flatMap((k) =>
          k.toLowerCase().split(/[\s,/-]+/),
        ),
        ...tokens(m.description),
      ],
    }));
}

/** The shortlist for `prompt`; `min` drops matches less sure than that (1-6). */
export function recommend(prompt: string, hub: Hub, min = 1, l: Lang = lang()): Picked {
  const blocks = catalog().blocks;
  const blockHits = keywordRank(
    prompt,
    buildCandidates([], blockExport(blocks, l)).filter((c) => c.source === "catalog"),
    LIMITS.blocks,
  ).filter((c) => (c.confidence ?? 0) >= min);

  const moduleHits = keywordRank(prompt, moduleCandidates(hub), 20);
  const sure = new Map(moduleHits.map((c) => [c.name, c.confidence ?? 0]));

  const comboCandidates: Candidate[] = hub.combos.map((c) => ({
    key: `combo:${c.name}`,
    kind: "mcp",
    source: "installed",
    name: c.name,
    description: `${c.goal} ${c.members.map((m) => `${m.module} ${m.role}`).join(" ")}`,
  }));
  const own = new Map(
    keywordRank(prompt, comboCandidates, 20).map((c) => [c.name, c.confidence ?? 0]),
  );
  const combos = hub.combos
    .map((c) => {
      const members = c.members.map((m) => sure.get(m.module) ?? 0);
      // A combination fits when it matches itself, or when several members do.
      const matched = members.filter((s) => s > 0).length;
      const confidence = Math.max(
        own.get(c.name) ?? 0,
        matched >= 2 ? Math.min(6, Math.max(...members) + 1) : 0,
      );
      return { name: c.name, goal: c.goal, members: c.members, confidence };
    })
    .filter((c) => c.confidence >= Math.max(min, 1))
    .sort((a, b) => b.confidence - a.confidence)
    .slice(0, LIMITS.combos);

  return {
    modules: moduleHits
      .filter((c) => (c.confidence ?? 0) >= min)
      .slice(0, LIMITS.modules)
      .map((c) => {
        const m = hub.modules.find((x) => x.name === c.name);
        return {
          name: c.name,
          kind: m?.kind ?? "mcp",
          description: m?.description ?? "",
          confidence: c.confidence ?? 0,
        };
      }),
    combos,
    blocks: blockHits.map((c) => {
      const b = blocks.find((x) => x.id === c.blockId) as Block;
      return {
        id: b.id,
        kind: b.kind,
        name: b.name,
        title: b.title[l],
        summary: b.summary[l],
        confidence: c.confidence ?? 0,
      };
    }),
  };
}

/** Catalog blocks matching `query`, best first (weaker matches too). */
export function searchCatalog(
  query: string,
  limit: number,
  l: Lang = lang(),
): { id: string; kind: Block["kind"]; title: string; summary: string }[] {
  const blocks = catalog().blocks;
  return keywordRank(
    query,
    buildCandidates([], blockExport(blocks, l)).filter((c) => c.source === "catalog"),
    limit,
  ).map((c) => {
    const b = blocks.find((x) => x.id === c.blockId) as Block;
    return { id: b.id, kind: b.kind, title: b.title[l], summary: b.summary[l] };
  });
}

export const isEmpty = (p: Picked) => !p.modules.length && !p.combos.length && !p.blocks.length;

/** The shortlist as lines Claude reads. */
export function describe(p: Picked): string {
  const lines: string[] = [];
  for (const c of p.combos) {
    const members = c.members.map((m) => `${m.module}${m.role ? ` (${m.role})` : ""}`).join(" + ");
    lines.push(`- combination "${c.name}" [${c.confidence}/6]: ${c.goal} — ${members}`);
  }
  for (const m of p.modules) {
    lines.push(`- module ${m.name} (${m.kind}) [${m.confidence}/6]: ${m.description}`);
  }
  for (const b of p.blocks) {
    lines.push(`- ${b.kind} ${b.id} "${b.title}" [${b.confidence}/6]: ${b.summary}`);
  }
  return lines.join("\n");
}
