/* ============================================================
   语桥 ReadBridge — SmartSplit 文本标准化与智能分段引擎
   
   这是项目最核心的算法组件。用于将任意格式的 TXT 文本
   标准化为统一格式并智能分段。
   
   当前版本在 JS 和 Python (batch_translate.py) 中各有实现。
   修改算法时必须两边同步更新！
   
   算法流程:
     normalizeText() → 8步清洗标准化
     smartSplit()    → 4策略回退分段
   ============================================================ */

'use strict';

/**
 * normalizeText — TXT 标准化引擎（8步流水线）
 * 
 * 将来自任何来源的原始文本转为统一的段落分隔格式。
 * 输入: 原始文本字符串
 * 输出: 标准化文本（双换行分隔段落，每行去首尾空白）
 */
function normalizeText(text) {
  // 1. 统一换行符（Windows \r\n, Mac \r → Unix \n）
  text = text.replace(/\r\n/g, '\n').replace(/\r/g, '\n');

  // 2. 清理常见噪音标记
  text = text.replace(/第[【\[\(（]\s*\d+\s*[】\]\)）][段节]/g, '');  // 第【1】段
  text = text.replace(/^[\(（]\d+[\)）]\s*/gm, '');               // (1) 序号
  text = text.replace(/^\d{1,4}\s*$/gm, '');                      // 纯页码行
  text = text.replace(/^[\/\*\-—]{3,}\s*$/gm, '');                // 分隔线

  // 3. 检测中文段落缩进方式，统一为双换行
  //    全角空格　　：中文文档最常见的段首缩进
  //    混合空格[　 ]{2,}：半角/全角空格混合
  var fullSpaceCount = (text.match(/　　/g) || []).length;
  var mixedSpaceCount = (text.match(/[　 　]{2,}/g) || []).length;
  if (fullSpaceCount > 5 || mixedSpaceCount > 10) {
    text = text.replace(/[　 　]{2,}/g, '\n\n');
  }

  // 4. 单换行 → 双换行（保守策略：仅当文本长且无明显分段时）
  var doubleNewlines = (text.match(/\n\n/g) || []).length;
  if (doubleNewlines < 5 && text.length > 5000) {
    text = text.replace(/\n(?!\n)/g, '\n\n');
  }

  // 5. 压缩多余空行：3个以上换行 → 2个
  text = text.replace(/\n{3,}/g, '\n\n');

  // 6. 每行去首尾空白
  text = text.split('\n').map(function(l) { return l.trim(); }).join('\n');

  // 7. 注释标记独立成段
  //    中文序号标记 ①②③ 后接文字 → 与上文之间插入段落分隔
  text = text.replace(/([^\n])([①②③④⑤⑥⑦⑧⑨⑩⑪⑫⑬⑭⑮⑯⑰⑱⑲⑳]+\s*\S)/g, '$1\n\n$2');

  // 8. 去掉首尾空行
  text = text.replace(/^\n+/, '').replace(/\n+$/, '');

  return text;
}

/**
 * smartSplit — 智能分段引擎（4策略回退）
 * 
 * 在 normalizeText 之后调用。用多重策略确保文本被正确分段。
 * 
 * 策略1: 双换行分段（主力策略，覆盖95%的情况）
 * 策略2: 中文缩进分段（回退，覆盖空格缩进格式）
 * 策略3: 单换行分段（回退，覆盖简单分行格式）
 * 策略4: 句号强制分段（兜底，覆盖完全无结构文本）
 * 最终: 段内2格空格强制切分
 * 
 * 输入: 原始文本字符串（内部先调 normalizeText）
 * 输出: 段落字符串数组
 */
function smartSplit(text) {
  // 先标准化
  text = normalizeText(text);

  // 二次清理格式标记和页码（标准化后可能残留）
  text = text.replace(/第[【\[]\d+[】\]][段节]/g, '');
  text = text.replace(/^[\(（]\d+[\)）]\s*/gm, '');
  text = text.replace(/^\d{1,4}\s*$/gm, '');

  var paras = [];

  // === 策略1：双换行分段 ===
  paras = text.split(/\n\s*\n/).filter(function(p) { return p.trim(); });

  // === 策略2：中文段落缩进分段 ===
  // 触发条件：策略1产出太少（<10段）且文本较长（>2000字）
  if (paras.length < 10 && text.length > 2000) {
    var indentCount = (text.match(/[　 　]{2,}/g) || []).length;
    if (indentCount > 3) {
      paras = text.split(/[　 　]{2,}/).filter(function(p) { return p.trim(); });
      paras = paras.map(function(p) {
        return p.replace(/[　 　]+/g, '').trim();
      }).filter(function(p) { return p.length > 0; });
      // 第一段拆题记+章节标题
      if (paras.length > 0 && paras[0].indexOf('\n') !== -1) {
        var frontParts = paras[0].split(/\n+/).filter(function(p) { return p.trim(); });
        if (frontParts.length > 1) { paras.shift(); paras = frontParts.concat(paras); }
      }
    }
  }

  // === 策略3：单换行分段 ===
  if (paras.length < 10 && text.length > 2000) {
    var lines = text.split(/\n/).filter(function(l) { return l.trim(); });
    var merged = [];
    var buf = '';
    for (var i = 0; i < lines.length; i++) {
      var l = lines[i];
      if (l.length < 20 && buf) { buf += '\n' + l; }
      else { if (buf.trim()) merged.push(buf.trim()); buf = l; }
    }
    if (buf.trim()) merged.push(buf.trim());
    if (merged.length > paras.length) paras = merged;
  }

  // === 策略4：句号强制分段（兜底） ===
  if (paras.length < 5 && text.length > 2000) {
    var clean = text.replace(/\n/g, '').replace(/　/g, '');
    var sentences = clean.split(/(?<=[。！？\.\!\?])/);
    merged = [];
    buf = '';
    for (var j = 0; j < sentences.length; j++) {
      var s = sentences[j];
      if (buf.length + s.length > 800) { merged.push(buf.trim()); buf = s; }
      else { buf += s; }
    }
    if (buf.trim()) merged.push(buf.trim());
    if (merged.length > paras.length) paras = merged;
  }

  // === 最后一步：段内2格空格强制分段 ===
  var final = [];
  for (var k = 0; k < paras.length; k++) {
    var p = paras[k];
    if (p.length > 200 && /[　 　]{2,}/.test(p)) {
      var subParts = p.split(/[　 　]{2,}/).filter(function(s) { return s.trim(); });
      subParts = subParts.map(function(s) {
        return s.replace(/[　 　]+/g, '').trim();
      }).filter(function(s) { return s.length > 0; });
      final.push.apply(final, subParts);
    } else { final.push(p); }
  }

  return final.filter(function(p) { return p.length > 0; });
}

// 暴露到 window（被 app.js 和 HTML 使用）
window.normalizeText = normalizeText;
window.smartSplit = smartSplit;
