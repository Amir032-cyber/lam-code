import { useRef, useState } from 'react';
import { Upload } from 'lucide-react';
import { useApp } from '@/app/AppContext';
import { cn } from '@/lib/utils';

interface DropzoneProps {
  onUploaded?: (paths: string[]) => void;
  highlight?: string | null;
}

/** Zone de dépôt (glisser-déposer ou clic) : fichiers ≤ 10 Mo copiés dans /uploads. */
export function Dropzone({ onUploaded, highlight }: DropzoneProps) {
  const { store, t } = useApp();
  const input = useRef<HTMLInputElement>(null);
  const [over, setOver] = useState(false);

  async function handle(files: FileList | null) {
    if (!files || files.length === 0) return;
    const paths = await store.uploadFiles([...files]);
    if (paths.length) onUploaded?.(paths);
  }

  return (
    <div
      role="button"
      tabIndex={0}
      data-testid="dropzone"
      className={cn(
        'm-2 flex cursor-pointer flex-col items-center gap-1 rounded-md border border-dashed border-border p-3 text-center text-xs text-muted-foreground transition-colors',
        over && 'border-primary bg-primary/10',
        highlight && 'border-amber-400 bg-amber-400/10 text-amber-200',
      )}
      onClick={() => input.current?.click()}
      onKeyDown={(e) => (e.key === 'Enter' || e.key === ' ') && input.current?.click()}
      onDragOver={(e) => {
        e.preventDefault();
        setOver(true);
      }}
      onDragLeave={() => setOver(false)}
      onDrop={(e) => {
        e.preventDefault();
        setOver(false);
        void handle(e.dataTransfer.files);
      }}
    >
      <Upload className="h-4 w-4" />
      <span>{highlight ?? t('dropHere')}</span>
      <input
        ref={input}
        type="file"
        multiple
        hidden
        aria-label={t('upload')}
        onChange={(e) => {
          void handle(e.target.files);
          e.target.value = '';
        }}
      />
    </div>
  );
}
