import type { Messages } from "./types";

export const ko = {
  "connect.title": "Claude 연결",
  "connect.description":
    "엔셀라가 Claude Code에서 쓰는 프롬프트를 감지하려면 연결이 필요해요. 쓰는 곳에 맞춰 하나만 해도 되고 둘 다 해도 돼요.",
  "connect.done": "연결됨",
  "connect.todo": "{n}단계 남음",
  "connect.recheck": "다시 확인",

  "connect.local.title": "내 컴퓨터의 Claude Code",
  "connect.local.subtitle": "터미널 · cmd · Claude 데스크톱 앱의 Code 탭",
  "connect.local.claude": "Claude Code 설치",
  "connect.local.claudeOk": "Claude Code {version}",
  "connect.local.claudeGuide": "설치 방법",
  "connect.local.mod": "엔셀라 연결 mod 설치",
  "connect.local.modOk": "설치됨. Claude Code를 새로 열면 적용돼요.",
  "connect.local.run": "Claude Code 실행",
  "connect.local.runHint":
    "프로젝트 폴더에서 claude를 실행해요. 엔셀라가 감지해서 옆에 사이드바로 붙어요.",
  "connect.local.runOk": "감지됨 · {project}",
  "connect.local.autoDock": "Claude가 켜지면 사이드바로",

  "connect.cloud.title": "클라우드의 Claude Code",
  "connect.cloud.subtitle": "claude.ai/code · Claude 앱의 원격 세션",
  "connect.cloud.account": "엔셀라 계정 로그인",
  "connect.cloud.accountHint": "클라우드에서 보낸 프롬프트는 이 계정을 거쳐 이 컴퓨터로 와요.",
  "connect.cloud.accountOk": "로그인됨 · {who}",
  "connect.cloud.signIn": "로그인",
  "connect.cloud.enable": "클라우드 연결 켜기",
  "connect.cloud.enableHint": "켜면 이 컴퓨터만의 연결 키가 만들어져요. 끄면 키가 폐기돼요.",
  "connect.cloud.script": "설정 스크립트 붙여넣기",
  "connect.cloud.scriptHint":
    "claude.ai/code에서 환경 메뉴 → Edit → Setup script 맨 끝에 붙여 넣고 저장해요. 네트워크 접근이 Limited면 Allowed domains에 firestore.googleapis.com을 추가해요. 스크립트에 연결 키가 들어 있으니 다른 사람에게 보여주지 마세요.",
  "connect.cloud.copyScript": "스크립트 복사",
  "connect.cloud.copied": "복사했어요. claude.ai/code 환경 설정의 Setup script에 붙여 넣으세요.",
  "connect.cloud.openWeb": "claude.ai/code 열기",
  "connect.cloud.test": "연결 확인",
  "connect.cloud.testHint":
    "새 클라우드 세션을 열고 아무 프롬프트나 보내요. 엔셀라가 켜져 있어야 받아요.",
  "connect.cloud.testOk": "받았어요 · {time}",
  "connect.cloud.advanced": "고급: 설정 스크립트 대신 저장소에 넣기",
  "connect.cloud.advancedHint":
    "저장소에 훅 파일을 커밋하고, 키는 환경 변수 ENCELA_RELAY로 넣어요. 그 저장소에서만 동작해요.",

  "connect.hint.title": "Claude와 연결해 주세요",
  "connect.hint.description":
    "연결하면 Claude Code에서 쓰는 프롬프트가 여기에 실시간으로 보이고 맞는 skill·문서를 추천해요.",
  "connect.hint.button": "연결하기",
};

export const en: Messages<typeof ko> = {
  "connect.title": "Connect Claude",
  "connect.description":
    "Encela needs a connection to see the prompts you write in Claude Code. Set up the one you use, or both.",
  "connect.done": "Connected",
  "connect.todo": "{n} steps left",
  "connect.recheck": "Check again",

  "connect.local.title": "Claude Code on this computer",
  "connect.local.subtitle": "Terminal · cmd · the Code tab of the Claude desktop app",
  "connect.local.claude": "Install Claude Code",
  "connect.local.claudeOk": "Claude Code {version}",
  "connect.local.claudeGuide": "How to install",
  "connect.local.mod": "Install the Encela link mod",
  "connect.local.modOk": "Installed. It applies to new Claude Code sessions.",
  "connect.local.run": "Start Claude Code",
  "connect.local.runHint":
    "Run claude in a project folder. Encela notices it and docks beside it as a sidebar.",
  "connect.local.runOk": "Found · {project}",
  "connect.local.autoDock": "Turn into the sidebar when Claude starts",

  "connect.cloud.title": "Claude Code in the cloud",
  "connect.cloud.subtitle": "claude.ai/code · remote sessions in the Claude app",
  "connect.cloud.account": "Sign in to Encela",
  "connect.cloud.accountHint":
    "Prompts sent in the cloud reach this computer through this account.",
  "connect.cloud.accountOk": "Signed in · {who}",
  "connect.cloud.signIn": "Sign in",
  "connect.cloud.enable": "Turn on the cloud connection",
  "connect.cloud.enableHint":
    "Makes a connection key for this computer. Turning it off revokes the key.",
  "connect.cloud.script": "Paste the setup script",
  "connect.cloud.scriptHint":
    "In claude.ai/code, open the environment menu → Edit, paste it at the end of Setup script and save. With limited network access, add firestore.googleapis.com to Allowed domains. The script holds your connection key; don't share it.",
  "connect.cloud.copyScript": "Copy script",
  "connect.cloud.copied": "Copied. Paste it into Setup script in the claude.ai/code environment.",
  "connect.cloud.openWeb": "Open claude.ai/code",
  "connect.cloud.test": "Check the connection",
  "connect.cloud.testHint":
    "Open a new cloud session and send any prompt. Encela has to be running to receive it.",
  "connect.cloud.testOk": "Received · {time}",
  "connect.cloud.advanced": "Advanced: put it in a repository instead",
  "connect.cloud.advancedHint":
    "Commit the hook file to the repository and put the key in the ENCELA_RELAY environment variable. Works in that repository only.",

  "connect.hint.title": "Connect Claude",
  "connect.hint.description":
    "Once connected, the prompts you write in Claude Code show up here live with the skills and docs that fit.",
  "connect.hint.button": "Connect",
};
