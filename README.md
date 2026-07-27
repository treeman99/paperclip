# 사내 배포 안내 (한국어)

> 이 저장소는 Paperclip 원본을 사내용으로 수정한 버전입니다. 원본 소개는 아래 영문 README에 있습니다.
> **처음 설치하신다면 이 섹션만 순서대로 따라 하시면 됩니다.**

## Paperclip이 뭔가요?

AI 에이전트(코딩 봇)를 **직원처럼 관리하는 웹 앱**입니다. 겉보기엔 할 일 관리 도구인데, 담당자가 사람이 아니라 AI입니다. 이슈를 만들어 배정하면 AI가 알아서 코드를 고치고 결과를 올립니다.

**중요:** 채팅 앱이 아닙니다. AI가 **정해진 주기로 스스로 깨어나** 맡은 일을 합니다. 그래서 컴퓨터가 켜져 있어야 계속 일합니다.

## 원본과 뭐가 다른가요?

| 항목 | 내용 |
|---|---|
| **쓸 수 있는 AI가 2개로 제한됨** | ① AWS Bedrock의 Claude ② 사내 서버에 설치된 오픈웨이트 모델 |
| **나머지는 전부 차단** | OpenAI, Gemini, Cursor 등은 설정해도 **실행 시점에 거부**됩니다. 실수로도 외부에 코드가 나가지 않게 하기 위함입니다 |
| **Windows에서 제대로 동작하도록 수정** | 작업을 취소했을 때 프로세스가 살아남던 문제, 경로에 공백이 있으면 실행이 안 되던 문제를 고쳤습니다 |
| **작은 모델에서도 안 죽게 수정** | 사내 모델은 한 번에 처리할 수 있는 글자 수가 적어서 긴 이슈를 만나면 그냥 실패했습니다. 이제 원인을 알려주고 입력을 알아서 줄입니다 |

---

## 어디에 설치할지 먼저 고르세요

두 가지 방식이 있고, 설치 절차가 상당히 다릅니다. **먼저 어느 쪽인지 정한 뒤 해당
경로만 따라가세요.**

| | **개인 PC (Windows)** | **우분투 서버 (팀 공용)** |
|---|---|---|
| 누가 씁니까 | 나 혼자 | 팀 전체 (로그인 필요) |
| AI가 일하는 시간 | **내 PC가 켜져 있을 때만** | 24시간 |
| 코드 빌드·테스트 | 내 PC의 CPU·디스크 | 서버의 CPU·디스크 |
| 데이터 공유 | 안 됨 | 팀이 함께 봄 |
| 쓸 수 있는 AI | 사내 모델 + Bedrock Claude | **사내 모델만** |
| 설치 난이도 | 낮음 | 중간 (systemd·방화벽 필요) |
| 절차 | [경로 A](#경로-a--개인-pc-windows) | [경로 B](#경로-b--우분투-서버-팀-공용) |

> **서버에서 Bedrock을 못 쓰는 이유:** Bedrock 인증은 AWS SSO 로그인에 기대는데, 로그인
> 승인은 사람이 브라우저에서 눌러야 하고 세션이 몇 시간마다 만료됩니다. 화면 없는 서버에
> 그걸 붙이면 밤중에 세션이 끊겨 작업이 멈춥니다. 서버는 사내 모델만 쓰는 것이 안전합니다.

⚠️ **개인 PC에서 공용 서버로 옮기는 자동 이사 기능이 없습니다.** 나중에 팀으로 확대할
계획이라면 중요한 데이터가 쌓이기 전에 판단하세요.

---

## 0단계 — 사내 미러·프록시 설정 (두 경로 공통)

사내망에서 외부 저장소로 바로 못 나가는 환경이라면, 설치를 시작하기 전에 이것부터
맞춰야 합니다. 이 단계를 건너뛰면 다음 단계가 전부 "연결할 수 없음"으로 실패합니다.

```bash
# npm 저장소를 사내 미러로
npm config set registry https://nexus.corp.internal/repository/npm-group/

# 프록시를 거쳐야 하는 환경이라면 추가로
npm config set proxy http://proxy.corp.internal:8080
npm config set https-proxy http://proxy.corp.internal:8080
```

🔴 **`NO_PROXY`에 사내 AI 서버 주소를 반드시 넣으세요.** 안 넣으면 모델 호출이 프록시를
거치게 되고, 응답을 조금씩 흘려보내는 방식(스트리밍)이 프록시에서 끊겨 작업이 중간에
멈추거나 타임아웃으로 실패합니다. 원인을 찾기 매우 어려운 종류의 고장입니다.

```powershell
# Windows — Paperclip을 실행할 창에서 (영구 설정은 시스템 환경 변수에)
$env:HTTP_PROXY  = "http://proxy.corp.internal:8080"
$env:HTTPS_PROXY = "http://proxy.corp.internal:8080"
$env:NO_PROXY    = "localhost,127.0.0.1,llm.corp.internal,.corp.internal"
```

```bash
# 우분투 — 서비스가 읽는 파일에 넣습니다 (B-3에서 만듭니다)
NO_PROXY=localhost,127.0.0.1,llm.corp.internal,.corp.internal
```

우분투에서는 apt 저장소도 사내 미러로 바꿔야 합니다 (`/etc/apt/sources.list`).
사내 표준 이미지를 쓰신다면 이미 되어 있을 수 있으니 `apt-get update`로 먼저 확인하세요.

---

# 경로 A — 개인 PC (Windows)

## A-1. 준비물 챙기기

PowerShell을 열고 하나씩 확인하세요.

```powershell
# 1) Node.js 22.12 이상, 그리고 x64인지 확인
node -p "process.version + ' ' + process.arch"
```

`v22.12.0 x64` 이상이면 OK.

```powershell
# 2) Git 설치 확인 (설치할 때 "Unix tools" 옵션을 켜주세요)
git --version
```

```powershell
# 3) 데이터를 저장할 폴더 만들기 + 권한 잠그기
$Root = 'C:\PaperclipData'
New-Item -ItemType Directory -Force -Path $Root | Out-Null
icacls $Root /inheritance:r /grant:r "Administrators:(OI)(CI)F" /grant:r "$env:USERNAME:(OI)(CI)F"
```

🔴 **3번은 건너뛰지 마세요.** 이 폴더에 **AWS 접속 정보와 사내 AI 토큰을 푸는 열쇠 파일**이 저장됩니다. Windows에서는 프로그램이 파일 권한을 스스로 잠그지 못해서, 폴더 권한을 미리 잠가두지 않으면 그 PC의 다른 사용자가 열어볼 수 있습니다. 특히 `C:\ProgramData` 아래에는 **절대 두지 마세요.**

그리고 미리 받아두셔야 할 정보:

- **사내 AI 서버 주소와 토큰** (담당 부서에서 받으세요)
- **AWS 계정 정보** (Bedrock을 쓸 경우)

## A-2. PostgreSQL 설치하기

Paperclip은 데이터를 PostgreSQL에 저장합니다. **직접 설치해서 쓰세요.**

> **왜 내장 DB를 쓰지 않나요?** 프로그램에 딸려 오는 내장 PostgreSQL이 있긴 한데,
> Windows에서 자주 실패합니다. 관리자 권한으로 실행하면 아예 뜨지 않고, arm64 CPU에서는
> 지원하지 않으며, 실패해도 원인을 제대로 알려주지 않습니다. 설치가 한 번 더 필요하지만
> 직접 설치한 PostgreSQL이 훨씬 안정적입니다.

**1) 설치 프로그램 내려받기**

