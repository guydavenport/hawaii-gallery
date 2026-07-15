'use client';

import { useEffect, useMemo, useState } from 'react';
import type { CSSProperties, FormEvent } from 'react';
import Link from 'next/link';
import type { MediaItem } from '@/app/lib/types';
import Lightbox from '@/app/components/Lightbox';

const HAWAII_TZ = 'Pacific/Honolulu';

function dayKey(createdAt: string) {
  return new Intl.DateTimeFormat('en-CA', { timeZone: HAWAII_TZ }).format(new Date(createdAt));
}

function dayLabel(createdAt: string) {
  return new Intl.DateTimeFormat('en-US', {
    timeZone: HAWAII_TZ,
    weekday: 'long',
    month: 'long',
    day: 'numeric',
    year: 'numeric',
  }).format(new Date(createdAt));
}

export default function GalleryApp() {
  const [items, setItems] = useState<MediaItem[]>([]);
  const [status, setStatus] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [isLoggedIn, setIsLoggedIn] = useState(false);
  const [role, setRole] = useState<'admin' | 'guest' | null>(null);
  const [checkingSession, setCheckingSession] = useState(true);
  const [lightboxIndex, setLightboxIndex] = useState<number | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editDraft, setEditDraft] = useState('');

  async function loadItems() {
    const res = await fetch('/api/media');
    if (!res.ok) {
      setItems([]);
      return;
    }
    const data = await res.json();
    setItems(Array.isArray(data) ? data : []);
  }

  async function checkSession() {
    setCheckingSession(true);
    try {
      const res = await fetch('/api/auth');
      const data = await res.json();
      if (data.authenticated) {
        setIsLoggedIn(true);
        setRole(data.role);
        await loadItems();
      } else {
        setIsLoggedIn(false);
        setRole(null);
      }
    } finally {
      setCheckingSession(false);
    }
  }

  useEffect(() => {
    checkSession();
  }, []);

  async function handleLogin(event: FormEvent) {
    event.preventDefault();
    setStatus('Signing in...');
    const response = await fetch('/api/auth', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password }),
    });
    if (response.ok) {
      const data = await response.json();
      setIsLoggedIn(true);
      setRole(data.role);
      setPassword('');
      setStatus('');
      await loadItems();
    } else {
      const error = await response.json().catch(() => ({}));
      setStatus(error.error || 'Login failed');
    }
  }

  async function handleLogout() {
    await fetch('/api/auth', { method: 'DELETE' });
    setIsLoggedIn(false);
    setRole(null);
    setItems([]);
    setStatus('Signed out.');
  }

  function startEdit(item: MediaItem) {
    setEditingId(item.id);
    setEditDraft(item.description);
  }

  async function saveEdit(id: string) {
    const response = await fetch(`/api/media/${id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ description: editDraft }),
    });
    if (response.ok) {
      const updated: MediaItem = await response.json();
      setItems((prev) => prev.map((item) => (item.id === id ? { ...item, ...updated } : item)));
      setEditingId(null);
    } else {
      setStatus('Failed to save description');
    }
  }

  async function toggleHidden(item: MediaItem) {
    const response = await fetch(`/api/media/${item.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ hidden: !item.hidden }),
    });
    if (response.ok) {
      const updated: MediaItem = await response.json();
      setItems((prev) => prev.map((entry) => (entry.id === item.id ? { ...entry, ...updated } : entry)));
    } else {
      setStatus('Failed to update visibility');
    }
  }

  const sortedItems = useMemo(
    () => [...items].sort((a, b) => a.createdAt.localeCompare(b.createdAt)),
    [items]
  );

  const dayGroups = useMemo(() => {
    const groups: { key: string; label: string; items: MediaItem[] }[] = [];
    for (const item of sortedItems) {
      const key = dayKey(item.createdAt);
      const last = groups[groups.length - 1];
      if (last && last.key === key) {
        last.items.push(item);
      } else {
        groups.push({ key, label: dayLabel(item.createdAt), items: [item] });
      }
    }
    return groups;
  }, [sortedItems]);

  if (checkingSession) {
    return null;
  }

  return (
    <div style={{ minHeight: '100vh', background: 'linear-gradient(135deg, #07111f 0%, #14233d 100%)', color: 'white', padding: '2rem 1.25rem' }}>
      <div style={{ maxWidth: 1100, margin: '0 auto', display: 'grid', gap: '1.5rem' }}>
        <header style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '1rem', flexWrap: 'wrap' }}>
          <div>
            <p style={{ margin: 0, textTransform: 'uppercase', letterSpacing: '0.3em', color: '#7dd3fc' }}>Hawaii trip gallery</p>
            <h1 style={{ margin: '0.35rem 0 0', fontSize: '2rem' }}>Private gallery for photos and videos</h1>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '1rem', flexWrap: 'wrap' }}>
            {isLoggedIn ? (
              <>
                <Link href="/map" style={linkStyle}>Map</Link>
                {role === 'admin' ? <Link href="/admin" style={linkStyle}>Admin</Link> : null}
                <button type="button" style={{ ...buttonStyle, background: '#334155', color: 'white' }} onClick={handleLogout}>
                  Sign out
                </button>
              </>
            ) : null}
          </div>
        </header>

        {status ? <p style={{ color: '#fca5a5', margin: 0 }}>{status}</p> : null}

        {!isLoggedIn ? (
          <section style={{ background: 'rgba(15, 23, 42, 0.9)', border: '1px solid #334155', borderRadius: 20, padding: '1.2rem' }}>
            <h2 style={{ marginTop: 0 }}>Sign in</h2>
            <form onSubmit={handleLogin} style={{ display: 'grid', gap: '0.75rem', maxWidth: 480 }}>
              <input value={email} onChange={(event) => setEmail(event.target.value)} placeholder="Email (leave blank for guest access)" style={inputStyle} />
              <input value={password} onChange={(event) => setPassword(event.target.value)} placeholder="Password" type="password" style={inputStyle} />
              <button type="submit" style={buttonStyle}>Sign in</button>
            </form>
          </section>
        ) : (
          <div style={{ display: 'grid', gap: '1.5rem' }}>
            {dayGroups.map((group) => (
              <section key={group.key}>
                <h2 style={{ fontSize: '1.15rem', color: '#7dd3fc', margin: '0 0 0.75rem' }}>{group.label}</h2>
                <div style={{ display: 'grid', gap: '1rem', gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))' }}>
                  {group.items.map((item) => {
                    const globalIndex = sortedItems.indexOf(item);
                    return (
                      <article key={item.id} style={{ background: 'rgba(15, 23, 42, 0.9)', border: '1px solid #334155', borderRadius: 20, overflow: 'hidden', opacity: item.hidden ? 0.5 : 1 }}>
                        <div style={{ cursor: 'pointer' }} onClick={() => setLightboxIndex(globalIndex)}>
                          {item.type === 'video' ? (
                            <video muted src={item.url} style={{ width: '100%', height: 180, objectFit: 'cover', background: '#020617' }} />
                          ) : (
                            <img src={item.url} alt={item.title} style={{ width: '100%', height: 180, objectFit: 'cover' }} />
                          )}
                        </div>
                        <div style={{ padding: '0.9rem' }}>
                          <h3 style={{ margin: '0 0 0.35rem' }}>{item.title}</h3>
                          {editingId === item.id ? (
                            <div style={{ display: 'grid', gap: '0.5rem' }}>
                              <textarea
                                value={editDraft}
                                onChange={(event) => setEditDraft(event.target.value)}
                                style={{ ...inputStyle, minHeight: 80 }}
                              />
                              <div style={{ display: 'flex', gap: '0.5rem' }}>
                                <button type="button" style={buttonStyle} onClick={() => saveEdit(item.id)}>Save</button>
                                <button type="button" style={{ ...buttonStyle, background: '#334155', color: 'white' }} onClick={() => setEditingId(null)}>Cancel</button>
                              </div>
                            </div>
                          ) : (
                            <p style={{ margin: '0 0 0.5rem', color: '#cbd5e1', lineHeight: 1.5 }}>{item.description}</p>
                          )}
                          <p style={{ margin: '0', color: '#94a3b8', fontSize: '0.92rem' }}>{item.location}</p>
                          {role === 'admin' && editingId !== item.id ? (
                            <div style={{ display: 'flex', gap: '0.5rem', marginTop: '0.6rem' }}>
                              <button type="button" style={smallButtonStyle} onClick={() => startEdit(item)}>Edit</button>
                              <button type="button" style={smallButtonStyle} onClick={() => toggleHidden(item)}>
                                {item.hidden ? 'Unhide' : 'Hide from guests'}
                              </button>
                            </div>
                          ) : null}
                        </div>
                      </article>
                    );
                  })}
                </div>
              </section>
            ))}
            {sortedItems.length === 0 ? <p style={{ color: '#94a3b8' }}>No photos yet.</p> : null}
          </div>
        )}
      </div>

      {lightboxIndex !== null ? (
        <Lightbox
          items={sortedItems}
          index={lightboxIndex}
          onClose={() => setLightboxIndex(null)}
          onNavigate={setLightboxIndex}
        />
      ) : null}
    </div>
  );
}

const inputStyle: CSSProperties = {
  width: '100%',
  padding: '0.8rem 0.9rem',
  borderRadius: 10,
  border: '1px solid #334155',
  background: '#020617',
  color: 'white',
};

const buttonStyle: CSSProperties = {
  padding: '0.8rem 1rem',
  borderRadius: 10,
  border: 'none',
  background: '#38bdf8',
  color: '#07111f',
  cursor: 'pointer',
  fontWeight: 700,
};

const smallButtonStyle: CSSProperties = {
  padding: '0.4rem 0.7rem',
  borderRadius: 8,
  border: '1px solid #334155',
  background: 'transparent',
  color: '#cbd5e1',
  cursor: 'pointer',
  fontSize: '0.85rem',
};

const linkStyle: CSSProperties = {
  color: '#7dd3fc',
  textDecoration: 'none',
  fontWeight: 600,
};
