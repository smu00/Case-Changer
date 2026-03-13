# CaseChanger — 설계 문서

피그마 파일 내 모든 컴포넌트의 프로퍼티 이름과 값을 선택한 케이스로 일괄 변환하는 플러그인.

## 파일 구조

```
CaseChanger/
├── manifest.json   ("ui": "ui.html" 포함)
├── code.js         (피그마 API — 컴포넌트 탐색 + 프로퍼티 변환)
└── ui.html         (모달 UI — 케이스 타입 선택)
```

## 사용 흐름

1. 플러그인 실행 → 모달 열림 (5개 케이스 버튼 리스트)
2. 케이스 타입 클릭 → 파일 내 모든 컴포넌트/컴포넌트셋의 프로퍼티 이름+값 일괄 변환
3. 결과 알림 (예: "42개 프로퍼티 변환 완료")
4. 모달 열린 상태 유지 (연속 작업 가능)

## 케이스 타입

| 케이스 | 입력 예시 | 출력 |
|--------|----------|------|
| camelCase | `Button Type`, `button_type` | `buttonType` |
| Title Case | `buttonType`, `button-type` | `Button Type` |
| snake_case | `buttonType`, `Button Type` | `button_type` |
| kebab-case | `Button Type`, `buttonType` | `button-type` |
| PascalCase | `button_type`, `button-type` | `ButtonType` |

## 단어 분리 규칙

원본 문자열을 단어 단위로 분리(소문자화)한 뒤 선택한 케이스로 재조합.

분리 기준:
- 공백 (`Button Type` → `['button', 'type']`)
- 하이픈 (`button-type` → `['button', 'type']`)
- 언더스코어 (`button_type` → `['button', 'type']`)
- camelCase/PascalCase 경계 (`buttonType` → `['button', 'type']`, `ButtonType` → `['button', 'type']`)

분리 후 모든 단어는 소문자로 통일한 뒤 케이스 규칙에 맞게 재조합.

## 변환 대상

- `figma.root.findAllWithCriteria({ types: ['COMPONENT', 'COMPONENT_SET'] })`로 로드된 페이지의 모든 컴포넌트/컴포넌트셋 탐색
- 외부 라이브러리 컴포넌트는 읽기 전용이므로 건너뜀

### 프로퍼티 변환 방법

#### 1. 비-Variant 프로퍼티 (BOOLEAN, TEXT, INSTANCE_SWAP)

프로퍼티 키가 `PropertyName#1234:0` 형태로 해시 접미사가 붙어 있음. 변환 시:
- 해시(`#`) 앞의 이름 부분만 케이스 변환
- 해시 접미사는 그대로 유지
- `editComponentProperty(oldFullKey, { name: newName })`으로 이름 변경

#### 2. Variant 프로퍼티

`componentPropertyDefinitions`의 `variantOptions`는 읽기 전용. Variant 값을 변환하려면:
- `ComponentSetNode.children` (각 ComponentNode) 순회
- 각 child의 `.name` 파싱 (형식: `Property=Value, Property=Value`)
- 프로퍼티 이름과 값 모두 케이스 변환
- 변환된 문자열을 `child.name`에 재할당

#### 3. 키 변동 대응

`editComponentProperty()` 호출 시 프로퍼티 키가 변경되므로, 한 컴포넌트의 프로퍼티를 변환할 때:
- 변환 전에 모든 프로퍼티 키를 스냅샷으로 저장
- 스냅샷 기반으로 순차 변환 (이미 변환된 키는 건너뜀)

#### 4. 이름 충돌 처리

변환 후 같은 이름이 되는 프로퍼티가 있을 경우 (예: `button_type`과 `Button Type` → 둘 다 `buttonType`):
- 첫 번째만 변환하고 나머지는 건너뜀
- 결과 메시지에 "N개 충돌로 건너뜀" 포함

## UI 모달

- **크기:** width 280px, height 280px
- 5개 케이스 버튼을 세로 리스트로 나열 (camelCase / Title Case / snake_case / kebab-case / PascalCase)
- 클릭 즉시 변환 (적용 버튼 없음)
- 하단에 결과/에러 메시지 영역

## 코드 아키텍처

### code.js (피그마 샌드박스)

- `figma.showUI(__html__, { width: 280, height: 280 })` 로 모달 열기
- UI에서 convert 메시지 수신 → 모든 컴포넌트 탐색 → 프로퍼티 이름+값 변환
- 변환 완료 시 변환된 프로퍼티 수를 UI에 전달
- 단어 분리 + 케이스 변환 로직은 code.js에 구현 (피그마 API 접근이 필요하므로)

### ui.html (모달 UI)

- HTML/CSS/JS 단일 파일
- 케이스 버튼 클릭 → `parent.postMessage()`로 케이스 타입 전달
- 결과/에러 메시지 수신 → 화면에 표시

### 통신 프로토콜

```
ui.html → { type: 'convert', caseType: 'camelCase' }           → code.js
code.js → { type: 'result', message: '42개 프로퍼티 변환 완료' } → ui.html
code.js → { type: 'error', message: '변환할 프로퍼티가 없습니다' } → ui.html
```

## 예외 처리

- 변환 대상 프로퍼티가 없으면 → "변환할 프로퍼티가 없습니다" 안내
- 이미 해당 케이스인 프로퍼티는 건너뜀 (변환 카운트에 포함하지 않음)
- 외부 라이브러리 컴포넌트 → 건너뜀 (읽기 전용)
- 이름 충돌 → 첫 번째만 변환, 나머지 건너뜀 + 결과에 충돌 수 표시

## manifest.json

```json
{
  "name": "CaseChanger",
  "id": "",
  "api": "1.0.0",
  "main": "code.js",
  "ui": "ui.html",
  "capabilities": [],
  "enableProposedApi": false,
  "documentAccess": "dynamic-page",
  "editorType": ["figma"],
  "networkAccess": {
    "allowedDomains": ["none"]
  }
}
```

`documentAccess: "dynamic-page"` 사용. 사용자가 방문한 페이지의 컴포넌트만 변환 대상.

## 확장 계획 (v2)

향후 프로퍼티 외에 레이어 이름, 로컬 변수명, 로컬 스타일명도 변환 대상으로 추가 예정. 현재는 프로퍼티만 구현.

## 기술 결정

- **Vanilla JS** — 빌드 도구 없이 바로 피그마에서 로드 가능
- **변환 로직은 code.js에** — 피그마 API 접근이 필요하므로
- **모달은 변환 후에도 열린 상태** 유지하여 연속 작업 지원
