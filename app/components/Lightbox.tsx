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

const SLIDESHOW_DELAY_KEY = 'hawaii-gallery-slideshow-delay';

export default function Lightbox({ items, index, role, onClose, onNavigate, onUpdate }: LightboxProps) {
  const [displayedIndex, setDisplayedIndex] = useState(index);
  const item = items[displayedIndex];
  const [isEditing, setIsEditing] = useState(false);
  const [titleDraft, setTitleDraft] = useState('');
  const [descriptionDraft, setDescriptionDraft] = useState('');
  const [ownerDraft, setOwnerDraft] = useState('');
  const [saving, setSaving] = useState(false);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [slideshowActive, setSlideshowActive] = useState(false);
  const [slideshowDelay, setSlideshowDelay] = useState(4);

  useEffect(() => {
    const saved = Number(window.localStorage.getItem(SLIDESHOW_DELAY_KEY));
    if (saved > 0) setSlideshowDelay(saved);
  }, []);

  useEffect(() => {
    setIsEditing(false);
  }, [index]);

  useEffect(() => {
    function handleFullscreenChange() {
      setIsFullscreen(!!document.fullscreenElement);
    }
    document.addEventListener('fullscreenchange', handleFullscreenChange);
    return () => document.removeEventListener('fullscreenchange', handleFullscreenChange);
  }, []);

  function toggleFullscreen() {
    if (document.fullscreenElement) {
      document.exitFullscreen();
    } else {
      document.documentElement.requestFullscreen().catch(() => {});
    }
  }

  function changeSlideshowDelay(seconds: number) {
    setSlideshowDelay(seconds);
    window.localStorage.setItem(SLIDESHOW_DELAY_KEY, String(seconds));
  }

  // Paced off `displayedIndex`, not `index`: the delay is "how long each
  // photo stays on screen," measured from when it actually finishes
  // displaying. Pacing off `index` instead (the requested target, which
  // advances the instant a click/timer fires) breaks down whenever a
  // full-res image takes longer to load than the delay -- the timer keeps
  // firing and racing `index` ahead while the display never catches up,
  // so the slideshow looks permanently stuck on the first photo.
  useEffect(() => {
    if (!slideshowActive) return;
    const timer = setTimeout(() => {
      onNavigate((displayedIndex + 1) % items.length);
    }, slideshowDelay * 1000);
    return () => clearTimeout(timer);
  }, [slideshowActive, slideshowDelay, displayedIndex, items.length, onNavigate]);

  // The caption/title are plain state derived from `index` and update
  // instantly, but the <img> keeps its previous pixels on screen until the
  // new src finishes loading -- without this, the old photo briefly pairs
  // with the new caption. Preload off-screen and only advance the displayed
  // item (image + caption together) once the target is actually ready.
  useEffect(() => {
    const target = items[index];
    if (!target) return;
    if (target.type === 'video') {
      setDisplayedIndex(index);
      return;
    }
    let cancelled = false;
    const preload = new window.Image();
    preload.src = target.displayUrl;
    const commit = () => {
      if (!cancelled) setDisplayedIndex(index);
    };
    if (preload.complete) commit();
    else {
      preload.onload = commit;
      preload.onerror = commit;
    }
    return () => {
      cancelled = true;
    };
  }, [index, items]);

  // Warms the browser's cache for the neighboring photos (full-res, so
  // often several MB) while the current one is showing, so that by the
  // time next/prev is actually requested -- a click, or the slideshow
  // timer -- the load-then-display gap above resolves near-instantly
  // instead of adding its own multi-second delay on top of the requested one.
  useEffect(() => {
    for (const neighbor of [items[(displayedIndex + 1) % items.length], items[(displayedIndex - 1 + items.length) % items.length]]) {
      if (neighbor && neighbor.type === 'photo') {
        new window.Image().src = neighbor.displayUrl;
      }
    }
  }, [displayedIndex, items]);

  useEffect(() => {
    function handleKey(event: KeyboardEvent) {
      if (isEditing) return;
      if (event.key === 'Escape') {
        if (settingsOpen) setSettingsOpen(false);
        else onClose();
      }
      if (event.key === 'ArrowLeft') onNavigate((index - 1 + items.length) % items.length);
      if (event.key === 'ArrowRight') onNavigate((index + 1) % items.length);
    }
    window.addEventListener('keydown', handleKey);
    return () => window.removeEventListener('keydown', handleKey);
  }, [index, items.length, onClose, onNavigate, isEditing, settingsOpen]);

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
      <button
        type="button"
        style={{ ...topRightButtonStyle, right: '4.2rem' }}
        onClick={(e) => {
          e.stopPropagation();
          toggleFullscreen();
        }}
        aria-label={isFullscreen ? 'Exit fullscreen' : 'Enter fullscreen'}
      >
        &#9974;
      </button>
      <div style={{ position: 'fixed', top: '1rem', right: '7.4rem', zIndex: 1001 }} onClick={(e) => e.stopPropagation()}>
        <button
          type="button"
          style={settingsOpen || slideshowActive ? { ...topRightButtonStyle, position: 'static', background: '#38bdf8', color: '#07111f' } : { ...topRightButtonStyle, position: 'static' }}
          onClick={() => setSettingsOpen((prev) => !prev)}
          aria-label="Slideshow settings"
        >
          &#9881;
        </button>
        {settingsOpen ? (
          <div style={settingsPanelStyle}>
            <button
              type="button"
              style={{ ...buttonStyle, width: '100%' }}
              onClick={() => setSlideshowActive((prev) => !prev)}
            >
              {slideshowActive ? 'Pause slideshow' : 'Start slideshow'}
            </button>
            <div style={{ marginTop: '0.75rem' }}>
              <p style={{ margin: '0 0 0.4rem', color: '#94a3b8', fontSize: '0.85rem' }}>Delay between photos</p>
              <div style={{ display: 'flex', gap: '0.4rem', flexWrap: 'wrap' }}>
                {[2, 4, 6, 10, 15].map((seconds) => (
                  <button
                    key={seconds}
                    type="button"
                    style={slideshowDelay === seconds ? delayChipActiveStyle : delayChipStyle}
                    onClick={() => changeSlideshowDelay(seconds)}
                  >
                    {seconds}s
                  </button>
                ))}
              </div>
            </div>
          </div>
        ) : null}
      </div>
      <div style={contentStyle} onClick={(e) => e.stopPropagation()}>
        {item.type === 'video' ? (
          <video controls autoPlay src={item.url} style={mediaStyle} />
        ) : (
          <img
            src={item.displayUrl}
            alt={item.title}
            style={{ ...mediaStyle, opacity: index === displayedIndex ? 1 : 0.5, transition: 'opacity 0.15s' }}
          />
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
                {item.location} · Photo by {item.owner} · {displayedIndex + 1} of {items.length}
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

const topRightButtonStyle: CSSProperties = {
  position: 'fixed',
  top: '1rem',
  background: 'rgba(15, 23, 42, 0.7)',
  color: 'white',
  border: 'none',
  borderRadius: '50%',
  width: 40,
  height: 40,
  fontSize: '1.15rem',
  lineHeight: '40px',
  cursor: 'pointer',
  zIndex: 1001,
};

const settingsPanelStyle: CSSProperties = {
  position: 'absolute',
  top: 'calc(100% + 0.5rem)',
  right: 0,
  width: 240,
  background: '#0f172a',
  border: '1px solid #334155',
  borderRadius: 12,
  padding: '0.85rem',
  boxShadow: '0 12px 32px rgba(0,0,0,0.5)',
  textAlign: 'left',
};

const delayChipStyle: CSSProperties = {
  padding: '0.35rem 0.65rem',
  borderRadius: 999,
  borderWidth: 1,
  borderStyle: 'solid',
  borderColor: '#334155',
  background: 'rgba(2, 6, 23, 0.6)',
  color: '#cbd5e1',
  cursor: 'pointer',
  fontSize: '0.8rem',
};

const delayChipActiveStyle: CSSProperties = {
  ...delayChipStyle,
  background: '#38bdf8',
  borderColor: '#38bdf8',
  color: '#07111f',
  fontWeight: 700,
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
