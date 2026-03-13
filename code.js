figma.showUI(__html__, { width: 400, height: 620 });

// ─── 단어 분리 ───

function splitWords(str) {
  var result = str.replace(/([a-z])([A-Z])/g, '$1 $2');
  result = result.replace(/([A-Z]+)([A-Z][a-z])/g, '$1 $2');
  return result
    .split(/[\s\-_]+/)
    .filter(function (w) { return w.length > 0; })
    .map(function (w) { return w.toLowerCase(); });
}

// ─── 케이스 변환 ───

function capitalize(word) {
  return word.charAt(0).toUpperCase() + word.slice(1);
}

function convertCase(str, caseType) {
  var words = splitWords(str);
  if (words.length === 0) return str;
  switch (caseType) {
    case 'camelCase':
      return words.map(function (w, i) { return i === 0 ? w : capitalize(w); }).join('');
    case 'titleCase':
      return words.map(capitalize).join(' ');
    case 'snake_case':
      return words.join('_');
    case 'kebab-case':
      return words.join('-');
    case 'PascalCase':
      return words.map(capitalize).join('');
    default: return str;
  }
}

// ─── 프로퍼티 키에서 해시 접미사 분리 ───

function splitPropertyKey(key) {
  var hashIndex = key.lastIndexOf('#');
  if (hashIndex === -1) return { name: key, suffix: '' };
  return { name: key.substring(0, hashIndex), suffix: key.substring(hashIndex) };
}

// ─── 노드 수집 ───

function getNodesForScope(scope) {
  if (scope === 'selection') {
    return figma.currentPage.selection.slice();
  } else if (scope === 'page') {
    return figma.currentPage.children.slice();
  } else {
    var all = [];
    for (var p = 0; p < figma.root.children.length; p++) {
      var page = figma.root.children[p];
      for (var c = 0; c < page.children.length; c++) {
        all.push(page.children[c]);
      }
    }
    return all;
  }
}

function collectAll(nodes) {
  var result = [];
  function walk(node) {
    result.push(node);
    if ('children' in node) {
      for (var i = 0; i < node.children.length; i++) {
        walk(node.children[i]);
      }
    }
  }
  for (var i = 0; i < nodes.length; i++) {
    walk(nodes[i]);
  }
  return result;
}

function getComponents(scope) {
  if (scope === 'file') {
    return figma.root.findAllWithCriteria({
      types: ['COMPONENT', 'COMPONENT_SET']
    });
  }
  var rootNodes = scope === 'page'
    ? figma.currentPage.children.slice()
    : figma.currentPage.selection.slice();
  return collectAll(rootNodes).filter(function (n) {
    return n.type === 'COMPONENT' || n.type === 'COMPONENT_SET';
  });
}

// ─── Variant child name 파싱 헬퍼 ───

function mapVariantPairs(name, mapFn) {
  return name.split(', ').map(function (pair) {
    var eqIndex = pair.indexOf('=');
    if (eqIndex === -1) return pair;
    return mapFn(pair.substring(0, eqIndex), pair.substring(eqIndex + 1));
  }).join(', ');
}

// ─── 1a. 프로퍼티 이름 변환 ───

function convertPropNames(scope, caseType) {
  var count = 0;
  var skipped = 0;
  var components = getComponents(scope);

  for (var n = 0; n < components.length; n++) {
    var node = components[n];
    if (node.remote) continue;
    if (node.type === 'COMPONENT' && node.parent && node.parent.type === 'COMPONENT_SET') continue;

    var defs;
    try { defs = node.componentPropertyDefinitions; } catch (e) { continue; }
    if (!defs) continue;

    // VARIANT 프로퍼티 이름: child name에서 = 앞 부분 변환
    if (node.type === 'COMPONENT_SET') {
      for (var c = 0; c < node.children.length; c++) {
        var child = node.children[c];
        var newChildName = mapVariantPairs(child.name, function (prop, val) {
          return convertCase(prop, caseType) + '=' + val;
        });
        if (newChildName !== child.name) {
          child.name = newChildName;
          count++;
        }
      }
    }

    // 비VARIANT 프로퍼티 이름: editComponentProperty로 변환
    try { defs = node.componentPropertyDefinitions; } catch (e) { continue; }
    var keys = Object.keys(defs);
    var usedNames = {};

    for (var i = 0; i < keys.length; i++) {
      var key = keys[i];
      if (defs[key].type === 'VARIANT') continue;

      var parts = splitPropertyKey(key);
      var newName = convertCase(parts.name, caseType);
      if (newName === parts.name) continue;
      if (usedNames[newName]) { skipped++; continue; }
      usedNames[newName] = true;

      try { node.editComponentProperty(key, { name: newName }); count++; } catch (e) {}
    }
  }

  return { count: count, skipped: skipped };
}

// ─── 1b. 프로퍼티 값 변환 (Variant 값) ───
// child name 수정으로 인해 Figma가 값을 오름차순 정렬함 (API 한계)

