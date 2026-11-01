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
    "클라우드 세션이 시작될 때 엔셀라로 알려주는 스크립트예요. 쓰는 곳을 고르고 아래 순서대로 따라 하면 돼요.",
  "guide.toggle": "단계별 방법",
  "guide.where": "어디서 Claude Code를 쓰나요?",
  "guide.where.app": "데스크톱 앱 · claude.ai/code",
  "guide.where.cli": "터미널(CLI)",
  "guide.copy": "스크립트를 복사해요.",
  "guide.copyOff": "위 2단계에서 클라우드 연결을 먼저 켜요.",
  "guide.app.open": "새 세션 화면에서 입력창 바로 아래 첫 번째 버튼(지금 쓰는 환경 이름)을 눌러요.",
  "guide.app.gear":
    "Cloud 아래에서 쓰는 환경 위에 마우스를 올리고 오른쪽에 나오는 톱니바퀴를 눌러요.",
  "guide.app.gearNote":
    "환경이 없으면 맨 아래 New environment를 눌러요. 이미 열려 있는 세션이면 제목 옆 ▾ → Edit cloud environment로 열 수 있어요.",
  "guide.app.script":
    "Setup script를 누르고, 이미 있는 내용 맨 끝에 복사한 스크립트를 붙여 넣어요.",
  "guide.app.network":
    "Network access를 Full로 바꾸거나, Custom을 고르고 Allowed domains에 아래 주소를 붙여 넣어요.",
  "guide.app.networkNote":
    "기본값 Trusted로는 엔셀라 서버에 닿지 않아요. Custom이면 'Also include default list of common package managers'는 체크된 채로 둬요.",
  "guide.app.save": "Save changes로 저장해요. 다음 4단계에서 새 세션을 열어 확인해요.",
  "guide.cli.setup":
    "클라우드 환경이 아직 없다면 터미널의 Claude Code에서 /web-setup을 실행해요. Default 환경이 만들어져요.",
  "guide.cli.edit":
    "터미널에서는 환경 내용(스크립트·네트워크)을 바꿀 수 없어요. 브라우저의 claude.ai/code에서 '데스크톱 앱' 탭의 2~6단계대로 고쳐요.",
  "guide.cli.showApp": "2~6단계 보기",
  "guide.cli.pick": "터미널로 돌아와 /remote-env로 방금 고친 환경을 골라요.",
  "guide.cli.pickNote": "고른 환경은 이 컴퓨터에서 여는 모든 클라우드 세션의 기본값이 돼요.",
  "guide.cli.run": "클라우드 세션을 열어 아무 프롬프트나 보내요.",
  "guide.cli.runExample": "README 요약해 줘",
  "guide.secret": "스크립트에 이 컴퓨터의 연결 키가 들어 있으니 다른 사람에게 보여주지 마세요.",
  "guide.docs": "공식 문서",
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
    "A script that tells Encela when a cloud session starts. Pick where you use Claude Code and follow the steps below.",
  "guide.toggle": "Step by step",
  "guide.where": "Where do you use Claude Code?",
  "guide.where.app": "Desktop app · claude.ai/code",
  "guide.where.cli": "Terminal (CLI)",
  "guide.copy": "Copy the script.",
  "guide.copyOff": "Turn on the cloud connection in step 2 first.",
  "guide.app.open":
    "On the new session screen, click the first control right under the message box (your environment's name).",
  "guide.app.gear":
    "Under Cloud, hover over the environment you use and click the gear that appears on its right.",
  "guide.app.gearNote":
    "No environment yet? Click New environment at the bottom. In an open session, use ▾ next to the title → Edit cloud environment.",
  "guide.app.script": "Click Setup script and paste the copied script at the end of what's there.",
  "guide.app.network":
    "Set Network access to Full, or pick Custom and paste this host into Allowed domains.",
  "guide.app.networkNote":
    "The default Trusted level doesn't reach Encela's server. With Custom, keep 'Also include default list of common package managers' ticked.",
  "guide.app.save": "Save with Save changes. Step 4 below checks it with a new session.",
  "guide.cli.setup":
    "No cloud environment yet? Run /web-setup in Claude Code in your terminal; it makes the Default environment.",
  "guide.cli.edit":
    "The terminal can't change an environment's script or network. Edit it at claude.ai/code in your browser, following steps 2–6 of the desktop app tab.",
  "guide.cli.showApp": "Show steps 2–6",
  "guide.cli.pick": "Back in the terminal, pick that environment with /remote-env.",
  "guide.cli.pickNote": "It becomes the default for cloud sessions you start on this computer.",
  "guide.cli.run": "Start a cloud session and send any prompt.",
  "guide.cli.runExample": "Summarize the README",
  "guide.secret": "The script holds this computer's connection key; don't share it.",
  "guide.docs": "Official docs",
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
