import { describe, expect, it } from 'vitest';
import { ItemsStreamParser, extractJson } from './streamJson';
import { normaliseDraft } from './client';

const FULL = `{"scene":"一顿饭","reference":{"detected":true,"objects":["筷子"]},
"items":[
 {"name":"米饭","dish":null,"baseG":150,"per100g":{"kcal":116,"protein":2.6}},
 {"name":"番茄","dish":"番茄炒蛋","baseG":150,"per100g":{"kcal":18},"note":"含 {花括号} 与 \\"引号\\" 的说明"},
 {"name":"大豆油","dish":"番茄炒蛋","baseG":10,"per100g":{"kcal":899}}
],"assumptions":["米饭按一碗"],"confidence":0.85}`;

describe('ItemsStreamParser', () => {
  it('一次性喂完整 JSON 能解析出全部条目', () => {
    const p = new ItemsStreamParser();
    const items = p.push(FULL);
    expect(items.map((i) => i.name)).toEqual(['米饭', '番茄', '大豆油']);
    expect(items[1]?.note).toContain('{花括号}');
  });

  it('任意 chunk 边界都不能丢项或重复', () => {
    // 逐字符喂：模拟 SSE 把 JSON 切成几十片的最坏情况
    for (const size of [1, 2, 3, 7, 13, 29, 61]) {
      const p = new ItemsStreamParser();
      const got: string[] = [];
      for (let i = 0; i < FULL.length; i += size) {
        for (const it of p.push(FULL.slice(i, i + size))) got.push(String(it.name));
      }
      expect(got, `chunk=${size}`).toEqual(['米饭', '番茄', '大豆油']);
    }
  });

  it('字符串里的方括号和花括号不会破坏深度计数', () => {
    const p = new ItemsStreamParser();
    const json = '{"items":[{"name":"杂[烩]{菜}","baseG":100,"per100g":{"kcal":50}}]}';
    const items = p.push(json);
    expect(items).toHaveLength(1);
    expect(items[0]?.name).toBe('杂[烩]{菜}');
  });

  it('items 未出现前一直返回空', () => {
    const p = new ItemsStreamParser();
    expect(p.push('{"scene":"x",')).toEqual([]);
  });
});

describe('extractJson', () => {
  it('剥掉 markdown 围栏', () => {
    const v = extractJson<{ a: number }>('```json\n{"a":1}\n```');
    expect(v.a).toBe(1);
  });

  it('剥掉 JSON 前后的废话', () => {
    const v = extractJson<{ a: number }>('好的，结果如下：{"a":2} 希望有帮助');
    expect(v.a).toBe(2);
  });
});

describe('normaliseDraft', () => {
  it('丢弃没有热量的条目，而不是当成 0', () => {
    const d = normaliseDraft({
      items: [
        { name: '米饭', baseG: 150, per100g: { kcal: 116 } },
        { name: '神秘物', baseG: 50, per100g: {} },
        { name: '', baseG: 50, per100g: { kcal: 10 } },
        { name: '零克', baseG: 0, per100g: { kcal: 10 } },
      ],
    });
    expect(d.items.map((i) => i.name)).toEqual(['米饭']);
  });

  it('钳制异常克数并补齐置信度', () => {
    const d = normaliseDraft({
      items: [
        { name: '巨无霸', baseG: 99999, per100g: { kcal: 100 } },
        { name: '正常', baseG: 80, per100g: { kcal: 100 } },
      ],
    });
    expect(d.items[0]?.baseG).toBe(2000);
    expect(d.items[1]?.confidence).toBe(0.6);
  });

  it('缺字段时给出安全默认，不抛错', () => {
    const d = normaliseDraft({});
    expect(d.items).toEqual([]);
    expect(d.reference.objects).toEqual([]);
    expect(d.assumptions).toEqual([]);
    expect(d.confidence).toBeNull();
  });
});
