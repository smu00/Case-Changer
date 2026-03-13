# CaseChanger Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 피그마 파일 내 모든 컴포넌트 프로퍼티 이름+값을 선택한 케이스로 일괄 변환하는 플러그인 구현

**Architecture:** Vanilla JS 피그마 플러그인. `code.js`가 컴포넌트 탐색 + 케이스 변환 + 프로퍼티 수정, `ui.html`이 케이스 타입 선택 UI 담당. postMessage 통신.

**Tech Stack:** Figma Plugin API, Vanilla JS, HTML/CSS

**Spec:** `docs/superpowers/specs/2026-03-12-case-changer-design.md`

---

## Chunk 1: manifest.json + code.js

### Task 1: manifest.json 생성

**Files:**
- Create: `manifest.json`

- [ ] **Step 1: manifest.json 작성**

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

### Task 2: code.js 구현

**Files:**
- Create: `code.js`

- [ ] **Step 1: code.js 전체 작성**

```js
figma.showUI(__html__, { width: 280, height: 280 });

// ─── 단어 분리 ───

function splitWords(str) {
  // camelCase/PascalCase 경계에 구분자 삽입
  var result = str.replace(/([a-z])([A-Z])/g, '$1 $2');
  result = result.replace(/([A-Z]+)([A-Z][a-z])/g, '$1 $2');
  // 공백, 하이픈, 언더스코어로 분리 후 소문자화
  return result
    .split(/[\s\-_]+/)
    .filter(function (w) { return w.length > 0; })
    .map(function (w) { return w.toLowerCase(); });
}

// ─── 케이스 변환 ───

function capitalize(word) {
  return word.charAt(0).toUpperCase() + word.slice(1);
}

function toCamelCase(words) {
  return words.map(function (w, i) {
    return i === 0 ? w : capitalize(w);
  }).join('');
}

function toTitleCase(words) {
  return words.map(function (w) {
    return capitalize(w);
  }).join(' ');
}

function toSnakeCase(words) {
  return words.join('_');
}

function toKebabCase(words) {
  return words.join('-');
}

function toPascalCase(words) {
  return words.map(function (w) {
    return capitalize(w);
  }).join('');
}

function convertCase(str, caseType) {
  var words = splitWords(str);
  if (words.length === 0) return str;
  switch (caseType) {
    case 'camelCase': return toCamelCase(words);
    case 'titleCase': return toTitleCase(words);
    case 'snake_case': return toSnakeCase(words);
    case 'kebab-case': return toKebabCase(words);
    case 'PascalCase': return toPascalCase(words);
    default: return str;
  }
}

// ─── 프로퍼티 이름에서 해시 접미사 분리 ───

function splitPropertyKey(key) {
  var hashIndex = key.lastIndexOf('#');
  if (hashIndex === -1) return { name: key, suffix: '' };
  return { name: key.substring(0, hashIndex), suffix: key.substring(hashIndex) };
}

// ─── Variant 자식 이름 변환 ───

function convertVariantChildName(name, caseType) {
  // "Property=Value, Property=Value" 형식 파싱
  return name.split(', ').map(function (pair) {
    var eqIndex = pair.indexOf('=');
    if (eqIndex === -1) return pair;
    var prop = pair.substring(0, eqIndex);
    var val = pair.substring(eqIndex + 1);
    return convertCase(prop, caseType) + '=' + convertCase(val, caseType);
  }).join(', ');
}

// ─── 메인 변환 로직 ───

function convertAll(caseType) {
  var nodes = figma.root.findAllWithCriteria({
    types: ['COMPONENT', 'COMPONENT_SET']
  });

  var convertedCount = 0;
  var skippedCollisions = 0;

  for (var n = 0; n < nodes.length; n++) {
    var node = nodes[n];

    // 외부 라이브러리 컴포넌트 건너뜀
    if (node.remote) continue;

    var defs = node.componentPropertyDefinitions;
    if (!defs) continue;

    // ─── 비-Variant 프로퍼티 변환 ───
    // 스냅샷 저장
    var keys = Object.keys(defs);
    var usedNames = {};

    for (var i = 0; i < keys.length; i++) {
      var key = keys[i];
      var def = defs[key];

      // Variant 프로퍼티는 별도 처리
      if (def.type === 'VARIANT') continue;

      var parts = splitPropertyKey(key);
      var newName = convertCase(parts.name, caseType);

      // 이미 같은 이름이면 건너뜀
      if (newName === parts.name) continue;

      // 충돌 검사
      if (usedNames[newName]) {
        skippedCollisions++;
        continue;
      }
      usedNames[newName] = true;

      try {
        node.editComponentProperty(key, { name: newName });
        convertedCount++;
      } catch (e) {
        // 변환 실패 시 건너뜀
      }
    }

    // ─── Variant 프로퍼티 변환 (ComponentSet만) ───
    if (node.type === 'COMPONENT_SET') {
      var children = node.children;
      for (var c = 0; c < children.length; c++) {
        var child = children[c];
        var newChildName = convertVariantChildName(child.name, caseType);
        if (newChildName !== child.name) {
          child.name = newChildName;
          convertedCount++;
        }
      }
    }
  }

  return { convertedCount: convertedCount, skippedCollisions: skippedCollisions };
}

// ─── UI 메시지 수신 ───

figma.ui.onmessage = function (msg) {
  if (msg.type === 'convert') {
    var result = convertAll(msg.caseType);

    if (result.convertedCount === 0 && result.skippedCollisions === 0) {
      figma.ui.postMessage({
        type: 'error',
        message: '변환할 프로퍼티가 없습니다'
      });
      return;
    }

    var message = result.convertedCount + '개 프로퍼티 변환 완료';
    if (result.skippedCollisions > 0) {
      message += ' (' + result.skippedCollisions + '개 충돌로 건너뜀)';
    }

    figma.ui.postMessage({ type: 'result', message: message });
  }
};
```

