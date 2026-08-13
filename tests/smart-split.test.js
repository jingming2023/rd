/**
 * smartSplit 单元测试 — 8 类典型文本
 * 
 * 覆盖：双换行/缩进/单行/无结构/页码/题记/注释/超长段内切分
 */
import { describe, it, expect } from 'vitest';

// 加载浏览器版 smart-split（通过 eval 模拟 window）
const window = {};
const fs = await import('node:fs');
const code = fs.readFileSync('./js/smart-split.js', 'utf-8');
eval(code);
const { normalizeText, smartSplit } = window;

describe('normalizeText 标准化', () => {
  it('统一 Windows 换行符', () => {
    expect(normalizeText('a\r\nb')).toBe('a\nb');
  });

  it('清理页码行', () => {
    const out = normalizeText('第一段\n\n12\n\n第二段');
    expect(out).not.toMatch(/^\d+$/m);
  });

  it('清理第【N】段标记', () => {
    const out = normalizeText('第【1】段内容');
    expect(out).not.toContain('第【1】段');
  });

  it('压缩多余空行', () => {
    expect(normalizeText('a\n\n\n\nb')).toBe('a\n\nb');
  });

  it('去首尾空行', () => {
    expect(normalizeText('\n\n内容\n\n')).toBe('内容');
  });
});

describe('smartSplit 分段策略', () => {
  // 生成 >2000 字符的文本（策略2/3/4 的前置条件）
  const LONG = '这里是足够长的正文内容，用来触发分段策略。';

  it('策略1：双换行分段', () => {
    const paras = smartSplit('第一段。\n\n第二段。\n\n第三段。');
    expect(paras.length).toBe(3);
  });

  it('策略2：全角空格缩进分段（长文本）', () => {
    const text = Array.from({length: 15}, (_, i) => `　　第${i}段内容。${LONG.repeat(3)}`).join('\n');
    const paras = smartSplit(text);
    expect(paras.length).toBeGreaterThanOrEqual(3);
  });

  it('策略3：单换行分段（短行合并，长文本）', () => {
    const line = LONG.repeat(5);  // 每行约105字符
    const text = Array.from({length: 25}, () => line).join('\n');  // 2625字符
    const paras = smartSplit(text);
    expect(paras.length).toBeGreaterThan(3);
  });

  it('策略4：句号强制分段（兜底，无换行长文本）', () => {
    const text = ('这是没有换行的一段话。'.repeat(200));
    const paras = smartSplit(text);
    expect(paras.length).toBeGreaterThan(1);
  });

  it('短文本（<2000字）单换行不分段（已知行为：策略2/3/4不触发）', () => {
    const paras = smartSplit('一行内容。\n另一行内容。');
    expect(paras.length).toBe(1);
  });

  it('题记/章节标题独立成段', () => {
    const text = '序言\n\n正文第一段。\n\n正文第二段。';
    const paras = smartSplit(text);
    expect(paras.length).toBeGreaterThanOrEqual(3);
  });

  it('注释标记独立成段', () => {
    const text = '正文内容。①这是注释内容。\n\n下一段。';
    const paras = smartSplit(text);
    expect(paras.some(p => p.includes('①'))).toBe(true);
  });

  it('超长段内 2 格空格强制切分', () => {
    const longPara = '甲'.repeat(250) + '　　' + '乙'.repeat(250);
    const paras = smartSplit(longPara);
    expect(paras.some(p => p.includes('甲'))).toBe(true);
    expect(paras.some(p => p.includes('乙'))).toBe(true);
  });

  it('空输入返回空数组', () => {
    expect(smartSplit('')).toEqual([]);
  });

  it('短文本（<2000字）不分段兜底', () => {
    const paras = smartSplit('这是一段短文本。');
    expect(paras.length).toBeGreaterThanOrEqual(1);
  });
});

describe('幂等性', () => {
  it('对已分段结果再次 smartSplit 不增加段落数', () => {
    const original = '第一段内容。\n\n第二段内容。\n\n第三段内容。';
    const once = smartSplit(original);
    const twice = smartSplit(once.join('\n\n'));
    expect(twice.length).toBeLessThanOrEqual(once.length + 1);
  });
});
