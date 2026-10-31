import type { Messages } from "./types";

export const ko = {
  // Main window navigation
  "shell.nav.live": "진행 상황",
  "shell.nav.project": "프로젝트",
  "shell.nav.toolbox": "도구함",
  "shell.project": "프로젝트",
  "shell.nav.memo": "메모",
  "shell.nav.settings": "설정",
  "shell.nav.expand": "메뉴 펼치기",
  "shell.nav.collapse": "메뉴 접기",
  "shell.switchToSidebar": "사이드바로 전환",

  // Sidebar window: tabs
  "shell.tab.live": "진행",
  "shell.tab.suggest": "추천",
  "shell.tab.docs": "문서",
  "shell.tab.memo": "메모",

  // Sidebar window: title bar
  "shell.title.toMain": "메인 창으로 전환",
  "shell.title.magnet.auto": "자석: 앞에 있는 창 자동 감지 (누르면 이 창에 고정)",
  "shell.title.magnet.locked": "자석: 이 창에 고정 (누르면 자석 해제)",
  "shell.title.magnet.off": "자석 해제됨 (누르면 자동 감지)",
  "shell.title.unpin": "항상 위 해제",
  "shell.title.pin": "항상 위",
  "shell.title.hide": "숨기기 (Ctrl+Alt+Space)",

  // Sidebar window: docking status bar
  "shell.dock.connecting": "연결 중…",
  "shell.dock.console": "콘솔",
  "shell.dock.claudeDesktop": "Claude 데스크탑",
  "shell.dock.window": "창",
  "shell.dock.right": "{app} 오른쪽에 붙음",
  "shell.dock.left": "{app} 왼쪽에 붙음",
  "shell.dock.inside": "{app} 위에 겹쳐서 붙음",
  "shell.dock.waiting": "{app} 대기 중",
  "shell.dock.edge": "화면 가장자리",
  "shell.dock.locked": "고정",
  "shell.dock.lockNext": "다음에 여는 터미널·편집기 창에 고정해요",
  "shell.dock.floating": "도킹 꺼짐",
} as const;

export const en: Messages<typeof ko> = {
  "shell.nav.live": "Live",
  "shell.nav.project": "Project",
  "shell.nav.toolbox": "Toolbox",
  "shell.project": "Project",
  "shell.nav.memo": "Notes",
  "shell.nav.settings": "Settings",
  "shell.nav.expand": "Expand menu",
  "shell.nav.collapse": "Collapse menu",
  "shell.switchToSidebar": "Switch to sidebar",

  "shell.tab.live": "Live",
  "shell.tab.suggest": "Suggest",
  "shell.tab.docs": "Docs",
  "shell.tab.memo": "Notes",

  "shell.title.toMain": "Switch to main window",
  "shell.title.magnet.auto": "Magnet: follows the window in front (click to stay with this one)",
  "shell.title.magnet.locked": "Magnet: stays with this window (click to turn off)",
  "shell.title.magnet.off": "Magnet off (click to follow the window in front)",
  "shell.title.unpin": "Turn off always on top",
  "shell.title.pin": "Always on top",
  "shell.title.hide": "Hide (Ctrl+Alt+Space)",

  "shell.dock.connecting": "Connecting…",
  "shell.dock.console": "Console",
  "shell.dock.claudeDesktop": "Claude desktop",
  "shell.dock.window": "a window",
  "shell.dock.right": "Docked right of {app}",
  "shell.dock.left": "Docked left of {app}",
  "shell.dock.inside": "Docked over {app}",
  "shell.dock.waiting": "Waiting for {app}",
  "shell.dock.edge": "Screen edge",
  "shell.dock.locked": "locked",
  "shell.dock.lockNext": "Will stay with the next terminal or editor you bring forward",
  "shell.dock.floating": "Docking off",
};
