import type { Messages } from "./types";

export const ko = {
  // Work panel: shared
  "work.chooseFolder": "폴더 선택",
  "work.close": "닫기",
  "work.refresh": "새로 고침",
  "work.cancel": "취소",
  "work.create": "만들기",

  // Work panel: flow card, tabs and history
  "notify.merged.title": "PR #{n} 병합됨",
  "notify.merged.body": "{title}",
  "notify.closed.title": "PR #{n} 닫힘",
  "notify.closed.body": "{title}",
  "notify.ciFailed.title": "CI 실패 · PR #{n}",
  "notify.ciFailed.body": "{failed}개 실패했어요. {title}",
  "notify.ciPassed.title": "CI 통과 · PR #{n}",
  "notify.ciPassed.body": "{title}",
} as const;

export const en: Messages<typeof ko> = {
  // Work panel: shared
  "work.chooseFolder": "Choose folder",
  "work.close": "Close",
  "work.refresh": "Refresh",
  "work.cancel": "Cancel",
  "work.create": "Create",

  // Work panel: flow card, tabs and history
  "notify.merged.title": "PR #{n} merged",
  "notify.merged.body": "{title}",
  "notify.closed.title": "PR #{n} closed",
  "notify.closed.body": "{title}",
  "notify.ciFailed.title": "CI failed · PR #{n}",
  "notify.ciFailed.body": "{failed} failed. {title}",
  "notify.ciPassed.title": "CI passed · PR #{n}",
  "notify.ciPassed.body": "{title}",
};
