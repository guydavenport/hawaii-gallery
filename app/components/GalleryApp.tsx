'use client';

import { useEffect, useMemo, useState } from 'react';
import type { CSSProperties, FormEvent } from 'react';
import Link from 'next/link';
import JSZip from 'jszip';
import type { MediaItem } from '@/app/lib/types';
import Lightbox from '@/app/components/Lightbox';
import { downloadFile } from '@/app/lib/download';
import { PAGE_BACKGROUND } from '@/app/lib/theme';

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
  const [editTitleDraft, setEditTitleDraft] = useState('');
  const [editDraft, setEditDraft] = useState('');
  const [editOwnerDraft, setEditOwnerDraft] = useState('');
  const [menuOpen, setMenuOpen] = useState(false);
  const [selectMode, setSelectMode] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [downloading, setDownloading] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [photographerFilter, setPhotographerFilter] = useState<string | null>(null);
  const [peopleFilter, setPeopleFilter] = useState<string | null>(null);
  const [previewAsGuest, setPreviewAsGuest] = useState(false);

  const effectiveRole = previewAsGuest ? 'guest' : role;

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
    setPreviewAsGuest(false);
    setItems([]);
    setStatus('Signed out.');
  }

  async function updateItem(
    id: string,
    updates: Partial<Pick<MediaItem, 'title' | 'description' | 'owner' | 'hidden'>>
  ): Promise<MediaItem | null> {
    const response = await fetch(`/api/media/${id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(updates),
    });
    if (!response.ok) {
      setStatus('Failed to save changes');
      return null;
    }
    const updated: MediaItem = await response.json();
    setItems((prev) => prev.map((item) => (item.id === id ? { ...item, ...updated } : item)));
    return updated;
  }

  function startEdit(item: MediaItem) {
    setEditingId(item.id);
    setEditTitleDraft(item.title);
    setEditDraft(item.description);
    setEditOwnerDraft(item.owner);
  }

  async function saveEdit(id: string) {
    const updated = await updateItem(id, { title: editTitleDraft, description: editDraft, owner: editOwnerDraft });
    if (updated) setEditingId(null);
  }

  async function toggleHidden(item: MediaItem) {
    await updateItem(item.id, { hidden: !item.hidden });
  }

  function toggleSelected(id: string) {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  async function downloadSelected() {
    if (selectedIds.size === 0) return;
    setDownloading(true);
    setStatus(`Zipping ${selectedIds.size} item(s)...`);
    try {
      const zip = new JSZip();
      const selected = sortedItems.filter((item) => selectedIds.has(item.id));
      await Promise.all(
        selected.map(async (item) => {
          const response = await fetch(item.url, { cache: 'no-store' });
          const blob = await response.blob();
          zip.file(item.filename, blob);
        })
      );
      const zipBlob = await zip.generateAsync({ type: 'blob' });
      const objectUrl = URL.createObjectURL(zipBlob);
      const link = document.createElement('a');
      link.href = objectUrl;
      link.download = 'hawaii-gallery-photos.zip';
      document.body.appendChild(link);
      link.click();
      link.remove();
      URL.revokeObjectURL(objectUrl);
      setStatus('');
    } catch {
      setStatus('Failed to download selected items');
    } finally {
      setDownloading(false);
    }
  }

  const sortedItems = useMemo(
    () => [...items].sort((a, b) => a.createdAt.localeCompare(b.createdAt)),
    [items]
  );

  const roleVisibleItems = useMemo(
    () => (effectiveRole === 'admin' ? sortedItems : sortedItems.filter((item) => !item.hidden)),
    [sortedItems, effectiveRole]
  );

  const photographers = useMemo(() => {
    const counts = new Map<string, number>();
    for (const item of roleVisibleItems) {
      counts.set(item.owner, (counts.get(item.owner) || 0) + 1);
    }
    return Array.from(counts.entries()).sort((a, b) => b[1] - a[1]);
  }, [roleVisibleItems]);

  const people = useMemo(() => {
    const counts = new Map<string, number>();
    for (const item of roleVisibleItems) {
      for (const name of item.people || []) {
        counts.set(name, (counts.get(name) || 0) + 1);
      }
    }
    return Array.from(counts.entries()).sort((a, b) => b[1] - a[1]);
  }, [roleVisibleItems]);

  const filteredItems = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    return roleVisibleItems.filter((item) => {
      if (photographerFilter && item.owner !== photographerFilter) return false;
      if (peopleFilter && !item.people?.includes(peopleFilter)) return false;
      if (!q) return true;
      return (
        item.title.toLowerCase().includes(q) ||
        item.description.toLowerCase().includes(q) ||
        item.location.toLowerCase().includes(q) ||
        item.owner.toLowerCase().includes(q) ||
        (item.people || []).some((name) => name.toLowerCase().includes(q)) ||
        dayLabel(item.createdAt).toLowerCase().includes(q)
      );
    });
  }, [roleVisibleItems, searchQuery, photographerFilter, peopleFilter]);

  const dayGroups = useMemo(() => {
    const groups: { key: string; label: string; items: MediaItem[] }[] = [];
    for (const item of filteredItems) {
      const key = dayKey(item.createdAt);
      const last = groups[groups.length - 1];
      if (last && last.key === key) {
        last.items.push(item);
      } else {
        groups.push({ key, label: dayLabel(item.createdAt), items: [item] });
      }
    }
    return groups;
  }, [filteredItems]);

  function scrollToDay(key: string) {
    document.getElementById(`day-${key}`)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    setMenuOpen(false);
  }

  if (checkingSession) {
    return null;
  }

  return (
    <div style={{ minHeight: '100vh', background: PAGE_BACKGROUND, backgroundAttachment: 'fixed', color: 'white', padding: '2rem 1.25rem' }}>
      <div style={{ maxWidth: 1100, margin: '0 auto', display: 'grid', gap: '1.5rem' }}>
        <header className="gallery-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '1rem', flexWrap: 'wrap' }}>
          <div>
            <p style={{ margin: 0, textTransform: 'uppercase', letterSpacing: '0.3em', color: '#7dd3fc' }}>Hawaii trip gallery</p>
            <h1 style={{ margin: '0.35rem 0 0', fontSize: 'clamp(1.4rem, 5vw, 2rem)' }}>Private gallery for photos and videos</h1>
          </div>
          <div className="gallery-header-nav" style={{ display: 'flex', alignItems: 'center', gap: '1rem', flexWrap: 'wrap' }}>
            {isLoggedIn ? (
              <>
                {dayGroups.length > 0 ? (
                  <button type="button" style={smallButtonStyle} onClick={() => setMenuOpen(true)}>
                    &#9776; Jump to date
                  </button>
                ) : null}
                {sortedItems.length > 0 ? (
                  <button
                    type="button"
                    style={smallButtonStyle}
                    onClick={() => {
                      setSelectMode((prev) => !prev);
                      setSelectedIds(new Set());
                    }}
                  >
                    {selectMode ? 'Cancel select' : 'Select'}
                  </button>
                ) : null}
                <Link href="/map" style={linkStyle}>Map</Link>
                {role === 'admin' ? (
                  <button
                    type="button"
                    style={previewAsGuest ? chipStyleActive : smallButtonStyle}
                    onClick={() => setPreviewAsGuest((prev) => !prev)}
                  >
                    {previewAsGuest ? 'Exit guest preview' : 'Preview as guest'}
                  </button>
                ) : null}
                {effectiveRole === 'admin' ? <Link href="/admin" style={linkStyle}>Admin</Link> : null}
                <button type="button" style={{ ...buttonStyle, background: '#334155', color: 'white' }} onClick={handleLogout}>
                  Sign out
                </button>
              </>
            ) : null}
          </div>
        </header>

        {previewAsGuest ? (
          <div style={{ background: 'rgba(56, 189, 248, 0.15)', border: '1px solid #38bdf8', borderRadius: 12, padding: '0.75rem 1rem', display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '1rem', flexWrap: 'wrap' }}>
            <p style={{ margin: 0, color: '#7dd3fc', fontSize: '0.9rem' }}>
              👀 Previewing as a guest would see it — hidden items and admin controls are off.
            </p>
            <button type="button" style={chipStyleActive} onClick={() => setPreviewAsGuest(false)}>
              Exit preview
            </button>
          </div>
        ) : null}

        {isLoggedIn && sortedItems.length > 0 ? (
          <input
            value={searchQuery}
            onChange={(event) => setSearchQuery(event.target.value)}
            placeholder="Search by title, description, location, photographer, people, or date..."
            style={inputStyle}
          />
        ) : null}

        {isLoggedIn && photographers.length > 1 ? (
          <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
            <button
              type="button"
              style={photographerFilter === null ? chipStyleActive : chipStyle}
              onClick={() => setPhotographerFilter(null)}
            >
              All
            </button>
            {photographers.map(([owner, count]) => (
              <button
                key={owner}
                type="button"
                style={photographerFilter === owner ? chipStyleActive : chipStyle}
                onClick={() => setPhotographerFilter(owner === photographerFilter ? null : owner)}
              >
                {owner} ({count})
              </button>
            ))}
          </div>
        ) : null}

        {isLoggedIn && people.length > 0 ? (
          <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
            <span style={{ color: '#94a3b8', fontSize: '0.85rem', alignSelf: 'center', marginRight: '0.25rem' }}>People:</span>
            <button
              type="button"
              style={peopleFilter === null ? chipStyleActive : chipStyle}
              onClick={() => setPeopleFilter(null)}
            >
              All
            </button>
            {people.map(([name, count]) => (
              <button
                key={name}
                type="button"
                style={peopleFilter === name ? chipStyleActive : chipStyle}
                onClick={() => setPeopleFilter(name === peopleFilter ? null : name)}
              >
                {name} ({count})
              </button>
            ))}
          </div>
        ) : null}

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
              <section key={group.key} id={`day-${group.key}`} style={{ scrollMarginTop: '1rem' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', margin: '0 0 0.75rem' }}>
                  <h2 style={{ fontSize: '1.15rem', color: '#7dd3fc', margin: 0 }}>{group.label}</h2>
                  {selectMode ? (
                    <button
                      type="button"
                      style={smallButtonStyle}
                      onClick={() =>
                        setSelectedIds((prev) => {
                          const next = new Set(prev);
                          const allSelected = group.items.every((item) => next.has(item.id));
                          for (const item of group.items) {
                            if (allSelected) next.delete(item.id);
                            else next.add(item.id);
                          }
                          return next;
                        })
                      }
                    >
                      {group.items.every((item) => selectedIds.has(item.id)) ? 'Deselect day' : 'Select day'}
                    </button>
                  ) : null}
                </div>
                <div className="photo-grid" style={{ display: 'grid', gap: '1rem' }}>
                  {group.items.map((item) => {
                    const globalIndex = filteredItems.indexOf(item);
                    return (
                      <article key={item.id} style={{ background: 'rgba(15, 23, 42, 0.9)', border: '1px solid #334155', borderRadius: 20, overflow: 'hidden', opacity: item.hidden ? 0.5 : 1, position: 'relative' }}>
                        {selectMode ? (
                          <input
                            type="checkbox"
                            checked={selectedIds.has(item.id)}
                            onChange={() => toggleSelected(item.id)}
                            style={{ position: 'absolute', top: 10, left: 10, zIndex: 1, width: 20, height: 20 }}
                          />
                        ) : null}
                        <div
                          style={{ cursor: 'pointer' }}
                          onClick={() => (selectMode ? toggleSelected(item.id) : setLightboxIndex(globalIndex))}
                        >
                          {item.type === 'video' ? (
                            <video muted src={item.thumbnailUrl} style={{ width: '100%', height: 180, objectFit: 'cover', background: '#020617' }} />
                          ) : (
                            <img src={item.thumbnailUrl} alt={item.title} style={{ width: '100%', height: 180, objectFit: 'cover' }} />
                          )}
                        </div>
                        <div style={{ padding: '0.9rem' }}>
                          {editingId === item.id ? (
                            <div style={{ display: 'grid', gap: '0.5rem' }}>
                              <input
                                value={editTitleDraft}
                                onChange={(event) => setEditTitleDraft(event.target.value)}
                                placeholder="Title"
                                style={inputStyle}
                              />
                              <textarea
                                value={editDraft}
                                onChange={(event) => setEditDraft(event.target.value)}
                                placeholder="Description"
                                style={{ ...inputStyle, minHeight: 80 }}
                              />
                              <input
                                value={editOwnerDraft}
                                onChange={(event) => setEditOwnerDraft(event.target.value)}
                                placeholder="Photographer"
                                style={inputStyle}
                              />
                              <div style={{ display: 'flex', gap: '0.5rem' }}>
                                <button type="button" style={buttonStyle} onClick={() => saveEdit(item.id)}>Save</button>
                                <button type="button" style={{ ...buttonStyle, background: '#334155', color: 'white' }} onClick={() => setEditingId(null)}>Cancel</button>
                              </div>
                            </div>
                          ) : (
                            <>
                              <h3 style={{ margin: '0 0 0.35rem' }}>{item.title}</h3>
                              <p style={{ margin: '0 0 0.5rem', color: '#cbd5e1', lineHeight: 1.5 }}>{item.description}</p>
                            </>
                          )}
                          <p style={{ margin: '0', color: '#94a3b8', fontSize: '0.92rem' }}>{item.location}</p>
                          <p style={{ margin: '0.15rem 0 0', color: '#64748b', fontSize: '0.85rem' }}>Photo by {item.owner}</p>
                          {editingId !== item.id ? (
                            <div style={{ display: 'flex', gap: '0.5rem', marginTop: '0.6rem', flexWrap: 'wrap' }}>
                              <button type="button" style={smallButtonStyle} onClick={() => downloadFile(item.url, item.filename)}>
                                Download
                              </button>
                              {effectiveRole === 'admin' ? (
                                <>
                                  <button type="button" style={smallButtonStyle} onClick={() => startEdit(item)}>Edit</button>
                                  <button type="button" style={smallButtonStyle} onClick={() => toggleHidden(item)}>
                                    {item.hidden ? 'Unhide' : 'Hide from guests'}
                                  </button>
                                </>
                              ) : null}
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
            {sortedItems.length > 0 && filteredItems.length === 0 ? (
              <p style={{ color: '#94a3b8' }}>
                No photos match{searchQuery ? ` "${searchQuery}"` : ''}
                {photographerFilter ? ` by ${photographerFilter}` : ''}
                {peopleFilter ? ` featuring ${peopleFilter}` : ''}.
              </p>
            ) : null}
          </div>
        )}
      </div>

      {menuOpen ? <div style={backdropStyle} onClick={() => setMenuOpen(false)} /> : null}
      <nav style={{ ...sideMenuStyle, transform: menuOpen ? 'translateX(0)' : 'translateX(-100%)' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem' }}>
          <h2 style={{ margin: 0, fontSize: '1.1rem' }}>Jump to date</h2>
          <button type="button" style={smallButtonStyle} onClick={() => setMenuOpen(false)} aria-label="Close">
            &times;
          </button>
        </div>
        <div style={{ display: 'grid', gap: '0.4rem' }}>
          {dayGroups.map((group) => (
            <button
              key={group.key}
              type="button"
              onClick={() => scrollToDay(group.key)}
              style={dayMenuItemStyle}
            >
              {group.label}
              <span style={{ color: '#64748b', fontWeight: 400 }}> ({group.items.length})</span>
            </button>
          ))}
        </div>
      </nav>

      {selectMode && selectedIds.size > 0 ? (
        <button type="button" style={floatingButtonStyle} onClick={downloadSelected} disabled={downloading}>
          {downloading ? 'Zipping...' : `Download ${selectedIds.size} selected`}
        </button>
      ) : null}

      {lightboxIndex !== null ? (
        <Lightbox
          items={filteredItems}
          index={lightboxIndex}
          role={effectiveRole}
          onClose={() => setLightboxIndex(null)}
          onNavigate={setLightboxIndex}
          onUpdate={updateItem}
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

const chipStyle: CSSProperties = {
  padding: '0.4rem 0.85rem',
  borderRadius: 999,
  border: '1px solid #334155',
  background: 'rgba(15, 23, 42, 0.9)',
  color: '#cbd5e1',
  cursor: 'pointer',
  fontSize: '0.85rem',
};

const chipStyleActive: CSSProperties = {
  ...chipStyle,
  background: '#38bdf8',
  borderColor: '#38bdf8',
  color: '#07111f',
  fontWeight: 700,
};

const linkStyle: CSSProperties = {
  color: '#7dd3fc',
  textDecoration: 'none',
  fontWeight: 600,
};

const backdropStyle: CSSProperties = {
  position: 'fixed',
  inset: 0,
  background: 'rgba(2, 6, 23, 0.6)',
  zIndex: 1099,
};

const sideMenuStyle: CSSProperties = {
  position: 'fixed',
  top: 0,
  left: 0,
  bottom: 0,
  width: 280,
  maxWidth: '85vw',
  background: '#0f172a',
  borderRight: '1px solid #334155',
  padding: '1.25rem',
  overflowY: 'auto',
  zIndex: 1100,
  transition: 'transform 0.25s ease',
};

const dayMenuItemStyle: CSSProperties = {
  textAlign: 'left',
  padding: '0.6rem 0.7rem',
  borderRadius: 8,
  border: '1px solid transparent',
  background: 'transparent',
  color: '#e2e8f0',
  cursor: 'pointer',
  fontSize: '0.92rem',
};

const floatingButtonStyle: CSSProperties = {
  position: 'fixed',
  bottom: '1.5rem',
  right: '1.5rem',
  padding: '0.9rem 1.3rem',
  borderRadius: 999,
  border: 'none',
  background: '#38bdf8',
  color: '#07111f',
  cursor: 'pointer',
  fontWeight: 700,
  boxShadow: '0 8px 24px rgba(0,0,0,0.4)',
  zIndex: 900,
};
