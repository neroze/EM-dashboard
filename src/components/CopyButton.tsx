import { useState, type MouseEvent } from 'react';
import { copyElement } from '../copy.ts';

/** copies the nearest [data-copy] container's data (see copy.ts) */
export function CopyButton({ className, title }: { className?: string; title?: string }) {
  const [state, setState] = useState<'idle' | 'ok' | 'err'>('idle');
  const onClick = async (e: MouseEvent<HTMLButtonElement>) => {
    e.stopPropagation(); // copy buttons sit in clickable headers
    const root = e.currentTarget.closest('[data-copy]');
    if (!root) return;
    try { await copyElement(root); setState('ok'); } catch { setState('err'); }
    setTimeout(() => setState('idle'), 1500);
  };
  return (
    <button type="button" className={'copy-btn' + (className ? ' ' + className : '') + (state === 'ok' ? ' ok' : '')} onClick={onClick}
      title={title ?? 'Copy this widget’s data as a bullet list — pastes as bullets into Confluence, Docs or Slack'}>
      {state === 'ok' ? '✓ Copied' : state === 'err' ? 'Copy failed' : '⧉ Copy'}
    </button>
  );
}
