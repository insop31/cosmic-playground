import { type ChangeEvent, useRef, useState } from 'react';
import { Download, Upload } from 'lucide-react';

interface ShareFileButtonsProps {
  /** Save everything worth sharing to a file. */
  onExport: () => void;
  /** Read a chosen file; returns a message for the student (what was added, or what is wrong). */
  onImport: (text: string) => string;
  disabled?: boolean;
}

/** Export / Import buttons for sharing saved systems and rocket presets as a file. */
const ShareFileButtons = ({ onExport, onImport, disabled }: ShareFileButtonsProps) => {
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
    setMessage(onImport(await file.text()));
  };

  return (
    <div className="space-y-1">
      <div className="flex gap-2">
        <button
          type="button"
          onClick={() => { onExport(); setMessage('Exported saved systems and presets.'); }}
          disabled={disabled}
          className="flex flex-1 items-center justify-center gap-1.5 rounded-md border border-border/40 bg-muted/10 px-3 py-1.5 text-xs text-muted-foreground transition-colors hover:border-primary/40 hover:text-primary disabled:opacity-40"
        >
          <Download size={12} /> Export file
        </button>
        <button
          type="button"
          onClick={() => inputRef.current?.click()}
          disabled={disabled}
          className="flex flex-1 items-center justify-center gap-1.5 rounded-md border border-border/40 bg-muted/10 px-3 py-1.5 text-xs text-muted-foreground transition-colors hover:border-primary/40 hover:text-primary disabled:opacity-40"
        >
          <Upload size={12} /> Import file
        </button>
        <input ref={inputRef} type="file" accept=".json,application/json" className="hidden" onChange={handleFile} aria-label="Import file" />
      </div>
      {message && <p className="text-xs text-primary/90" role="status">{message}</p>}
    </div>
  );
};

export default ShareFileButtons;
