import { describe, expect, test } from "claude-code/testing";
import {
  defaultStarters,
  fillStarter,
  isNewProject,
  MAX_STARTERS,
  missingFields,
  parseStarters,
  starterFields,
  startersFor,
} from "./starters";

describe("starters", () => {
  test("built-in forms come in the user's language with required fields", () => {
    const ko = defaultStarters("ko");
    expect(ko.map((s) => s.id)).toEqual(["general", "web-app", "automation", "data-ai"]);
    expect(ko[0]?.name).toBe("범용");
    expect(ko[0]?.text).toContain("*프로젝트 주제: ");
    expect(ko[0]?.text).toContain("CLAUDE.md");
    expect(defaultStarters("en")[0]?.text).toContain("*Project topic: ");
  });

  test("the user's forms replace the built-in ones when usable", () => {
    const mine = [{ id: "m", name: "Mine", text: "*Topic: " }];
    expect(startersFor(mine, "ko")).toEqual(mine);
    expect(startersFor(JSON.stringify(mine), "ko")).toEqual(mine);
    expect(startersFor(undefined, "ko")[0]?.name).toBe("범용");
    expect(startersFor("not json", "en")[0]?.name).toBe("General");
    expect(startersFor([{ name: "", text: "x" }], "en")[0]?.name).toBe("General");
  });

  test("bad entries are dropped, ids filled in and the list capped", () => {
    const list = parseStarters([
      { name: "A", text: "a" },
      { name: "B", text: "   " },
      null,
      ...Array.from({ length: 20 }, (_, i) => ({ id: `x${i}`, name: `N${i}`, text: "t" })),
    ]);
    expect(list[0]).toEqual({ id: "s0", name: "A", text: "a" });
    expect(list).toHaveLength(MAX_STARTERS);
  });

  test("required fields with only a hint count as blank", () => {
    const text = [
      "*프로젝트 주제: 할 일 앱",
      "*만들 형태: (웹사이트 / 모바일 앱) ",
      "*핵심 기능: (3개 이내) 목록, 알림",
      "대상 사용자: ",
      "* 마크다운 목록: ",
    ].join("\n");
    expect(missingFields(text)).toEqual(["만들 형태"]);
    expect(missingFields(defaultStarters("en")[0]?.text ?? "")).toEqual([
      "Project topic",
      "Type",
      "Core features",
    ]);
  });

  test("a project is new without CLAUDE.md and decisions", () => {
    expect(isNewProject(false, [])).toBe(true);
    expect(isNewProject(true, [])).toBe(false);
    expect(isNewProject(false, ["platform: web"])).toBe(false);
  });
});

describe("filling a form", () => {
  const form = defaultStarters("ko")[0]?.text ?? "";

  test("fields are the label lines, not the steps heading", () => {
    const fields = starterFields(form);
    expect(fields.map((f) => f.label)).toContain("프로젝트 주제");
    expect(fields.map((f) => f.label)).not.toContain("진행 방식");
    expect(fields.find((f) => f.label === "만들 형태")).toMatchObject({
      required: true,
      hint: "웹사이트 / 모바일 앱 / 데스크톱 앱 / CLI·스크립트 / API 서버 / 기타",
    });
    expect(fields.find((f) => f.label === "대상 사용자")?.required).toBe(false);
    const web = starterFields(defaultStarters("ko")[1]?.text ?? "");
    expect(web.find((f) => f.label === "플랫폼")?.hint).toBe(
      "웹사이트 / 모바일 앱(iOS·Android) / 웹+앱 / 데스크톱",
    );
  });

  test("filled fields get their values; empty optional ones are left out", () => {
    const fields = starterFields(form);
    const at = (label: string) => fields.find((f) => f.label === label)?.line ?? -1;
    const text = fillStarter(form, {
      [at("프로젝트 주제")]: "할 일 앱",
      [at("만들 형태")]: "웹사이트",
      [at("핵심 기능")]: "목록\n알림",
    });
    expect(text).toContain("*프로젝트 주제: 할 일 앱");
    expect(text).toContain("*핵심 기능: 목록, 알림");
    expect(text).not.toContain("대상 사용자");
    expect(text).toContain("진행 방식:");
    expect(missingFields(text)).toEqual([]);
  });
});