[postgresql.org/download/windows](https://www.postgresql.org/download/windows/) 에서
EDB 설치 프로그램을 받으세요. **버전 17**을 권장합니다.
(사내에 소프트웨어 배포 시스템이 있다면 거기서 받으셔도 됩니다.)

**2) 설치 마법사에서 이렇게 고르세요**

| 화면 | 선택 |
|---|---|
| Select Components | **PostgreSQL Server**, **Command Line Tools** 는 필수. pgAdmin은 있으면 편하고, **Stack Builder는 체크 해제** |
| Password | 슈퍼유저(`postgres`) 비밀번호. **적어두세요** — 다음 단계에서 씁니다 |
| Port | `5432` (기본값 그대로) |
| Locale | `Default locale` |

**3) 서비스가 떴는지 확인**

```powershell
Get-Service postgresql*
```

`Running` 이면 됩니다. Windows 서비스로 등록되므로 **PC를 켤 때마다 자동으로 시작**됩니다.

**4) Paperclip 전용 사용자와 데이터베이스 만들기**

`postgres` 슈퍼유저를 그대로 쓰지 마세요. 앱 전용 계정을 따로 만듭니다.

```powershell
$PgBin = 'C:\Program Files\PostgreSQL\17\bin'
$DbPassword = '여기에-충분히-긴-비밀번호'

& "$PgBin\psql.exe" -U postgres -c "CREATE USER paperclip WITH PASSWORD '$DbPassword';"
& "$PgBin\psql.exe" -U postgres -c "CREATE DATABASE paperclip OWNER paperclip;"
```

(슈퍼유저 비밀번호를 물어봅니다. 2)에서 정한 값입니다.)

**5) 접속되는지 확인**

```powershell
$env:PGPASSWORD = $DbPassword
& "$PgBin\psql.exe" -U paperclip -h 127.0.0.1 -d paperclip -c "SELECT version();"
Remove-Item Env:\PGPASSWORD
```

버전 문자열이 나오면 성공입니다.

**6) (권장) 바깥에서 못 붙게 막기**

기본 설치는 모든 네트워크 카드에서 접속을 기다립니다. 접속 허용 목록이 localhost만
열어 두기 때문에 실제로 외부에서 붙지는 못하지만, 아예 듣지 않게 하는 편이 낫습니다.
`C:\Program Files\PostgreSQL\17\data\postgresql.conf` 에서:

```
listen_addresses = 'localhost'
```

로 바꾸고 서비스를 다시 시작하세요.

```powershell
Restart-Service postgresql-x64-17
```

<details>
<summary><b>비밀번호에 특수문자를 쓰셨다면</b> — 접속 주소를 만들 때 주의</summary>

접속 주소는 웹 주소와 같은 형식이라 `@ : / ? # &` 같은 문자가 들어가면 잘못 읽힙니다.
아래처럼 변환한 값을 넣으세요.

```powershell
[uri]::EscapeDataString('p@ss:word/1')   # 결과: p%40ss%3Aword%2F1
```

번거로우면 **영문·숫자만으로 긴 비밀번호**를 쓰는 편이 낫습니다.
</details>

## A-3. Paperclip 설치하기

```powershell
$env:DATABASE_URL = "postgres://paperclip:비밀번호@127.0.0.1:5432/paperclip"
npx paperclipai onboard --yes --data-dir C:\PaperclipData
```

`DATABASE_URL`을 넣은 채로 실행해야 설정 파일(`C:\PaperclipData\config.json`)에
PostgreSQL 사용이 기록됩니다. **한 번만 넣으면 되고, 이후 실행할 때는 다시 넣지 않아도
됩니다.** 설치가 끝나면 접속 주소를 알려주니 브라우저로 들어가시면 됩니다.

나중에 접속 정보를 바꾸려면 `npx paperclipai configure --section database` 를 쓰세요.

이후 실행은 이렇게 합니다.

```powershell
npx paperclipai run --data-dir C:\PaperclipData
```

> **PC를 켤 때 자동으로 띄우고 싶다면** 작업 스케줄러에 "로그온할 때" 트리거로 위 명령을
> 등록하세요. 다만 **AI는 이 창이 떠 있는 동안에만 일합니다.** 창을 닫거나 PC가 절전으로
> 들어가면 멈춥니다.

이어서 [AI 연결하기](#ai-연결하기-두-경로-공통)로 가세요.

---

# 경로 B — 우분투 서버 (팀 공용)

Ubuntu 22.04 / 24.04 LTS 기준입니다. Docker 없이 서버에 직접 설치하고 systemd로
관리합니다. **에이전트가 서버에서 실제로 코드를 내려받아 빌드하고 테스트를 돌립니다.**
디스크와 CPU를 넉넉히 잡으세요 (최소 4코어 / 8GB / 100GB 권장).

## B-1. 준비물 챙기기

```bash
sudo apt-get update
# git: 에이전트가 저장소를 다룹니다. build-essential: 빌드가 필요한 npm 패키지용
sudo apt-get install -y git build-essential curl ca-certificates
```

**Node.js 22.12 이상**이 필요합니다. 우분투 기본 저장소 버전은 낮으니 따로 설치하세요.

```bash
node -v   # v22.12.0 이상이어야 합니다
```

낮거나 없다면 — 사내 미러에 NodeSource 저장소가 있으면 그것을 쓰고, 없으면 공식
tarball을 풉니다.

```bash
# 공식 tarball 방식 (외부 저장소 설정이 필요 없습니다)
curl -fsSLO https://nodejs.org/dist/v22.12.0/node-v22.12.0-linux-x64.tar.xz
sudo tar -xJf node-v22.12.0-linux-x64.tar.xz -C /usr/local --strip-components=1
node -v
```

**전용 계정과 폴더를 만듭니다.** 서비스를 일반 사용자 권한으로 돌리기 위해서입니다.

```bash
sudo useradd --system --create-home --home-dir /opt/paperclip --shell /bin/bash paperclip
sudo mkdir -p /opt/paperclip/data /etc/paperclip
sudo chown -R paperclip:paperclip /opt/paperclip
sudo chmod 700 /opt/paperclip/data
```

🔴 `/opt/paperclip/data` 안에 **사내 AI 토큰과 그것을 푸는 열쇠 파일**이 들어갑니다.
`chmod 700`을 건너뛰지 마세요.

## B-2. PostgreSQL 설치하기

```bash
sudo apt-get install -y postgresql
sudo systemctl enable --now postgresql
systemctl status postgresql --no-pager
```

우분투 기본 패키지는 배포판에 따라 PostgreSQL 14~16이 설치됩니다. **모두 정상 동작합니다.**

**Paperclip 전용 사용자와 데이터베이스 만들기:**

```bash
DB_PASSWORD='여기에-충분히-긴-비밀번호'
sudo -u postgres psql -c "CREATE USER paperclip WITH PASSWORD '$DB_PASSWORD';"
sudo -u postgres psql -c "CREATE DATABASE paperclip OWNER paperclip;"
```

**접속 확인:**

```bash
PGPASSWORD="$DB_PASSWORD" psql -U paperclip -h 127.0.0.1 -d paperclip -c "SELECT version();"
```

우분투 패키지는 기본이 **localhost 전용**이라 별도로 막을 것이 없습니다.
DB를 다른 서버에 두신다면 그 서버의 `pg_hba.conf`와 방화벽을 따로 여셔야 합니다.

> 위 명령들에는 비밀번호가 그대로 들어가 셸 기록에 남습니다. B-3까지 끝낸 뒤
> `history -c` 로 지우세요. 비밀번호에 `$` 나 공백이 있으면 따옴표 안에서도 다르게
> 해석될 수 있으니, **영문·숫자만으로 긴 비밀번호**를 쓰는 편이 안전합니다.

## B-3. Paperclip 설치하고 서비스로 등록하기

**1) 설치**

