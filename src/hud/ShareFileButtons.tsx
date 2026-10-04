import { type ChangeEvent, useRef, useState } from 'react';
import { Download, Upload } from 'lucide-react';

interface ShareFileButtonsProps {
  /** Save everything worth sharing to a file. */
  onExport: () => void;
  /** Read a chosen file; resolves to a message for the student (what was added, or what is wrong). */
  onImport: (text: string) => Promise<string>;
}

const BUTTON = 'hud-focus flex h-8 flex-1 items-center justify-center gap-1.5 rounded-[5px] border border-[hsl(var(--hud-line)/0.16)] text-[12px] text-foreground/85 transition-colors hover:border-primary/40 hover:text-primary';

/** Export / Import buttons for sharing saved systems and rocket presets as a file. */
const ShareFileButtons = ({ onExport, onImport }: ShareFileButtonsProps) => {
  const inputRef = useRef<HTMLInputElement>(null);
  const [message, setMessage] = useState('');

  const handleFile = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;
    if (file.size > 2_000_000) {
      setMessage('That file is too large to be a Cosmic Playground export.');
      return;
    }
    setMessage(await onImport(await file.text()));
  };

  return (
    <div className="grid gap-1.5">
      <div className="flex gap-1.5">
        <button type="button" className={BUTTON} onClick={() => { onExport(); setMessage('Downloaded every saved system and preset.'); }}>
          <Download size={13} /> Export file
        </button>
        <button type="button" className={BUTTON} onClick={() => inputRef.current?.click()}>
          <Upload size={13} /> Import file
        </button>
        <input ref={inputRef} type="file" accept=".json,application/json" className="hidden" onChange={handleFile} aria-label="Import file" />
      </div>
      <p className="min-h-4 text-[11.5px] leading-snug text-hud-dim" role="status">
        {message || 'Share setups between computers, e.g. a class set from a teacher.'}
      </p>
    </div>
  );
};

export default ShareFileButtons;
