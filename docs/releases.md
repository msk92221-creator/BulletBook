# 다른 컴퓨터에서 BulletBook 업데이트하기

APK는 GitHub Actions의 **Signed BulletBook release** 작업이 만듭니다. 개발 PC에는 Android SDK나 개인 서명키가 필요하지 않습니다. 기존 앱 ID `kr.co.bulletbook.next`, 앱 이름 `BulletBook`과 서명은 유지합니다.

## 평소 배포

1. 최신 `master`를 받아 수정하고 관련 검사를 실행합니다.
2. `npm run release:bump -- patch`로 앱 버전과 Android 업데이트 번호를 함께 올립니다. 필요한 경우 `minor` 또는 정확한 버전 번호를 지정할 수 있습니다.
3. README에 `## 새버전번호 변경 제목` 항목으로 변경 내용을 적습니다.
4. 변경을 커밋하고 `master`에 올립니다.
5. GitHub의 Actions → Signed BulletBook release가 성공하면 Releases에 APK·Windows ZIP·체크섬이 올라갑니다. 폰에서는 기존 앱의 업데이트 확인을 누릅니다.

현재 공개 버전과 같은 번호를 올리면 중복 배포하지 않습니다. 이전 버전으로 내리거나 Android 업데이트 번호가 증가하지 않으면 중단합니다. 이미 공개된 APK를 덮어쓰지 않습니다. 자동 작업은 한 번에 하나만 배포하며 중간 업로드는 초안으로 보관하고 파일 검증이 끝나면 공개합니다.

실패했다면 Actions의 실패 단계부터 확인하고 수정한 뒤 다시 올리세요. 같은 버전은 아직 공개되지 않은 경우 재시도할 수 있습니다. Actions의 Run workflow 또는 `gh workflow run release.yml --ref master`로 다시 시작할 수도 있습니다.

## 서명키 관리

GitHub 저장소의 `android-release` 환경에 아래 비밀 설정을 저장합니다. 환경의 배포 허용 브랜치는 `master`뿐입니다.

- `ANDROID_KEYSTORE_BASE64`: 기존 `bulletbook-release.jks`의 Base64 표현
- `ANDROID_KEYSTORE_PROPERTIES_BASE64`: 기존 `keystore.properties`의 Base64 표현

Base64는 전달 형식이며 GitHub Secrets가 암호화 보관합니다. 키나 비밀번호를 소스, 이 문서, 로그, 배포 ZIP에 넣지 않습니다. 임시 키 파일은 작업 후 지웁니다. PR 검사에는 이 환경과 서명키를 제공하지 않습니다.

현재 설치 계열의 **공개 인증서** SHA-256:

`c4098a5ddd9a7cec1291f251696ea1eadd6336fe98e6c0999588cd28d95bc47d`

서명키가 없거나 위 인증서와 다르면 공개를 중단합니다. 새 컴퓨터에서 임의의 새 키를 만들지 마세요. 로컬에 보관한 원본 서명키 백업은 계속 보존합니다. 저장소에 코드를 올리거나 배포 작업을 수정할 권한은 신뢰하는 사람에게만 부여합니다.

수동 배포용 이전 PowerShell 도구도 이제 GitHub 작업을 실행하며 로컬에서 다른 키로 서명하지 않습니다.
