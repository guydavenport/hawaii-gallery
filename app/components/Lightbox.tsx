'use client';

import { useEffect } from 'react';
import type { CSSProperties } from 'react';
import type { MediaItem } from '@/app/lib/types';

interface LightboxProps {
  items: MediaItem[];
  index: number;
  onClose: () => void;
  onNavigate: (index: number) => void;
}

export default function Lightbox({ items, index, onClose, onNavigate }: LightboxProps) {
  const item = items[index];

  useEffect(() => {
    function handleKey(event: KeyboardEvent) {
      if (event.key === 'Escape') onClose();
      if (event.key === 'ArrowLeft') onNavigate((index - 1 + items.length) % items.length);
      if (event.key === 'ArrowRight') onNavigate((index + 1) % items.length);
    }
    window.addEventListener('keydown', handleKey);
    return () => window.removeEventListener('keydown', handleKey);
  }, [index, items.length, onClose, onNavigate]);

  if (!item) return null;

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
          <h3 style={{ margin: '0 0 0.35rem' }}>{item.title}</h3>
          <p style={{ margin: 0, color: '#cbd5e1' }}>{item.description}</p>
          <p style={{ margin: '0.35rem 0 0', color: '#94a3b8', fontSize: '0.9rem' }}>
            {item.location} · {index + 1} of {items.length}
          </p>
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
  alignItems: 'center',
  justifyContent: 'center',
  padding: '2rem',
};

const contentStyle: CSSProperties = {
  maxWidth: '90vw',
  maxHeight: '90vh',
  display: 'flex',
  flexDirection: 'column',
  alignItems: 'center',
  gap: '0.75rem',
};

const mediaStyle: CSSProperties = {
  maxWidth: '90vw',
  maxHeight: '75vh',
  objectFit: 'contain',
  borderRadius: 12,
};

const captionStyle: CSSProperties = {
  color: 'white',
  textAlign: 'center',
  maxWidth: '70ch',
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