```bash
# -H 를 빼지 마세요. 빼면 npm이 캐시를 root 폴더에 쓰려다 권한 오류로 실패합니다.
sudo -H -u paperclip npm install --prefix /opt/paperclip paperclipai
```

**2) 접속 정보를 파일로 분리**

DB 비밀번호가 서비스 파일이나 명령 기록에 남지 않게 별도 파일에 둡니다.

```bash
sudo tee /etc/paperclip/paperclip.env >/dev/null <<'EOF'
DATABASE_URL=postgres://paperclip:비밀번호@127.0.0.1:5432/paperclip
# 사내 프록시를 쓴다면 (사내 AI 주소는 NO_PROXY에 꼭 넣으세요)
# HTTP_PROXY=http://proxy.corp.internal:8080
# HTTPS_PROXY=http://proxy.corp.internal:8080
# NO_PROXY=localhost,127.0.0.1,.corp.internal
EOF
sudo chown paperclip:paperclip /etc/paperclip/paperclip.env
sudo chmod 600 /etc/paperclip/paperclip.env
```

**3) 최초 설정을 한 번 실행**

팀이 접속해야 하므로 **로그인 필요(authenticated)** 모드로, 사내망에서 보이도록
`--bind lan`으로 설정합니다.

```bash
sudo -H -u paperclip env \
  DATABASE_URL='postgres://paperclip:비밀번호@127.0.0.1:5432/paperclip' \
  PAPERCLIP_DEPLOYMENT_MODE=authenticated \
  PAPERCLIP_DEPLOYMENT_EXPOSURE=private \
  /opt/paperclip/node_modules/.bin/paperclipai onboard --yes --bind lan \
  --data-dir /opt/paperclip/data
```

> `--yes`만 주고 `--bind`를 생략하면 **로그인 없는 localhost 전용**으로 굳어집니다.
> 팀 공용 서버에서는 반드시 `--bind lan`을 함께 주세요.

이 명령에는 비밀번호가 그대로 들어가므로 셸 기록에 남습니다. 끝나면 지우세요.

```bash
history -d $((HISTCMD-1)) 2>/dev/null || history -c
```

**4) systemd 서비스 등록**

```bash
sudo tee /etc/systemd/system/paperclip.service >/dev/null <<'EOF'
[Unit]
Description=Paperclip
After=network-online.target postgresql.service
Wants=network-online.target
Requires=postgresql.service

[Service]
Type=simple
User=paperclip
Group=paperclip
WorkingDirectory=/opt/paperclip
EnvironmentFile=/etc/paperclip/paperclip.env
ExecStart=/opt/paperclip/node_modules/.bin/paperclipai run --data-dir /opt/paperclip/data
Restart=on-failure
RestartSec=5
# 에이전트가 서버에서 실제로 코드를 빌드하므로 파일시스템을 강하게 막으면 작업이
# 깨집니다. 권한 상승만 차단하고 나머지는 열어 둡니다.
NoNewPrivileges=true

[Install]
WantedBy=multi-user.target
EOF

sudo systemctl daemon-reload
sudo systemctl enable --now paperclip
```

**5) 확인**

```bash
systemctl status paperclip --no-pager
journalctl -u paperclip -f     # 로그 실시간 보기
```

## B-4. 접근 통제

**방화벽으로 사내망만 열어 주세요.**

```bash
# 🔴 SSH를 먼저 허용하세요. 이 줄을 빼고 enable 하면 원격 접속이 끊깁니다.
sudo ufw allow OpenSSH
sudo ufw allow from 10.0.0.0/8 to any port 3100 proto tcp
sudo ufw enable
```

(대역은 사내 환경에 맞게 바꾸세요.)

🔴 **외부 AI 서비스로 나가는 길도 막아야 합니다.** 코드를 실제로 들고 있는 것은
에이전트가 실행하는 별도 프로그램이라, 앱 안에서 막는 데 한계가 있습니다.

`api.anthropic.com`, `api.openai.com`, `chatgpt.com`,
`generativelanguage.googleapis.com`, `api.x.ai`, `cursor.com`

**도메인 이름으로 붙게 하려면** 역방향 프록시(Nginx 등)를 앞에 두고 HTTPS를 태우세요.
그때는 `config.json`의 `server.allowedHostnames`에 그 도메인을 추가해야 합니다.

## B-5. 백업 확인

DB 백업은 자동으로 돌고 있습니다. **어디에 쌓이는지 한 번 확인하고, 그 폴더를 사내
백업 대상에 넣으세요.**

```bash
grep -A 6 '"backup"' /opt/paperclip/data/config.json
```

