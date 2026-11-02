// 접속기 기본 설정. 배포 전에 여기만 바꾸면 됩니다.
const path = require('path');
const os = require('os');

module.exports = {
  // ---- 서버 ----
  SERVER_NAME: '블랙오션',
  // ---- 모드팩 배포 (GitHub) ----
  // manifest.json 을 올려둔 주소. tools/build-manifest.js 가 만들어 줍니다.
  MANIFEST_URL: 'https://raw.githubusercontent.com/summim/blackocean-pack/main/manifest.json',
  // ---- 마이크로소프트 로그인 ----
  // Azure 포털에서 등록한 앱의 "애플리케이션(클라이언트) ID". README 의 "로그인 설정" 참고.
  MS_CLIENT_ID: '00000000-0000-0000-0000-000000000000',
  // ---- 게임 ----
  MC_VERSION: '1.21.1',
  NEOFORGE_VERSION: '21.1.265',
  JAVA_MAJOR: 21,
  GAME_DIR: path.join(process.env.APPDATA || os.homedir(), '.blackocean'),
  DEFAULT_RAM_MB: 4096,
  // Mojang / NeoForge / Adoptium 주소 (바꿀 일 없음)
  VERSION_MANIFEST: 'https://piston-meta.mojang.com/mc/game/version_manifest_v2.json',
  RESOURCES: 'https://resources.download.minecraft.net',
  NEOFORGE_INSTALLER: (v) => `https://maven.neoforged.net/releases/net/neoforged/neoforge/${v}/neoforge-${v}-installer.jar`,
  ADOPTIUM: (major) => `https://api.adoptium.net/v3/assets/latest/${major}/hotspot?os=windows&architecture=x64&image_type=jre&vendor=eclipse`,
};
