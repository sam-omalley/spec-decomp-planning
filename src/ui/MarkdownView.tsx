/**
 * Markdown view: the delivery plan rendered as Markdown for export.
 * Both the copyable source and the rendered preview come from the same
 * block model (planMarkdown.ts) so they can never drift. Read-only.
 */

import { useMemo, useState } from 'react';
import { useProjectGraph } from '../store/appStore.ts';
import {
  DEFAULT_MARKDOWN_OPTIONS,
  blocksToMarkdown,
  projectToPlanBlocks,
  type MarkdownOptions,
  type MdListItem,
} from './planMarkdown.ts';

function PreviewItems({ items }: { items: MdListItem[] }) {
  return (
    <ul className="md-list">
      {items.map((item, i) => (
        <li key={i}>
          <strong>{item.title}</strong>
          {item.detail !== '' && <span className="md-item-detail"> — {item.detail}</span>}
          {item.children.length > 0 && <PreviewItems items={item.children} />}
        </li>
      ))}
    </ul>
  );
}

function Preview({ options }: { options: MarkdownOptions }) {
  const graph = useProjectGraph();
  const blocks = useMemo(() => projectToPlanBlocks(graph, options), [graph, options]);
  if (blocks.length === 0) return <p className="pane-hint">Nothing to render yet.</p>;
  return (
    <div className="md-preview">
      {blocks.map((block, i) => {
        if (block.kind === 'list') return <PreviewItems key={i} items={block.items} />;
        const Heading = `h${block.level}` as 'h1';
        return (
          <div key={i}>
            <Heading className="md-heading">{block.text}</Heading>
            {block.detail !== '' && <p className="md-para">{block.detail}</p>}
          </div>
        );
      })}
    </div>
  );
}

const TOGGLES: { key: keyof MarkdownOptions; label: string }[] = [
  { key: 'details', label: 'Details' },
  { key: 'subItems', label: 'Sub-items' },
  { key: 'backlog', label: 'Backlog' },
];

export function MarkdownView() {
  const graph = useProjectGraph();
  const [options, setOptions] = useState<MarkdownOptions>(DEFAULT_MARKDOWN_OPTIONS);
  const [mode, setMode] = useState<'preview' | 'source'>('preview');
  const [copied, setCopied] = useState(false);

  const markdown = useMemo(
    () => blocksToMarkdown(projectToPlanBlocks(graph, options)),
    [graph, options],
  );

  async function copy() {
    try {
      await navigator.clipboard.writeText(markdown);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      setCopied(false);
    }
  }

  return (
    <div className="markdown-view">
      <div className="md-toolbar">
        <div className="view-tabs">
          <button
            className={mode === 'preview' ? 'view-tab view-tab-active' : 'view-tab'}
            onClick={() => setMode('preview')}
          >
            Preview
          </button>
          <button
            className={mode === 'source' ? 'view-tab view-tab-active' : 'view-tab'}
            onClick={() => setMode('source')}
          >
            Source
          </button>
        </div>
        <div className="md-options">
          {TOGGLES.map(({ key, label }) => (
            <label key={key} className="md-option">
              <input
                type="checkbox"
                checked={options[key]}
                onChange={(e) => setOptions((o) => ({ ...o, [key]: e.target.checked }))}
              />
              {label}
            </label>
          ))}
        </div>
        <div className="app-spacer" />
        <button
          className="button-primary md-copy"
          onClick={copy}
          disabled={markdown === ''}
        >
          {copied ? 'Copied ✓' : 'Copy Markdown'}
        </button>
      </div>
      {markdown === '' ? (
        <p className="pane-hint md-empty">
          No plan yet. Add groups in the Planning view and assign work items to them.
        </p>
      ) : mode === 'source' ? (
        <pre className="md-source">{markdown}</pre>
      ) : (
        <Preview options={options} />
      )}
    </div>
  );
}