function convertPropValues(scope, caseType) {
  var count = 0;
  var components = getComponents(scope);

  for (var n = 0; n < components.length; n++) {
    var node = components[n];
    if (node.remote) continue;
    if (node.type !== 'COMPONENT_SET') continue;

    for (var c = 0; c < node.children.length; c++) {
      var child = node.children[c];
      var newName = mapVariantPairs(child.name, function (prop, val) {
        return prop + '=' + convertCase(val, caseType);
      });
      if (newName !== child.name) {
        child.name = newName;
        count++;
      }
    }
  }

  return { count: count, skipped: 0 };
}

// ─── 2. 프레임/섹션/컴포넌트 이름 변환 ───

function convertLayers(scope, caseType) {
  var count = 0;
  var allNodes = collectAll(getNodesForScope(scope));

  for (var i = 0; i < allNodes.length; i++) {
    var node = allNodes[i];
    if (node.type !== 'FRAME' && node.type !== 'SECTION' && node.type !== 'COMPONENT' && node.type !== 'COMPONENT_SET') continue;
    if (node.type === 'COMPONENT' && node.parent && node.parent.type === 'COMPONENT_SET') continue;
    var newName = convertCase(node.name, caseType);
    if (newName !== node.name) {
      node.name = newName;
      count++;
    }
  }
  return { count: count, skipped: 0 };
}

// ─── 3. 로컬 변수 변환 ───

async function convertVariables(caseType) {
  var count = 0;
  var collections = await figma.variables.getLocalVariableCollectionsAsync();

  for (var c = 0; c < collections.length; c++) {
    var varIds = collections[c].variableIds;
    for (var v = 0; v < varIds.length; v++) {
      var variable = await figma.variables.getVariableByIdAsync(varIds[v]);
      if (!variable) continue;
      var newName = convertCase(variable.name, caseType);
      if (newName !== variable.name) {
        variable.name = newName;
        count++;
      }
    }
  }
  return { count: count, skipped: 0 };
}

// ─── 4. 로컬 스타일 변환 ───

async function convertStyles(caseType) {
  var count = 0;
  var allStyles = [].concat(
    await figma.getLocalPaintStylesAsync(),
    await figma.getLocalTextStylesAsync(),
    await figma.getLocalEffectStylesAsync(),
    await figma.getLocalGridStylesAsync()
  );

  for (var i = 0; i < allStyles.length; i++) {
    var newName = convertCase(allStyles[i].name, caseType);
    if (newName !== allStyles[i].name) {
      allStyles[i].name = newName;
      count++;
    }
  }
  return { count: count, skipped: 0 };
}

// ─── UI 메시지 수신 ───

figma.ui.onmessage = async function (msg) {
  if (msg.type === 'convert') {
    try {
      await figma.loadAllPagesAsync();
      var caseType = msg.caseType;
      var targets = msg.targets;
      var scope = msg.scope;
      var isEn = msg.lang === 'en';
      var totalCount = 0;
      var totalSkipped = 0;
      var details = [];

      // 값을 먼저 변환 (이름 변환시 key가 바뀌므로)
      if (targets.indexOf('propValues') !== -1) {
        var rv = convertPropValues(scope, caseType);
        totalCount += rv.count;
        if (rv.count > 0) details.push((isEn ? 'Prop Values ' : '프로퍼티 값 ') + rv.count);
      }

      if (targets.indexOf('propNames') !== -1) {
        var rn = convertPropNames(scope, caseType);
        totalCount += rn.count;
        totalSkipped += rn.skipped;
        if (rn.count > 0) details.push((isEn ? 'Prop Names ' : '프로퍼티 이름 ') + rn.count);
      }

      if (targets.indexOf('layers') !== -1) {
        var rl = convertLayers(scope, caseType);
        totalCount += rl.count;
        if (rl.count > 0) details.push((isEn ? 'Frames ' : '프레임 ') + rl.count);
      }

      if (targets.indexOf('variables') !== -1) {
        var rv2 = await convertVariables(caseType);
        totalCount += rv2.count;
        if (rv2.count > 0) details.push((isEn ? 'Variables ' : '변수 ') + rv2.count);
      }

      if (targets.indexOf('styles') !== -1) {
        var rs = await convertStyles(caseType);
        totalCount += rs.count;
        if (rs.count > 0) details.push((isEn ? 'Styles ' : '스타일 ') + rs.count);
      }

      if (totalCount === 0 && totalSkipped === 0) {
        figma.notify(isEn ? 'Nothing to convert' : '변환할 대상이 없습니다', { error: true, timeout: 3000 });
        return;
      }

      var message = details.join(', ') + (isEn ? ' converted' : '개 변환 완료');
      if (totalSkipped > 0) {
        message += isEn
          ? ' (' + totalSkipped + ' skipped due to conflicts)'
          : ' (' + totalSkipped + '개 충돌로 건너뜀)';
      }

      figma.notify(message, { timeout: 3000 });
    } catch (e) {
      figma.notify('Error: ' + e.message, { error: true, timeout: 5000 });
    }
  } else if (msg.type === 'error') {
    figma.notify(msg.message, { error: true, timeout: 3000 });
  }
};