이어서 [AI 연결하기](#ai-연결하기-두-경로-공통)로 가세요.
**서버에서는 사내 모델 레인만 만드시면 됩니다.**

---

## AI 연결하기 (두 경로 공통)

**화면에서 하시면 됩니다.** 서버를 켜고 브라우저에서
`설정 → 인스턴스 설정 → LLM 연결`로 들어가세요.

### 사내 오픈웨이트 모델을 쓰는 경우

1. `+ 사내 모델` 버튼을 누릅니다.
2. 레인 이름(예: `사내GPU-A`), 서버 주소(`https://사내주소/v1`), 받으신 토큰,
   모델 이름을 넣습니다.
3. `연결 확인`을 눌러 봅니다. 서버가 붙으면 **지금 서빙 중인 모델 목록**이 뜨므로,
   모델 이름을 직접 타이핑하는 대신 골라 넣으실 수 있습니다.
4. `저장`을 누릅니다.

토큰은 화면에 다시 표시되지 않고, 실행 기록이나 AI 프로그램에도 전달되지 않습니다.
그래도 **설정 파일이 있는 폴더의 권한은 잠가두셔야 합니다** (개인 PC는 A-1의 3번,
서버는 B-1의 `chmod 700`).

### AWS Bedrock의 Claude를 쓰는 경우 — 개인 PC 전용

> 🔴 **우분투 서버에서는 이 절차를 하지 마세요.** SSO 로그인은 브라우저 승인이 필요하고
> 세션이 몇 시간마다 만료되므로, 화면 없는 서버에서는 밤중에 끊겨 작업이 멈춥니다.
> 서버에는 사내 모델 레인만 만드세요.

1. `AWS SSO 로그인` 칸에 프로필 이름(예: `corp-sso`)과 기본 리전을 넣고 `저장`.
2. `SSO 로그인` 버튼을 누릅니다. 브라우저가 열리고, 안 열리면 화면에 뜬 주소와
   코드로 승인하시면 됩니다. 로그인 상태는 화면에서 바로 확인됩니다.
3. `+ Bedrock` 버튼으로 레인을 만들고 모델 id를 넣습니다.
   (예: `us.anthropic.claude-sonnet-4-5-20250929-v2:0`)

> **AWS CLI v2가 설치되어 있어야 합니다.** 프로필이 아직 없으면 화면이
> `aws configure sso --profile <이름>` 명령을 알려 줍니다. 그 명령만 한 번
> 실행하시면 이후로는 화면의 버튼으로 로그인하실 수 있습니다.

### 둘 다 쓰는 경우 (개인 PC)

레인을 두 개 만드시면 됩니다. 에이전트마다 어느 레인을 쓸지 고를 수 있고,
고르지 않은 에이전트는 `기본`으로 표시된 레인을 씁니다.

### 파일로 직접 넣고 싶다면

화면이 읽고 쓰는 파일은 `llm-lanes.json` 하나입니다. `config.json`이 있는 폴더에
있습니다.

| 경로 | 위치 |
|---|---|
| 개인 PC | `C:\PaperclipData\llm-lanes.json` |
| 우분투 서버 | `/opt/paperclip/data/llm-lanes.json` |

서버에서 손으로 고치셨다면 서비스를 다시 시작하세요 — `sudo systemctl restart paperclip`.
(화면에서 저장한 경우에는 재시작이 필요 없습니다.)

```json
{
  "lanes": {
    "사내GPU-A": {
      "kind": "inhouse",
      "baseUrl": "https://사내주소/v1",
      "model": "모델이름",
      "apiKey": "받으신-토큰"
    },
    "Bedrock 사내": {
      "kind": "bedrock",
      "region": "ap-northeast-2",
      "model": "us.anthropic.claude-sonnet-4-5-20250929-v2:0"
    }
  },
  "awsSso": { "profile": "corp-sso", "region": "ap-northeast-2" }
}
```

> 회사 정책상 토큰을 파일에 두면 안 되는 경우에는 `apiKey` 대신
> `"apiKeyEnv": "CORP_LLM_KEY"` 를 쓰고, 그 이름으로 환경 변수를 지정하세요.

이전 버전에서 쓰던 형식(`inHouse` / `bedrock`을 맨 위에 둔 파일)도 그대로 동작합니다.
화면에서 무언가 저장하시면 자동으로 새 형식으로 바뀝니다.

### 이 파일이 대신 해주는 일

이 파일 하나를 넣으면 서버가 시작할 때 아래 설정들을 알아서 만들어 넣습니다.
예전처럼 손으로 넣지 않으셔도 됩니다.

| 자동으로 처리되는 것 | 왜 필요한지 |
|---|---|
| 사내 서버 접속 정보 | 어느 주소의 어떤 모델을 쓸지 |
| 보조 모델 지정 | 지정하지 않으면 제목을 만들다가 작업이 중단됩니다 |
| 모델 확인 절차 생략 | 사내 모델은 공개 목록에 없어서 확인에 실패합니다 |
| 화면 모델 목록 등록 | 등록하지 않으면 화면에서 고를 수 없습니다 |
| 사용 정보 외부 전송 차단 | 별도 조치가 필요 없어집니다 |

이미 환경 변수를 넣어두셨다면 **그 값이 우선**입니다. 파일이 기존 설정을 덮어쓰지 않습니다.

### 에이전트를 만들 때

에이전트 화면에서 **LLM 항목의 레인 이름 하나만** 고르시면 됩니다. 어댑터 종류와
모델 이름은 그 레인에서 자동으로 정해지므로 따로 넣지 않으셔도 됩니다.

예전 버전에 있던 실행 명령, 환경 변수, 시크릿 접근, 타임아웃, 하트비트 같은 항목은
화면에서 빠졌습니다. 사내 배포본에서는 이 값들이 설치본 전체에 고정되어 있어서,
에이전트마다 다르게 넣을 수 있는 것처럼 보이면 오히려 혼란만 생기기 때문입니다.
이름·직함·보고선, 프롬프트, 스킬·도구는 그대로 있습니다.

**모델이 바뀌면** `LLM 연결` 화면에서 레인의 모델 이름만 고치시면 됩니다.
에이전트를 하나씩 다시 저장하지 않아도 다음 실행부터 반영됩니다.

---

## 잘 되는지 확인하기 (두 경로 공통)

에이전트 하나를 만들고 간단한 일을 시켜보세요. 작업이 끝나면 **실행 기록(commandNotes)** 에 아래 두 줄이 있는지 확인하세요.

```
Injected 1 custom OpenCode provider(s) from PAPERCLIP_OPENCODE_PROVIDERS: corp.
Pinned OpenCode small_model to corp/모델이름.
```

**이 두 줄이 없으면 사내 AI를 쓰지 않은 것입니다.** 이게 유일하게 확인 가능한 신호이니 꼭 보세요.

---

## 자주 겪는 문제

| 증상 | 원인과 해결 |
|---|---|
| 작업이 실패하고 `context_overflow` 라고 나옴 | 이슈 내용이 너무 길어서 AI가 한 번에 못 읽습니다. 이슈 설명과 댓글을 줄이거나 에이전트에 붙인 스킬 수를 줄이세요. **다시 시도해도 똑같이 실패**하니 내용을 줄이는 게 유일한 해결입니다 |
| 에이전트 화면의 LLM 목록이 비어 있음 | `설정 → 인스턴스 설정 → LLM 연결`에서 레인을 먼저 하나 만드세요 |
| 에이전트에 모델을 직접 넣을 칸이 없음 | 정상입니다. 모델은 레인에서 정해집니다. 바꾸시려면 `LLM 연결` 화면에서 레인을 고치세요 |
| SSO 로그인 버튼이 "AWS CLI 없음"이라고 함 | AWS CLI v2를 설치한 뒤 **서버를 다시 시작**하세요. 설치 직후에는 서버가 예전 PATH를 들고 있습니다 |
| SSO 로그인 버튼이 "프로필 없음"이라고 함 | 화면에 나온 `aws configure sso --profile <이름>` 을 터미널에서 한 번 실행하세요 |
| 작업을 취소했는데 뭔가 계속 도는 것 같음 | 작업 관리자에서 `node.exe` / `opencode.exe` 를 확인하세요. 남아 있으면 알려주세요 (수정은 했지만 실제 Windows에서 아직 검증 전입니다) |
| 예산을 설정했는데 작동을 안 함 | 알려진 제약입니다. 사내 모델은 가격표가 없어서 비용이 0원으로 기록되고 예산 제한이 걸리지 않습니다. 사용량은 AI 서버 쪽에서 따로 확인하셔야 합니다 |

### 설치·데이터베이스 문제

| 증상 | 원인과 해결 |
|---|---|
| `password authentication failed for user "paperclip"` | 접속 주소의 비밀번호가 틀렸거나, 특수문자가 변환되지 않았습니다. [특수문자 안내](#a-2-postgresql-설치하기)를 보세요 |
| `ECONNREFUSED 127.0.0.1:5432` | PostgreSQL이 꺼져 있습니다. Windows는 `Get-Service postgresql*`, 우분투는 `systemctl status postgresql` |
| `database "paperclip" does not exist` | A-2 / B-2의 `CREATE DATABASE` 단계를 건너뛰셨습니다 |
| 내장 DB로 뜨려다 실패함 | `DATABASE_URL`을 넣지 않은 채 설치하셨습니다. `paperclipai configure --section database` 로 PostgreSQL을 지정하세요 |
| npm 설치가 "연결할 수 없음"으로 실패 | [0단계](#0단계--사내-미러프록시-설정-두-경로-공통)의 사내 미러·프록시 설정을 먼저 하세요 |
| 모델 호출이 중간에 멈추거나 타임아웃 | 프록시를 거치고 있을 가능성이 큽니다. `NO_PROXY`에 사내 AI 서버 주소를 넣으세요 |
| (서버) 서비스가 계속 재시작됨 | `journalctl -u paperclip -n 100 --no-pager` 로 원인을 보세요. 대개 DB 접속 정보 또는 `/opt/paperclip/data` 권한 문제입니다 |
| (서버) 팀원이 접속을 못 함 | `--bind lan` 없이 설치하면 localhost 전용으로 굳습니다. B-3의 3)을 다시 실행하고 방화벽도 확인하세요 |
| (서버) npm 설치가 권한 오류로 실패 | `sudo -H -u paperclip` 에서 `-H` 를 빼셨습니다. 빼면 npm이 root 폴더에 캐시를 쓰려고 합니다 |

---

## 꼭 알아두실 점

**1. 외부 차단은 방화벽으로 하셔야 합니다.**
AI를 실제로 실행하는 건 별도 프로그램이라 앱 안에서 막는 데 한계가 있습니다. 아래 주소들을 네트워크에서 막아주세요. **개인 PC든 서버든 똑같이 필요합니다.**

`api.anthropic.com`, `api.openai.com`, `chatgpt.com`, `generativelanguage.googleapis.com`, `api.x.ai`, `cursor.com`

**2. 사용 정보 외부 전송은 자동으로 차단됩니다.**
LLM 설정 파일을 넣으면 함께 처리됩니다. 끄고 싶지 않으시면 파일에 `"disableTelemetry": false` 를 넣으세요.

**3. 아직 실제로 검증되지 않은 부분이 있습니다.**
Windows 관련 수정은 코드와 테스트로만 확인했습니다. 처음 설치하실 때 [Windows 검증 체크리스트](docs/deploy/windows-validation.md)를 한 번 돌려보시길 권합니다. 10분이면 됩니다.
**우분투 서버 절차(경로 B) 역시 실제 서버에서 처음부터 끝까지 돌려본 적이 없습니다.** 막히는 지점이 있으면 알려주세요.

**4. 개인 PC와 서버는 데이터가 이어지지 않습니다.**
개인 PC에서 쓰던 이슈·에이전트를 서버로 옮기는 자동 이사 기능이 없습니다. 팀으로 확대할 계획이라면 처음부터 서버에 설치하시는 편이 낫습니다.

## 더 자세한 문서

- [사내 AI 연결 상세 가이드](docs/deploy/on-prem-llm.md) — 설정값 전체와 동작 원리
- [Windows 검증 체크리스트](docs/deploy/windows-validation.md) — 설치 전 확인 사항
- [데이터베이스 선택지](docs/deploy/database.md) — 내장 DB·직접 설치·호스팅 비교 (영문)
- [접속 모드](docs/deploy/deployment-modes.md) — `local_trusted` 와 `authenticated` 의 차이 (영문)

---
---

<p align="center">
  <img src="doc/assets/banner.jpg" alt="Paperclip is the app people use to manage AI agents for work." width="720" />
</p>

<p align="center">
  <a href="#quickstart"><strong>Quickstart</strong></a> &middot;
  <a href="https://docs.paperclip.ing"><strong>Docs</strong></a> &middot;
  <a href="https://github.com/paperclipai/paperclip"><strong>GitHub</strong></a> &middot;
  <a href="https://discord.gg/m4HZY7xNG3"><strong>Discord</strong></a> &middot;
  <a href="https://x.com/papercliping"><strong>Twitter</strong></a> &middot;
  <a href="https://paperclip.ing"><strong>Website</strong></a>
</p>

<p align="center">
  <a href="https://github.com/paperclipai/paperclip/blob/master/LICENSE"><img src="https://img.shields.io/badge/license-MIT-blue" alt="MIT License" /></a>
  <a href="https://github.com/paperclipai/paperclip/stargazers"><img src="https://img.shields.io/github/stars/paperclipai/paperclip?style=flat" alt="Stars" /></a>
  <a href="https://www.star-history.com/paperclipai/paperclip"><img src="https://api.star-history.com/badge?repo=paperclipai/paperclip" alt="Star History Rank" /></a>
  <a href="https://discord.gg/m4HZY7xNG3"><img src="https://img.shields.io/discord/000000000?label=discord" alt="Discord" /></a>
</p>

<br/>

<div align="center">
  <video src="https://github.com/user-attachments/assets/773bdfb2-6d1e-4e30-8c5f-3487d5b70c8f" width="600" controls></video>
</div>

<br/>

# Paperclip is the app people use to manage AI agents for work.

Open-source orchestration for teams of AI agents.

**If OpenClaw is an _employee_, Paperclip is the _company_.**

Paperclip is a Node.js server and React UI that orchestrates a team of AI agents to run a business. Bring your own agents, assign goals, and track work and costs from one dashboard.

It looks like a task manager. Under the hood: org charts, budgets, governance, goal alignment, and agent coordination.

**Manage business goals, not pull requests.**

|        | Step            | Example                                                            |
| ------ | --------------- | ------------------------------------------------------------------ |
| **01** | Define the goal | _"Build the #1 AI note-taking app to $1M MRR."_                    |
| **02** | Hire the team   | CEO, CTO, engineers, designers, marketers — any bot, any provider. |
| **03** | Approve and run | Review strategy. Set budgets. Hit go. Monitor from the dashboard.  |

<br/>

<div align="center">
<table>
  <tr>
    <td align="center"><strong>Works<br/>with</strong></td>
    <td align="center"><img src="doc/assets/logos/openclaw.svg" width="32" alt="OpenClaw" /><br/><sub>OpenClaw</sub></td>
    <td align="center"><img src="doc/assets/logos/claude.svg" width="32" alt="Claude" /><br/><sub>Claude Code</sub></td>
    <td align="center"><img src="doc/assets/logos/codex.svg" width="32" alt="Codex" /><br/><sub>Codex</sub></td>
    <td align="center"><img src="doc/assets/logos/cursor.svg" width="32" alt="Cursor" /><br/><sub>Cursor</sub></td>
    <td align="center"><img src="doc/assets/logos/bash.svg" width="32" alt="Bash" /><br/><sub>Bash</sub></td>
    <td align="center"><img src="doc/assets/logos/http.svg" width="32" alt="HTTP" /><br/><sub>HTTP</sub></td>
  </tr>
</table>

<em>If it can receive a heartbeat, it's hired.</em>

</div>

<br/>

## Paperclip is right for you if

- ✅ You want to build **autonomous AI companies**
- ✅ You **coordinate many different agents** (OpenClaw, Codex, Claude, Cursor) toward a common goal
- ✅ You have **20 simultaneous Claude Code terminals** open and lose track of what everyone is doing
- ✅ You want agents running **autonomously 24/7**, but still want to audit work and chime in when needed
- ✅ You want to **monitor costs** and enforce budgets
- ✅ You want a process for managing agents that **feels like using a task manager**
- ✅ You want to manage your autonomous businesses **from your phone**

<br/>

## The four pillars

Four things have to work for an organization of AI agents to actually produce: the tasks, the org, the training, and the infrastructure. Paperclip is built around exactly those four pillars.

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="https://raw.githubusercontent.com/paperclipai/paperclip/1ec33ffd8b597f7e36aac3e2fbb4665b8c42dc3c/doc/assets/four-pillars-dark.png">
  <source media="(prefers-color-scheme: light)" srcset="https://raw.githubusercontent.com/paperclipai/paperclip/1ec33ffd8b597f7e36aac3e2fbb4665b8c42dc3c/doc/assets/four-pillars-light.png">
  <img src="https://raw.githubusercontent.com/paperclipai/paperclip/1ec33ffd8b597f7e36aac3e2fbb4665b8c42dc3c/doc/assets/four-pillars-light.png" alt="The four pillars of Paperclip">
</picture>

| Pillar | Built for | What it covers |
| --- | --- | --- |
| **Agentic Task Manager** — Declare intent. Agents work. You verify the output. | Everyone, daily | Tasks, approvals & review gates · proactive agent coworkers · auditable routines & workflows · verify from diffs, screenshots & tests |
| **Org Chart for Agents** — Roles, permissions & boundaries for humans and agents. | Managers | Mixed human + agent org chart · responsibilities, delegation, specialization · governance: who can do what · scoped secrets & company boundaries |
| **Agent Employee Training** — Design, train & evaluate your AI employees. | Enablers | Skill Studio & shared org-wide skills · evals & saved test runs · active learning loops & quality metrics · performance reviews for agents |
| **Agentic OS** — The infrastructure that makes the work run. | IT & platform | Cross-provider runtime: any model, any agent · sandboxing, integrations & MCP servers · SSO, GRC, RBAC & cost controls · data privacy, internal trace collection, compounding data value |

<br/>

## Features

<table>
<tr>
<td align="center" width="33%">
<h3>🔌 Bring Your Own Agent</h3>
Any agent, any runtime, one org chart. If it can receive a heartbeat, it's hired.
</td>
<td align="center" width="33%">
<h3>🎯 Goal Alignment</h3>
Every task traces back to the company mission. Agents know <em>what</em> to do and <em>why</em>.
</td>
<td align="center" width="33%">
<h3>💓 Heartbeats</h3>
Agents wake on a schedule, check work, and act. Delegation flows up and down the org chart.
</td>
</tr>
<tr>
<td align="center">
<h3>💰 Cost Control</h3>
Monthly budgets per agent. When they hit the limit, they stop. No runaway costs.
</td>
<td align="center">
<h3>🏢 Multi-Company</h3>
One deployment, many companies. Complete data isolation. One control plane for your portfolio.
</td>
<td align="center">
<h3>🎫 Ticket System</h3>
Every conversation traced. Every decision explained. Full tool-call tracing and immutable audit log.
</td>
</tr>
<tr>
<td align="center">
<h3>🛡️ Governance</h3>
Approve hires, override strategy, pause or terminate any agent — at any time.
</td>
<td align="center">
<h3>📊 Org Chart</h3>
Hierarchies, roles, reporting lines. Your agents have a boss, a title, and a job description.
</td>
<td align="center">
<h3>📱 Mobile Ready</h3>
Monitor and manage your autonomous businesses from anywhere.
</td>
</tr>
</table>

<br/>

## Problems Paperclip solves

| Without Paperclip                                                                                                                     | With Paperclip                                                                                                                         |
| ------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------- |
| ❌ You have 20 Claude Code tabs open and can't track which one does what. On reboot you lose everything.                              | ✅ Tasks are ticket-based, conversations are threaded, sessions persist across reboots.                                                |
| ❌ You manually gather context from several places to remind your bot what you're actually doing.                                     | ✅ Context flows from the task up through the project and company goals — your agent always knows what to do and why.                  |
| ❌ Folders of agent configs are disorganized and you're re-inventing task management, communication, and coordination between agents. | ✅ Paperclip gives you org charts, ticketing, delegation, and governance out of the box — so you run a company, not a pile of scripts. |
| ❌ Runaway loops waste hundreds of dollars of tokens and max your quota before you even know what happened.                           | ✅ Cost tracking surfaces token budgets and throttles agents when they're out. Management prioritizes with budgets.                    |
| ❌ You have recurring jobs (customer support, social, reports) and have to remember to manually kick them off.                        | ✅ Heartbeats handle regular work on a schedule. Management supervises.                                                                |
| ❌ You have an idea, you have to find your repo, fire up Claude Code, keep a tab open, and babysit it.                                | ✅ Add a task in Paperclip. Your coding agent works on it until it's done. Management reviews their work.                              |

<br/>

## Why Paperclip is special

Paperclip handles the hard orchestration details correctly.

|                                   |                                                                                                               |
| --------------------------------- | ------------------------------------------------------------------------------------------------------------- |
| **Atomic execution.**             | Task checkout and budget enforcement are atomic, so no double-work and no runaway spend.                      |
| **Persistent agent state.**       | Agents resume the same task context across heartbeats instead of restarting from scratch.                     |
| **Runtime skill injection.**      | Agents can learn Paperclip workflows and project context at runtime, without retraining.                      |
| **Governance with rollback.**     | Approval gates are enforced, config changes are revisioned, and bad changes can be rolled back safely.        |
| **Goal-aware execution.**         | Tasks carry full goal ancestry so agents consistently see the "why," not just a title.                        |
| **Portable company templates.**   | Export/import orgs, agents, and skills with secret scrubbing and collision handling.                          |
| **True multi-company isolation.** | Every entity is company-scoped, so one deployment can run many companies with separate data and audit trails. |

<br/>

## What's Under the Hood

Paperclip is a full control plane, not a wrapper. Before you build any of this yourself, know that it already exists:

```
┌──────────────────────────────────────────────────────────────┐
│                       PAPERCLIP SERVER                       │
│                                                              │
│  ┌───────────┐  ┌───────────┐  ┌───────────┐  ┌───────────┐  │
│  │Identity & │  │  Work &   │  │ Heartbeat │  │Governance │  │
│  │  Access   │  │   Tasks   │  │ Execution │  │& Approvals│  │
│  └───────────┘  └───────────┘  └───────────┘  └───────────┘  │
│                                                              │
│  ┌───────────┐  ┌───────────┐  ┌───────────┐  ┌───────────┐  │
│  │ Org Chart │  │Workspaces │  │  Plugins  │  │  Budget   │  │
│  │ & Agents  │  │ & Runtime │  │           │  │ & Costs   │  │
│  └───────────┘  └───────────┘  └───────────┘  └───────────┘  │
│                                                              │
│  ┌───────────┐  ┌───────────┐  ┌───────────┐  ┌───────────┐  │
│  │ Routines  │  │ Secrets & │  │ Activity  │  │  Company  │  │
│  │& Schedules│  │  Storage  │  │ & Events  │  │Portability│  │
│  └───────────┘  └───────────┘  └───────────┘  └───────────┘  │
└──────────────────────────────────────────────────────────────┘
         ▲              ▲              ▲              ▲
   ┌─────┴─────┐  ┌─────┴─────┐  ┌─────┴─────┐  ┌─────┴─────┐
   │  Claude   │  │   Codex   │  │   CLI     │  │ HTTP/web  │
   │   Code    │  │           │  │  agents   │  │   bots    │
   └───────────┘  └───────────┘  └───────────┘  └───────────┘
```

### The Systems

<table>
<tr>
<td width="50%">

**Identity & Access** — Two deployment modes (trusted local or authenticated), board users, agent API keys, short-lived run JWTs, company memberships, invite flows, and OpenClaw onboarding. Every mutating request is traced to an actor.

</td>
<td width="50%">

**Org Chart & Agents** — Agents have roles, titles, reporting lines, permissions, and budgets. Adapter examples match the diagram: Claude Code, Codex, CLI agents such as Cursor/Gemini/bash, HTTP/webhook bots such as OpenClaw, and external adapter plugins. If it can receive a heartbeat, it's hired.

</td>
</tr>
<tr>
<td>

**Work & Task System** — Issues carry company/project/goal/parent links, atomic checkout with execution locks, first-class blocker dependencies, comments, documents, attachments, work products, labels, and inbox state. No double-work, no lost context.

</td>
<td>

**Heartbeat Execution** — DB-backed wakeup queue with coalescing, budget checks, workspace resolution, secret injection, skill loading, and adapter invocation. Runs produce structured logs, cost events, session state, and audit trails. Recovery handles orphaned runs automatically.

</td>
</tr>
<tr>
<td>

**Workspaces & Runtime** — Project workspaces, isolated execution workspaces (git worktrees, operator branches), and runtime services (dev servers, preview URLs). Agents work in the right directory with the right context every time.

</td>
<td>

**Governance & Approvals** — Board approval workflows, execution policies with review/approval stages, decision tracking, budget hard-stops, agent pause/resume/terminate, and full audit logging. Nothing ships without your sign-off.

</td>
</tr>
<tr>
<td>

**Budget & Cost Control** — Token and cost tracking by company, agent, project, goal, issue, provider, and model. Scoped budget policies with warning thresholds and hard stops. Overspend pauses agents and cancels queued work automatically.

</td>
<td>

**Routines & Schedules** — Recurring tasks with cron, webhook, and API triggers. Concurrency and catch-up policies. Each routine execution creates a tracked issue and wakes the assigned agent — no manual kick-offs needed.

</td>
</tr>
<tr>
<td>

**Plugins** — Instance-wide plugin system with out-of-process workers, capability-gated host services, job scheduling, tool exposure, and UI contributions. Extend Paperclip without forking it.

</td>
<td>

**Secrets & Storage** — Instance and company secrets, encrypted local storage, provider-backed object storage, attachments, and work products. Sensitive values stay out of prompts unless a scoped run explicitly needs them.

</td>
</tr>
<tr>
<td>

**Activity & Events** — Mutating actions, heartbeat state changes, cost events, approvals, comments, and work products are recorded as durable activity so operators can audit what happened and why.

</td>
<td>

**Company Portability** — Export and import entire organizations — agents, skills, projects, routines, and issues — with secret scrubbing and collision handling. One deployment, many companies, complete data isolation.

</td>
</tr>
</table>

<br/>

## What Paperclip is not

|                              |                                                                                                                      |
| ---------------------------- | -------------------------------------------------------------------------------------------------------------------- |
| **Not a chatbot.**           | Agents have jobs, not chat windows.                                                                                  |
| **Not an agent framework.**  | We don't tell you how to build agents. We tell you how to run a company made of them.                                |
| **Not a workflow builder.**  | No drag-and-drop pipelines. Paperclip models companies — with org charts, goals, budgets, and governance.            |
| **Not a prompt manager.**    | Agents bring their own prompts, models, and runtimes. Paperclip manages the organization they work in.               |
| **Not a single-agent tool.** | This is for teams. If you have one agent, you probably don't need Paperclip. If you have twenty — you definitely do. |
| **Not a code review tool.**  | Paperclip orchestrates work, not pull requests. Bring your own review process.                                       |

<br/>

## Quickstart

Open source. Self-hosted. No Paperclip account required.

```bash
npx paperclipai onboard --yes
```

> **Troubleshooting: private npm registry `.npmrc`**
>
> If this fails with an `E404` for `paperclipai` (or similar) and you use a private npm registry (for example GitHub Packages) via a global `~/.npmrc`, `npx` may be resolving `paperclipai` against that private registry instead of the public npm registry.
>
> Diagnostic:
>
> ```bash
> npm config get registry
> ```
>
> Workaround (cross-platform; force the public npm registry for this command):
>
> ```bash
> npx --registry https://registry.npmjs.org paperclipai onboard --yes
> ```

That quickstart path now defaults to trusted local loopback mode for the fastest first run. To start in authenticated/private mode instead, choose a bind preset explicitly:

```bash
npx paperclipai onboard --yes --bind lan
# or:
npx paperclipai onboard --yes --bind tailnet
```

If you already have Paperclip configured, rerunning `onboard` keeps the existing config in place. Use `paperclipai configure` to edit settings.

Or manually:

```bash
git clone https://github.com/paperclipai/paperclip.git
cd paperclip
pnpm install
pnpm dev
```

This starts the API server at `http://localhost:3100`. An embedded PostgreSQL database is created automatically — no setup required.

> **Requirements:** Node.js 20+, pnpm 9.15+

<br/>

## FAQ

**What does a typical setup look like?**
Locally, a single Node.js process manages an embedded Postgres and local file storage. For production, point it at your own Postgres and deploy however you like. Configure projects, agents, and goals — the agents take care of the rest.

If you're a solo entrepreneur you can use Tailscale to access Paperclip on the go. Then later you can deploy to e.g. Vercel when you need it.

**Can I run multiple companies?**
Yes. A single deployment can run an unlimited number of companies with complete data isolation.

**How is Paperclip different from agents like OpenClaw or Claude Code?**
Paperclip _uses_ those agents. It orchestrates them into a company — with org charts, budgets, goals, governance, and accountability.

**Why should I use Paperclip instead of just pointing my OpenClaw to Asana or Trello?**
Agent orchestration has subtleties in how you coordinate who has work checked out, how to maintain sessions, monitoring costs, establishing governance - Paperclip does this for you.

(Bring-your-own-ticket-system is on the Roadmap)

**Do agents run continuously?**
By default, agents run on scheduled heartbeats and event-based triggers (task assignment, @-mentions). You can also hook in continuous agents like OpenClaw. You bring your agent and Paperclip coordinates.

<br/>

## Development

```bash
pnpm dev              # Full dev (API + UI, watch mode)
pnpm dev:once         # Full dev without file watching
pnpm dev:server       # Server only
pnpm build            # Build all
pnpm typecheck        # Type checking
pnpm test             # Cheap default test run (Vitest only)
pnpm test:watch       # Vitest watch mode
pnpm test:e2e         # Playwright browser suite
pnpm db:generate      # Generate DB migration
pnpm db:migrate       # Apply migrations
```

`pnpm test` does not run Playwright. Browser suites stay separate and are typically run only when working on those flows or in CI.

See [doc/DEVELOPING.md](doc/DEVELOPING.md) for the full development guide.

<br/>

## Roadmap

- ✅ Plugin system (e.g. add a knowledge base, custom tracing, queues, etc)
- ✅ Get OpenClaw / claw-style agent employees
- ✅ companies.sh - import and export entire organizations
- ✅ Easy AGENTS.md configurations
- ✅ Skills Manager, Skill Studio & Skills Store
- ✅ Scheduled Routines
- ✅ Better Budgeting
- ✅ Agent Reviews and Approvals
- ✅ Multiple Human Users
- ✅ Cloud / Sandbox agents (e2b, Cloudflare, Daytona, Modal, Novita, self-hosted Kubernetes)
- ✅ Artifacts & Work Products
- ✅ Deep Planning (planning mode, revisioned plans, plan approvals)
- ✅ Enforced Outcomes (watchdogs, recovery actions, review gates)
- ✅ MCP Tool Gateway & Apps (governed tool access)
- ✅ Secrets Manager with per-agent access
- ✅ Activity log & action attribution
- ✅ Self-healing runs & automatic recovery
- ✅ Agent evals & feedback
- ⚪ Memory / Knowledge
- ⚪ MAXIMIZER MODE
- ⚪ Work Queues
- ⚪ Self-Organization
- ⚪ Automatic Organizational Learning
- ⚪ CEO Chat
- 🟡 Cloud deployments (multi-tenant isolation & local→cloud sync shipped)
- ⚪ Desktop App
- ⚪ Bring-your-own-ticket-system (Asana / Linear / Jira as on-ramps)
- ⚪ Connected Apps (one-click integrations, e.g. Vercel)

This is the short roadmap preview. See the full roadmap in [ROADMAP.md](ROADMAP.md).

<br/>

## Community & Plugins

Find Plugins and more at [awesome-paperclip](https://github.com/gsxdsm/awesome-paperclip)

## Observability

Paperclip ships with opt-in OpenTelemetry auto-instrumentation for the server (traces only). It activates when `OTEL_EXPORTER_OTLP_ENDPOINT` is set and supports `grpc`, `http/protobuf`, and `http/json` via the standard `OTEL_EXPORTER_OTLP_PROTOCOL` env var. The `@opentelemetry/*` packages are optional peer dependencies — install them only if you want tracing. See [doc/observability.md](doc/observability.md) for install commands and the full env-var reference.

## Telemetry

Paperclip collects anonymous usage telemetry to help us understand how the product is used and improve it. No personal information, issue content, prompts, file paths, or secrets are ever collected. Private repository references are hashed with a per-install salt before being sent.

Contributors changing emitted telemetry events should follow the [Telemetry Data Contract](packages/shared/src/telemetry/README.md).
For proposed first-party events that are not in the generated contract yet, follow [Telemetry Workflow](doc/TELEMETRY_WORKFLOW.md).

Telemetry is **enabled by default** and can be disabled with any of the following:

| Method               | How                                                     |
| -------------------- | ------------------------------------------------------- |
| Environment variable | `PAPERCLIP_TELEMETRY_DISABLED=1`                        |
| Standard convention  | `DO_NOT_TRACK=1`                                        |
| CI environments      | Automatically disabled when `CI=true`                   |
| Config file          | Set `telemetry.enabled: false` in your Paperclip config |

## Contributing

We welcome contributions. See the [contributing guide](CONTRIBUTING.md) for details.

<br/>

## Community

- [Discord](https://discord.gg/m4HZY7xNG3) — Join the community
- [Twitter / X](https://x.com/papercliping) — Follow updates and announcements
- [GitHub Issues](https://github.com/paperclipai/paperclip/issues) — bugs and feature requests
- [GitHub Discussions](https://github.com/paperclipai/paperclip/discussions) — ideas and RFC

<br/>

## License

MIT &copy; 2026 [Paperclip Labs, Inc](https://paperclip.ing)

## Star History

<a href="https://www.star-history.com/?repos=paperclipai%2Fpaperclip&type=date&legend=top-left">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="https://api.star-history.com/chart?repos=paperclipai/paperclip&type=date&theme=dark&legend=top-left&sealed_token=hFjuwFq41bQD5cevvXVv5cTru2swWRZujwJYKlHhtBh6n0H5-VvJZW2SAlcQKB8u4KxhyEB9JqFg1yccJ8WLv9wPBcoWpWcak4gx0MYTWu_pOs2jKOaDluH7KsLeTKt6DHGkHiN3LsqV9s--MTDQcC6Xl7zV51W0-YezQXo-pVPgoFDFAGf2CY5fiP5Q" />
    <source media="(prefers-color-scheme: light)" srcset="https://api.star-history.com/chart?repos=paperclipai/paperclip&type=date&legend=top-left&sealed_token=hFjuwFq41bQD5cevvXVv5cTru2swWRZujwJYKlHhtBh6n0H5-VvJZW2SAlcQKB8u4KxhyEB9JqFg1yccJ8WLv9wPBcoWpWcak4gx0MYTWu_pOs2jKOaDluH7KsLeTKt6DHGkHiN3LsqV9s--MTDQcC6Xl7zV51W0-YezQXo-pVPgoFDFAGf2CY5fiP5Q" />
    <img src="https://api.star-history.com/chart?repos=paperclipai/paperclip&type=date&legend=top-left&sealed_token=hFjuwFq41bQD5cevvXVv5cTru2swWRZujwJYKlHhtBh6n0H5-VvJZW2SAlcQKB8u4KxhyEB9JqFg1yccJ8WLv9wPBcoWpWcak4gx0MYTWu_pOs2jKOaDluH7KsLeTKt6DHGkHiN3LsqV9s--MTDQcC6Xl7zV51W0-YezQXo-pVPgoFDFAGf2CY5fiP5Q" alt="Star History Chart" />
  </picture>
</a>

<br/>

---

<p align="center">
  <sub>Open source under MIT. Built for people who want to get work done, not babysit agents.</sub>
</p>
