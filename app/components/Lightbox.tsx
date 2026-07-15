'use client';

import { useEffect, useState } from 'react';
import type { CSSProperties } from 'react';
import type { MediaItem } from '@/app/lib/types';
import { downloadFile } from '@/app/lib/download';

type MediaUpdate = Partial<Pick<MediaItem, 'title' | 'description' | 'owner' | 'hidden'>>;

interface LightboxProps {
  items: MediaItem[];
  index: number;
  role?: 'admin' | 'guest' | null;
  onClose: () => void;
  onNavigate: (index: number) => void;
  onUpdate?: (id: string, updates: MediaUpdate) => Promise<MediaItem | null>;
}

export default function Lightbox({ items, index, role, onClose, onNavigate, onUpdate }: LightboxProps) {
  const item = items[index];
  const [isEditing, setIsEditing] = useState(false);
  const [titleDraft, setTitleDraft] = useState('');
  const [descriptionDraft, setDescriptionDraft] = useState('');
  const [ownerDraft, setOwnerDraft] = useState('');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    setIsEditing(false);
  }, [index]);

  useEffect(() => {
    function handleKey(event: KeyboardEvent) {
      if (isEditing) return;
      if (event.key === 'Escape') onClose();
      if (event.key === 'ArrowLeft') onNavigate((index - 1 + items.length) % items.length);
      if (event.key === 'ArrowRight') onNavigate((index + 1) % items.length);
    }
    window.addEventListener('keydown', handleKey);
    return () => window.removeEventListener('keydown', handleKey);
  }, [index, items.length, onClose, onNavigate, isEditing]);

  if (!item) return null;

  function startEdit() {
    setTitleDraft(item.title);
    setDescriptionDraft(item.description);
    setOwnerDraft(item.owner);
    setIsEditing(true);
  }

  async function saveEdit() {
    if (!onUpdate) return;
    setSaving(true);
    const updated = await onUpdate(item.id, { title: titleDraft, description: descriptionDraft, owner: ownerDraft });
    setSaving(false);
    if (updated) setIsEditing(false);
  }

  async function toggleHidden() {
    if (!onUpdate) return;
    await onUpdate(item.id, { hidden: !item.hidden });
  }

  return (
    <div style={overlayStyle} onClick={onClose}>
      <button type="button" style={{ ...navButtonStyle, right: '1rem' }} onClick={(e) => { e.stopPropagation(); onNavigate((index + 1) % items.length); }} aria-label="Next">
        &#8250;
      </button>
      <button type="button" style={{ ...navButtonStyle, left: '1rem' }} onClick={(e) => { e.stopPropagation(); onNavigate((index - 1 + items.length) % items.length); }} aria-label="Previous">
        &#8249;
      </button>
      <button type="button" style={closeButtonStyle} onClick={onClose} aria-label="Close">
        &times;
      </button>
      <div style={contentStyle} onClick={(e) => e.stopPropagation()}>
        {item.type === 'video' ? (
          <video controls autoPlay src={item.url} style={mediaStyle} />
        ) : (
          <img src={item.url} alt={item.title} style={mediaStyle} />
        )}
        <div style={captionStyle}>
          {isEditing ? (
            <div style={{ display: 'grid', gap: '0.5rem', textAlign: 'left' }}>
              <input value={titleDraft} onChange={(e) => setTitleDraft(e.target.value)} placeholder="Title" style={inputStyle} />
              <textarea
                value={descriptionDraft}
                onChange={(e) => setDescriptionDraft(e.target.value)}
                placeholder="Description"
                style={{ ...inputStyle, minHeight: 70 }}
              />
              <input value={ownerDraft} onChange={(e) => setOwnerDraft(e.target.value)} placeholder="Photographer" style={inputStyle} />
              <div style={{ display: 'flex', gap: '0.5rem' }}>
                <button type="button" style={buttonStyle} onClick={saveEdit} disabled={saving}>
                  {saving ? 'Saving...' : 'Save'}
                </button>
                <button type="button" style={{ ...buttonStyle, background: '#334155', color: 'white' }} onClick={() => setIsEditing(false)}>
                  Cancel
                </button>
              </div>
            </div>
          ) : (
            <>
              <h3 style={{ margin: '0 0 0.35rem' }}>{item.title}</h3>
              <p style={{ margin: 0, color: '#cbd5e1' }}>{item.description}</p>
              <p style={{ margin: '0.35rem 0 0', color: '#94a3b8', fontSize: '0.9rem' }}>
                {item.location} · Photo by {item.owner} · {index + 1} of {items.length}
              </p>
              <div style={{ display: 'flex', gap: '0.5rem', justifyContent: 'center', marginTop: '0.75rem' }}>
                <button type="button" style={smallButtonStyle} onClick={() => downloadFile(item.url, item.filename)}>
                  Download
                </button>
                {role === 'admin' && onUpdate ? (
                  <>
                    <button type="button" style={smallButtonStyle} onClick={startEdit}>Edit</button>
                    <button type="button" style={smallButtonStyle} onClick={toggleHidden}>
                      {item.hidden ? 'Unhide' : 'Hide from guests'}
                    </button>
                  </>
                ) : null}
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

const overlayStyle: CSSProperties = {
  position: 'fixed',
  inset: 0,
  background: 'rgba(2, 6, 23, 0.92)',
  zIndex: 1000,
  display: 'flex',
  alignItems: 'flex-start',
  justifyContent: 'center',
  padding: '2rem',
  overflowY: 'auto',
};

const contentStyle: CSSProperties = {
  maxWidth: '90vw',
  display: 'flex',
  flexDirection: 'column',
  alignItems: 'center',
  gap: '0.75rem',
  margin: 'auto',
};

const mediaStyle: CSSProperties = {
  maxWidth: '90vw',
  maxHeight: '60vh',
  objectFit: 'contain',
  borderRadius: 12,
};

const captionStyle: CSSProperties = {
  color: 'white',
  textAlign: 'center',
  maxWidth: '70ch',
  width: '90vw',
};

const navButtonStyle: CSSProperties = {
  position: 'fixed',
  top: '50%',
  transform: 'translateY(-50%)',
  background: 'rgba(15, 23, 42, 0.7)',
  color: 'white',
  border: 'none',
  borderRadius: '50%',
  width: 48,
  height: 48,
  fontSize: '1.75rem',
  lineHeight: '48px',
  cursor: 'pointer',
  zIndex: 1001,
};

const closeButtonStyle: CSSProperties = {
  position: 'fixed',
  top: '1rem',
  right: '1rem',
  background: 'rgba(15, 23, 42, 0.7)',
  color: 'white',
  border: 'none',
  borderRadius: '50%',
  width: 40,
  height: 40,
  fontSize: '1.5rem',
  lineHeight: '40px',
  cursor: 'pointer',
  zIndex: 1001,
};

const inputStyle: CSSProperties = {
  width: '100%',
  padding: '0.7rem 0.8rem',
  borderRadius: 10,
  border: '1px solid #334155',
  background: '#020617',
  color: 'white',
};

const buttonStyle: CSSProperties = {
  padding: '0.7rem 1rem',
  borderRadius: 10,
  border: 'none',
  background: '#38bdf8',
  color: '#07111f',
  cursor: 'pointer',
  fontWeight: 700,
};

const smallButtonStyle: CSSProperties = {
  padding: '0.45rem 0.8rem',
  borderRadius: 8,
  border: '1px solid #475569',
  background: 'rgba(15, 23, 42, 0.7)',
  color: '#e2e8f0',
  cursor: 'pointer',
  fontSize: '0.85rem',
};
