import { children, find, findAll, hasClass, parseHtml, textOf } from '#Html';
import { describe, expect, it } from 'vite-plus/test';

describe('parseHtml', () => {
  const root =
    parseHtml(`<!DOCTYPE html><html><head><title>T</title><script>if (1 < 2) { x = "<p>" }</script></head>
    <body><div class="a  b" data-id='7' hidden><p>Hello&nbsp;<b>world</b> &amp; all</p><br><img src=x/><span title="Jel&#237;nkov&#225;">37</span></div></p></body></html>`);

  it('builds the tree with attributes and decoded entities', () => {
    const div = find(root, (element) => element.tag === 'div')!;
    expect(hasClass(div, 'b')).toBe(true);
    expect(div.attributes).toEqual({ class: 'a  b', 'data-id': '7', hidden: '' });
    expect(textOf(find(div, (element) => element.tag === 'p')!)).toBe('Hello world & all');
    expect(find(root, (element) => element.tag === 'span')?.attributes['title']).toBe('Jelínková');
  });

  it('keeps script content out of the tree and tolerates stray closing tags', () => {
    expect(findAll(root, (element) => element.tag === 'p')).toHaveLength(1);
    expect(textOf(find(root, (element) => element.tag === 'script')!)).toBe(
      'if (1 < 2) { x = "<p>" }',
    );
    expect(children(find(root, (element) => element.tag === 'div')!).map((e) => e.tag)).toEqual([
      'p',
      'br',
      'img',
      'span',
    ]);
  });
});