---

## Chunk 2: ui.html 완성 파일

### Task 3: ui.html 생성

**Files:**
- Create: `ui.html`

- [ ] **Step 1: ui.html 전체 파일 작성**

```html
<!DOCTYPE html>
<html>
<head>
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body {
      font-family: 'Inter', sans-serif;
      font-size: 13px;
      color: #333;
      padding: 16px;
      display: flex;
      flex-direction: column;
      height: 100vh;
    }
    .type-list {
      display: flex;
      flex-direction: column;
      gap: 6px;
      flex: 1;
    }
    .type-btn {
      display: block;
      width: 100%;
      padding: 10px 12px;
      border: 1px solid #e0e0e0;
      border-radius: 8px;
      background: #fff;
      font-size: 13px;
      cursor: pointer;
      text-align: left;
      transition: all 0.15s;
    }
    .type-btn:hover { border-color: #aaa; }
    .type-btn.selected {
      border-color: #18a0fb;
      background: #e8f4fe;
      color: #18a0fb;
      font-weight: 600;
    }
    .msg {
      margin-top: 12px;
      font-size: 12px;
      text-align: center;
      min-height: 16px;
    }
    .msg.error { color: #e74c3c; }
    .msg.success { color: #27ae60; }
  </style>
</head>
<body>
  <div class="type-list">
    <button class="type-btn" data-case="camelCase">camelCase</button>
    <button class="type-btn" data-case="titleCase">Title Case</button>
    <button class="type-btn" data-case="snake_case">snake_case</button>
    <button class="type-btn" data-case="kebab-case">kebab-case</button>
    <button class="type-btn" data-case="PascalCase">PascalCase</button>
  </div>

  <div class="msg" id="msg"></div>

  <script>
    // ─── code.js 메시지 수신 ───

    window.onmessage = function (event) {
      var msg = event.data.pluginMessage;
      if (!msg) return;
      var el = document.getElementById('msg');
      if (msg.type === 'result') {
        el.className = 'msg success';
        el.textContent = msg.message;
      } else if (msg.type === 'error') {
        el.className = 'msg error';
        el.textContent = msg.message;
      }
    };

    // ─── 케이스 버튼 클릭 → 즉시 변환 ───

    document.querySelectorAll('.type-btn').forEach(function (btn) {
      btn.addEventListener('click', function () {
        document.querySelectorAll('.type-btn').forEach(function (b) {
          b.classList.remove('selected');
        });
        btn.classList.add('selected');
        document.getElementById('msg').textContent = '';

        parent.postMessage({
          pluginMessage: { type: 'convert', caseType: btn.dataset.case }
        }, '*');
      });
    });
  </script>
</body>
</html>
```

---

## Chunk 3: 통합 테스트

### Task 4: 피그마에서 통합 테스트

- [ ] **Step 1: 피그마에서 플러그인 로드**

피그마 > Plugins > Development > Import plugin from manifest.

- [ ] **Step 2: 테스트용 컴포넌트 준비**

1. Component Set 생성 — Variant 프로퍼티 `Size=Small, Type=Primary` 등
2. 일반 컴포넌트 생성 — Boolean 프로퍼티 `is_visible`, Text 프로퍼티 `button_label` 등

- [ ] **Step 3: 각 케이스 타입 테스트**

1. camelCase 클릭 → `is_visible` → `isVisible`, `button_label` → `buttonLabel` 확인
2. Title Case 클릭 → `isVisible` → `Is Visible` 확인
3. snake_case 클릭 → `IsVisible` → `is_visible` 확인
4. kebab-case 클릭 → `is_visible` → `is-visible` 확인
5. PascalCase 클릭 → `is-visible` → `IsVisible` 확인
6. Variant 값도 함께 변환되는지 확인

- [ ] **Step 4: 예외 케이스 테스트**

1. 프로퍼티 없는 상태에서 클릭 → "변환할 프로퍼티가 없습니다" 확인
2. 이미 해당 케이스인 프로퍼티 → 건너뛰고 카운트에 미포함 확인
3. 결과 메시지에 변환 수 표시 확인
