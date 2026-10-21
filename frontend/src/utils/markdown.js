// Splits the Markdown of docs/legal/ into blocks: headings, paragraphs, lists and rules.
export function parseBlocks(source) {
  const blocks = [];
  let list = null;
  let paragraph = [];
  const flushParagraph = () => {
    if (paragraph.length) blocks.push({ type: 'p', text: paragraph.join(' ') });
    paragraph = [];
  };
  const flushList = () => {
    if (list) blocks.push({ type: 'ul', items: list });
    list = null;
  };

  for (const raw of source.split('\n')) {
    const line = raw.trim();
    const heading = line.match(/^(#{1,3})\s+(.*)$/);
    const bullet = line.match(/^[-*]\s+(.*)$/);
    const quote = line.match(/^>\s?(.*)$/);
    if (!line) { flushParagraph(); flushList(); continue; }
    if (heading) { flushParagraph(); flushList(); blocks.push({ type: `h${heading[1].length}`, text: heading[2] }); continue; }
    if (line === '---') { flushParagraph(); flushList(); blocks.push({ type: 'hr' }); continue; }
    if (bullet) { flushParagraph(); (list ||= []).push(bullet[1]); continue; }
    if (quote) { flushList(); paragraph.push(quote[1]); continue; }
    flushList();
    paragraph.push(line);
  }
  flushParagraph();
  flushList();
  return blocks;
}
