# 블랙오션 접속기 (BlackOcean Launcher)

시청자가 이 프로그램 하나만 설치하면: 자바 → 마인크래프트 1.21.1 → NeoForge → 모드팩을 자동으로 내려받고,
마이크로소프트 로그인 후 "게임 시작"을 누르면 바로 블랙오션 서버에 들어갑니다.

- 게임 폴더: `%APPDATA%\.blackocean` (기존 마인크래프트와 완전히 분리)
- 모드팩: GitHub 의 `blackocean-pack` 저장소 `manifest.json` 을 읽어 바뀐 파일만 자동 갱신
- 접속기 자체 업데이트: GitHub 릴리스(`blackocean-launcher`)에 새 버전 올리면 자동 적용
- 로그인: 마이크로소프트 기기 코드 방식 (코드 입력) / 임시로 공식 런처 계정 가져오기

## 1. 처음 설정 (스트리머가 한 번만)

### ① GitHub 저장소 2개 만들기 (공개)
| 저장소 | 역할 |
|---|---|
| `blackocean-pack` | 모드·설정 파일 + manifest.json (접속기가 읽음) |
| `blackocean-launcher` | 접속기 소스 + 릴리스(설치 파일) |

`blackocean-pack` 은 같이 드린 `blackocean-pack` 폴더를 그대로 올리면 됩니다.
올리기 전에 `pack.config.json` 의 `rawBase` 를 `https://raw.githubusercontent.com/<깃허브아이디>/blackocean-pack/main` 으로 바꾸고
`node tools/build-manifest.js` 를 한 번 실행하세요.

### ② 마이크로소프트 로그인용 클라이언트 ID
접속기가 직접 로그인하려면 Azure 에 앱을 하나 등록해야 해요 (무료).
1. https://portal.azure.com → "앱 등록(App registrations)" → "새 등록"
   - 이름: BlackOcean Launcher / 지원 계정 유형: **개인 Microsoft 계정만** (또는 모든 계정)
   - 리디렉션 URI 는 비워 둠
2. 만든 앱 → "인증(Authentication)" → 아래 "고급 설정 → 퍼블릭 클라이언트 흐름 허용" **예** → 저장
3. "API 권한" → 권한 추가 → "내 조직에서 사용하는 API" → `Xbox Live` 검색 → `XboxLive.signin` 추가
4. "개요" 의 **애플리케이션(클라이언트) ID** 복사 → `src/main/config.js` 의 `MS_CLIENT_ID` 에 붙여넣기
5. **Minecraft API 사용 신청** (이게 있어야 마지막 단계가 통과돼요):
   https://help.minecraft.net/hc/en-us/articles/16254801392141 의 신청 폼에 클라이언트 ID 와 용도를 적어 제출.
   승인까지 며칠 걸릴 수 있어요. 승인 전에는 접속기의 "설정 → 공식 런처 계정 가져오기"로 테스트하세요.

### ③ config.js 채우기
`src/main/config.js`
- `MANIFEST_URL` → `https://raw.githubusercontent.com/<깃허브아이디>/blackocean-pack/main/manifest.json`
- `MS_CLIENT_ID` → ② 에서 복사한 값
`package.json` 의 `build.publish.owner` → 깃허브 아이디

## 2. 설치 파일 만들기 (Windows PC 에서)
```
npm install
npm run dist
```
→ `dist/BlackOcean-Setup-<버전>.exe` 와 `dist/latest.yml` 이 생겨요.

## 3. 접속기 새 버전 배포 (GitHub 가 대신 빌드)
1. `package.json` 의 `version` 올리기 (예 1.0.1) → commit → push
2. GitHub `blackocean-launcher` → **Actions** 탭 → `release` → **Run workflow** 버튼
   (또는 `git tag v1.0.1 && git push origin v1.0.1`)
3. 3~4분 뒤 Releases 에 `BlackOcean-Setup-1.0.1.exe` 와 `latest.yml` 이 자동으로 올라가요.
4. 시청자 접속기는 다음 실행 때 자동으로 받아서 "지금 적용" 버튼이 떠요.

시청자에게 줄 설치 파일 주소: https://github.com/summim/blackocean-launcher/releases/latest

## 4. 모드 바꾸기
`blackocean-pack` 저장소의 README 참고 (jar 넣고 `node tools/build-manifest.js` → push 끝).

## 폴더 구조
```
src/main/config.js    설정 (주소·클라이언트 ID·버전)
src/main/auth.js      마이크로소프트 → Xbox → Minecraft 로그인
src/main/java.js      자바 런타임 내려받기 (Adoptium)
src/main/vanilla.js   게임 본체·라이브러리·에셋
src/main/neoforge.js  NeoForge 설치기 실행
src/main/pack.js      모드팩 동기화
src/main/launch.js    실행 인자 조립 + 게임 실행
src/renderer/         화면 (HTML/CSS/JS)
```
