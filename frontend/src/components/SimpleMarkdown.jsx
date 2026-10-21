import React from 'react';
import { parseBlocks } from '../utils/markdown';

// Just enough Markdown for the legal documents in docs/legal/: headings (#, ##, ###),
// paragraphs, "- " lists and **bold**. No HTML is ever injected: the text is rendered as
// React nodes. Anything it does not know is shown as plain text.
function inline(text, keyPrefix) {
  return text.split(/(\*\*[^*]+\*\*)/g).map((part, i) =>
    part.startsWith('**') && part.endsWith('**') && part.length > 4
      ? <strong key={`${keyPrefix}-${i}`} className="font-bold text-secondary">{part.slice(2, -2)}</strong>
      : <React.Fragment key={`${keyPrefix}-${i}`}>{part}</React.Fragment>
  );
}

const SimpleMarkdown = ({ source }) => (
  <div className="space-y-4 text-slate-600 leading-relaxed">
    {parseBlocks(source).map((block, i) => {
      if (block.type === 'h1') return <h1 key={i} className="text-3xl font-black text-secondary tracking-tight">{block.text}</h1>;
      if (block.type === 'h2') return <h2 key={i} className="text-xl font-black text-secondary pt-4">{block.text}</h2>;
      if (block.type === 'h3') return <h3 key={i} className="text-lg font-bold text-secondary pt-2">{block.text}</h3>;
      if (block.type === 'hr') return <hr key={i} className="border-slate-100" />;
      if (block.type === 'ul') {
        return (
          <ul key={i} className="list-disc pl-6 space-y-2">
            {block.items.map((item, j) => <li key={j}>{inline(item, `${i}-${j}`)}</li>)}
          </ul>
        );
      }
      return <p key={i}>{inline(block.text, String(i))}</p>;
    })}
  </div>
);

export default SimpleMarkdown;
