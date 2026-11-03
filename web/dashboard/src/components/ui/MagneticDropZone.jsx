// Member 2: Magnetic Drop Zone: a dashed box that grows and darkens while a video is dragged over it; click to pick one.
import { useRef, useState } from 'react';
import { Icon } from '../ui.jsx';

export default function MagneticDropZone({ accept = 'video/mp4', onFile }) {
  const [near, setNear] = useState(false);
  const [file, setFile] = useState(null);
  const [error, setError] = useState('');
  const depth = useRef(0);

  const take = (picked) => {
    if (!picked) return;
    if (accept && picked.type && picked.type !== accept) {
      setFile(null);
      setError('Only MP4 videos work here.');
      return;
    }
    setError('');
    setFile(picked);
    onFile?.(picked);
  };

  const text = error || (file ? `${file.name} · ready to process` : near ? 'Let go to drop it' : 'Drop an MP4 here');

  return (
    <label className={`drop${near ? ' is-near' : ''}${file ? ' has-file' : ''}`}
      onDragEnter={(event) => { event.preventDefault(); depth.current += 1; setNear(true); }}
      onDragOver={(event) => event.preventDefault()}
      onDragLeave={() => { depth.current = Math.max(0, depth.current - 1); if (!depth.current) setNear(false); }}
      onDrop={(event) => { event.preventDefault(); depth.current = 0; setNear(false); take(event.dataTransfer.files?.[0]); }}>
      <input type="file" accept={accept} onChange={(event) => take(event.target.files?.[0])} />
      <Icon name="upload" size={28} />
      <span className="drop-text" aria-live="polite">{text}</span>
      <span className="label">or click to choose</span>
    </label>
  );
}
