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

// ─── 범위에 따라 노드 수집 ───

function getNodesForScope(scope) {
  if (scope === 'selection') {
    return figma.currentPage.selection.slice();
  } else if (scope === 'page') {
    return figma.currentPage.children.slice();
  } else {
    // file: 모든 페이지의 자식
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

// 재귀적으로 모든 하위 노드 수집
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

// ─── 컴포넌트 수집 헬퍼 ───

function getComponents(scope) {
  if (scope === 'file') {
    return figma.root.findAllWithCriteria({
      types: ['COMPONENT', 'COMPONENT_SET']
    });
  }
  var rootNodes = scope === 'page'
    ? figma.currentPage.children.slice()
    : figma.currentPage.selection.slice();
  var allNodes = collectAll(rootNodes);
  return allNodes.filter(function (n) {
    return n.type === 'COMPONENT' || n.type === 'COMPONENT_SET';
  });
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
      var children = node.children;
      for (var c = 0; c < children.length; c++) {
        var child = children[c];
        var newChildName = child.name.split(', ').map(function (pair) {
          var eqIndex = pair.indexOf('=');
          if (eqIndex === -1) return pair;
          return convertCase(pair.substring(0, eqIndex), caseType) + '=' + pair.substring(eqIndex + 1);
        }).join(', ');
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
      var def = defs[key];
      if (def.type === 'VARIANT') continue;

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

function convertPropValues(scope, caseType) {
  var count = 0;
  var components = getComponents(scope);

  for (var n = 0; n < components.length; n++) {
    var node = components[n];
    if (node.remote) continue;
    if (node.type !== 'COMPONENT_SET') continue;

    var children = node.children;
    for (var c = 0; c < children.length; c++) {
      var child = children[c];
      var newName = child.name.split(', ').map(function (pair) {
        var eqIndex = pair.indexOf('=');
        if (eqIndex === -1) return pair;
        return pair.substring(0, eqIndex) + '=' + convertCase(pair.substring(eqIndex + 1), caseType);
      }).join(', ');
      if (newName !== child.name) {
        child.name = newName;
        count++;
      }
    }
  }

  return { count: count, skipped: 0 };
}

// ─── COMPONENT_SET children 순서 복원 ───

function delay(ms) {
  return new Promise(function (resolve) { setTimeout(resolve, ms); });
}

async function saveAndRestoreOrder(scope, fn) {
  var components = getComponents(scope);
  var saved = [];

  for (var n = 0; n < components.length; n++) {
    var node = components[n];
    if (node.type !== 'COMPONENT_SET') continue;
    var refs = [];
    for (var c = 0; c < node.children.length; c++) {
      refs.push(node.children[c]);
    }
    saved.push({ node: node, children: refs });
  }

  fn();

  await delay(50);

  for (var s = 0; s < saved.length; s++) {
    var entry = saved[s];
    var node = entry.node;
    var original = entry.children;
    for (var i = 0; i < original.length; i++) {
      node.insertChild(i, original[i]);
    }
  }
}


// ─── 2. 레이어 이름 변환 ───

function convertLayers(scope, caseType) {
  var count = 0;
  var rootNodes = getNodesForScope(scope);
  var allNodes = collectAll(rootNodes);

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
    var collection = collections[c];

    var varIds = collection.variableIds;
    for (var v = 0; v < varIds.length; v++) {
      var variable = await figma.variables.getVariableByIdAsync(varIds[v]);
      if (!variable) continue;
      var newVarName = convertCase(variable.name, caseType);
      if (newVarName !== variable.name) {
        variable.name = newVarName;
        count++;
      }
    }
  }
  return { count: count, skipped: 0 };
}

// ─── 4. 로컬 스타일 변환 ───

async function convertStyles(caseType) {
  var count = 0;

  var paintStyles = await figma.getLocalPaintStylesAsync();
  var textStyles = await figma.getLocalTextStylesAsync();
  var effectStyles = await figma.getLocalEffectStylesAsync();
  var gridStyles = await figma.getLocalGridStylesAsync();

  var allStyles = paintStyles.concat(textStyles, effectStyles, gridStyles);

  for (var i = 0; i < allStyles.length; i++) {
    var style = allStyles[i];
    var newName = convertCase(style.name, caseType);
    if (newName !== style.name) {
      style.name = newName;
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

      var hasPropValues = targets.indexOf('propValues') !== -1;
      var hasPropNames = targets.indexOf('propNames') !== -1;

      if (hasPropValues || hasPropNames) {
        var propResults = { valCount: 0, nameCount: 0, nameSkipped: 0 };

        await saveAndRestoreOrder(scope, function () {
          if (hasPropValues) {
            var rv = convertPropValues(scope, caseType);
            propResults.valCount = rv.count;
          }
          if (hasPropNames) {
            var rn = convertPropNames(scope, caseType);
            propResults.nameCount = rn.count;
            propResults.nameSkipped = rn.skipped;
          }
        });

        totalCount += propResults.valCount + propResults.nameCount;
        totalSkipped += propResults.nameSkipped;
        if (propResults.valCount > 0) details.push((isEn ? 'Prop Values ' : '프로퍼티 값 ') + propResults.valCount);
        if (propResults.nameCount > 0) details.push((isEn ? 'Prop Names ' : '프로퍼티 이름 ') + propResults.nameCount);
      }

      if (targets.indexOf('layers') !== -1) {
        var r2 = convertLayers(scope, caseType);
        totalCount += r2.count;
        if (r2.count > 0) details.push((isEn ? 'Frames ' : '프레임 ') + r2.count);
      }

      if (targets.indexOf('variables') !== -1) {
        var r3 = await convertVariables(caseType);
        totalCount += r3.count;
        if (r3.count > 0) details.push((isEn ? 'Variables ' : '변수 ') + r3.count);
      }

      if (targets.indexOf('styles') !== -1) {
        var r4 = await convertStyles(caseType);
        totalCount += r4.count;
        if (r4.count > 0) details.push((isEn ? 'Styles ' : '스타일 ') + r4.count);
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
