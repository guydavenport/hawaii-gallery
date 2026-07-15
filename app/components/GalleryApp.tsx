'use client';

import { useEffect, useMemo, useState } from 'react';
import type { CSSProperties, FormEvent } from 'react';

interface MediaItem {
  id: string;
  title: string;
  description: string;
  type: 'photo' | 'video';
  location: string;
  latitude?: number;
  longitude?: number;
  createdAt: string;
  url: string;
  key: string;
  filename: string;
  owner: string;
}

interface SyncAddCandidate {
  key: string;
  filename: string;
  size: number;
  lastModified?: string;
  suggestedTitle: string;
  suggestedType: 'photo' | 'video';
}

interface SyncRemoveCandidate {
  id: string;
  key: string;
  title: string;
}

export default function GalleryApp() {
  const [items, setItems] = useState<MediaItem[]>([]);
  const [title, setTitle] = useState('');
  const [location, setLocation] = useState('Waikiki');
  const [type, setType] = useState<'photo' | 'video'>('photo');
  const [owner, setOwner] = useState('guest');
  const [files, setFiles] = useState<File[]>([]);
  const [status, setStatus] = useState('Ready to upload');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [isLoggedIn, setIsLoggedIn] = useState(false);

  const [syncPreview, setSyncPreview] = useState<{ toAdd: SyncAddCandidate[]; toRemove: SyncRemoveCandidate[] } | null>(null);
  const [selectedAddKeys, setSelectedAddKeys] = useState<Set<string>>(new Set());
  const [selectedRemoveIds, setSelectedRemoveIds] = useState<Set<string>>(new Set());
  const [syncing, setSyncing] = useState(false);

  async function loadItems() {
    try {
      const res = await fetch('/api/media');
      if (!res.ok) {
        setIsLoggedIn(false);
        setItems([]);
        return;
      }
      const data = await res.json();
      setIsLoggedIn(true);
      setItems(Array.isArray(data) ? data : []);
    } catch {
      setItems([]);
    }
  }

  useEffect(() => {
    loadItems();
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
      setIsLoggedIn(true);
      setPassword('');
      setStatus('Signed in. You can upload media to your gallery.');
      loadItems();
    } else {
      const error = await response.json().catch(() => ({}));
      setStatus(error.error || 'Login failed');
    }
  }

  async function handleLogout() {
    await fetch('/api/auth', { method: 'DELETE' });
    setIsLoggedIn(false);
    setItems([]);
    setStatus('Signed out.');
  }

  async function handleUpload(event: FormEvent) {
    event.preventDefault();
    if (files.length === 0) {
      setStatus('Please select one or more files first.');
      return;
    }

    setStatus(`Requesting upload URLs for ${files.length} file(s)...`);

    const presignResponse = await fetch('/api/media/presign', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        files: files.map((file) => ({ filename: file.name, contentType: file.type })),
      }),
    });

    if (!presignResponse.ok) {
      setStatus('Failed to get upload URLs');
      return;
    }

    const { files: presigned } = (await presignResponse.json()) as {
      files: { id: string; filename: string; key: string; uploadUrl: string }[];
    };

    setStatus(`Uploading ${files.length} file(s) to S3...`);

    try {
      await Promise.all(
        presigned.map((entry, index) =>
          fetch(entry.uploadUrl, {
            method: 'PUT',
            headers: { 'Content-Type': files[index].type || 'application/octet-stream' },
            body: files[index],
          }).then((res) => {
            if (!res.ok) throw new Error(`Upload failed for ${entry.filename}`);
          })
        )
      );
    } catch (error) {
      setStatus(error instanceof Error ? error.message : 'Upload failed');
      return;
    }

    setStatus('Saving metadata...');

    const registerResponse = await fetch('/api/media', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        items: presigned.map((entry) => ({
          key: entry.key,
          filename: entry.filename,
          title: files.length === 1 ? title || entry.filename : entry.filename.replace(/\.[^.]+$/, ''),
          location,
          type,
          owner,
        })),
      }),
    });

    if (registerResponse.ok) {
      const newItems: MediaItem[] = await registerResponse.json();
      setItems((prev) => [...newItems, ...prev]);
      setStatus(`Uploaded ${newItems.length} item(s)`);
      setTitle('');
      setFiles([]);
    } else {
      const error = await registerResponse.json().catch(() => ({}));
      setStatus(error.error || 'Failed to save metadata');
    }
  }

  async function handleCheckSync() {
    setSyncing(true);
    setStatus('Scanning S3 bucket for changes...');
    try {
      const response = await fetch('/api/media/sync');
      const data = await response.json();
      setSyncPreview(data);
      setSelectedAddKeys(new Set(data.toAdd.map((item: SyncAddCandidate) => item.key)));
      setSelectedRemoveIds(new Set(data.toRemove.map((item: SyncRemoveCandidate) => item.id)));
      setStatus(`Found ${data.toAdd.length} new file(s) and ${data.toRemove.length} missing item(s)`);
    } catch {
      setStatus('Failed to scan S3 bucket');
    } finally {
      setSyncing(false);
    }
  }

  async function handleApplySync() {
    if (!syncPreview) return;
    setSyncing(true);
    setStatus('Applying sync...');

    const add = syncPreview.toAdd
      .filter((candidate) => selectedAddKeys.has(candidate.key))
      .map((candidate) => ({
        key: candidate.key,
        filename: candidate.filename,
        title: candidate.suggestedTitle,
        type: candidate.suggestedType,
        location,
        owner,
      }));

    const removeIds = Array.from(selectedRemoveIds);

    const response = await fetch('/api/media/sync', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ add, removeIds }),
    });

    if (response.ok) {
      const result = await response.json();
      setStatus(`Sync applied: +${result.added} / -${result.removed}`);
      setSyncPreview(null);
      loadItems();
    } else {
      setStatus('Failed to apply sync');
    }
    setSyncing(false);
  }

  function toggleAddKey(key: string) {
    setSelectedAddKeys((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }

  function toggleRemoveId(id: string) {
    setSelectedRemoveIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  const featured = useMemo(() => items[0], [items]);

  return (
    <div style={{ minHeight: '100vh', background: 'linear-gradient(135deg, #07111f 0%, #14233d 100%)', color: 'white', padding: '2rem 1.25rem' }}>
      <div style={{ maxWidth: 1100, margin: '0 auto', display: 'grid', gap: '1.5rem' }}>
        <header style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '1rem', flexWrap: 'wrap' }}>
          <div>
            <p style={{ margin: 0, textTransform: 'uppercase', letterSpacing: '0.3em', color: '#7dd3fc' }}>Hawaii trip gallery</p>
            <h1 style={{ margin: '0.35rem 0 0', fontSize: '2rem' }}>Private gallery for photos and videos</h1>
          </div>
          <div style={{ color: '#cbd5e1', fontSize: '0.95rem' }}>{status}</div>
        </header>

        <section style={{ background: 'rgba(15, 23, 42, 0.9)', border: '1px solid #334155', borderRadius: 20, padding: '1.2rem' }}>
          <h2 style={{ marginTop: 0 }}>Sign in</h2>
          {isLoggedIn ? (
            <div style={{ display: 'flex', alignItems: 'center', gap: '1rem' }}>
              <p style={{ color: '#86efac', margin: 0 }}>Signed in. Uploads are enabled.</p>
              <button type="button" style={{ ...buttonStyle, background: '#334155', color: 'white' }} onClick={handleLogout}>
                Sign out
              </button>
            </div>
          ) : (
            <form onSubmit={handleLogin} style={{ display: 'grid', gap: '0.75rem', maxWidth: 480 }}>
              <input value={email} onChange={(event) => setEmail(event.target.value)} placeholder="Email" style={inputStyle} />
              <input value={password} onChange={(event) => setPassword(event.target.value)} placeholder="Password" type="password" style={inputStyle} />
              <button type="submit" style={buttonStyle}>Sign in</button>
            </form>
          )}
        </section>

        <section style={{ background: 'rgba(15, 23, 42, 0.9)', border: '1px solid #334155', borderRadius: 20, padding: '1.2rem' }}>
          <h2 style={{ marginTop: 0 }}>Upload new memories</h2>
          <form onSubmit={handleUpload} style={{ display: 'grid', gap: '0.75rem', maxWidth: 640 }}>
            <input
              value={title}
              onChange={(event) => setTitle(event.target.value)}
              placeholder="Title (used only when uploading a single file)"
              style={inputStyle}
            />
            <input value={location} onChange={(event) => setLocation(event.target.value)} placeholder="Location" style={inputStyle} />
            <select value={type} onChange={(event) => setType(event.target.value as 'photo' | 'video')} style={inputStyle}>
              <option value="photo">Photo</option>
              <option value="video">Video</option>
            </select>
            <input value={owner} onChange={(event) => setOwner(event.target.value)} placeholder="Owner" style={inputStyle} />
            <input
              type="file"
              accept="image/*,video/*"
              multiple
              onChange={(event) => setFiles(event.target.files ? Array.from(event.target.files) : [])}
              style={{ color: 'white' }}
            />
            {files.length > 0 ? (
              <p style={{ margin: 0, color: '#94a3b8', fontSize: '0.9rem' }}>{files.length} file(s) selected</p>
            ) : null}
            <button type="submit" style={buttonStyle} disabled={!isLoggedIn}>Upload to gallery</button>
          </form>
        </section>

        <section style={{ background: 'rgba(15, 23, 42, 0.9)', border: '1px solid #334155', borderRadius: 20, padding: '1.2rem' }}>
          <h2 style={{ marginTop: 0 }}>Sync with S3</h2>
          <p style={{ color: '#cbd5e1' }}>Reconcile the gallery with what's actually in the bucket — pick up files added outside the app and drop entries whose files were deleted.</p>
          <button type="button" style={buttonStyle} onClick={handleCheckSync} disabled={syncing}>
            {syncing ? 'Working...' : 'Check S3 for changes'}
          </button>

          {syncPreview ? (
            <div style={{ display: 'grid', gap: '1rem', marginTop: '1rem' }}>
              {syncPreview.toAdd.length > 0 ? (
                <div>
                  <h3 style={{ marginBottom: '0.5rem' }}>New in S3 ({syncPreview.toAdd.length})</h3>
                  <div style={{ display: 'grid', gap: '0.4rem' }}>
                    {syncPreview.toAdd.map((candidate) => (
                      <label key={candidate.key} style={{ display: 'flex', gap: '0.6rem', alignItems: 'center', color: '#cbd5e1' }}>
                        <input
                          type="checkbox"
                          checked={selectedAddKeys.has(candidate.key)}
                          onChange={() => toggleAddKey(candidate.key)}
                        />
                        {candidate.suggestedTitle} <span style={{ color: '#64748b' }}>({candidate.suggestedType}, {Math.round(candidate.size / 1024)} KB)</span>
                      </label>
                    ))}
                  </div>
                </div>
              ) : null}

              {syncPreview.toRemove.length > 0 ? (
                <div>
                  <h3 style={{ marginBottom: '0.5rem' }}>Missing from S3 ({syncPreview.toRemove.length})</h3>
                  <div style={{ display: 'grid', gap: '0.4rem' }}>
                    {syncPreview.toRemove.map((candidate) => (
                      <label key={candidate.id} style={{ display: 'flex', gap: '0.6rem', alignItems: 'center', color: '#fca5a5' }}>
                        <input
                          type="checkbox"
                          checked={selectedRemoveIds.has(candidate.id)}
                          onChange={() => toggleRemoveId(candidate.id)}
                        />
                        {candidate.title}
                      </label>
                    ))}
                  </div>
                </div>
              ) : null}

              {syncPreview.toAdd.length === 0 && syncPreview.toRemove.length === 0 ? (
                <p style={{ color: '#86efac' }}>Gallery is already in sync with S3.</p>
              ) : (
                <button type="button" style={buttonStyle} onClick={handleApplySync} disabled={syncing || !isLoggedIn}>
                  Apply sync
                </button>
              )}
            </div>
          ) : null}
        </section>

        {featured ? (
          <section style={{ display: 'grid', gap: '1rem', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))' }}>
            <div style={{ background: 'rgba(15, 23, 42, 0.9)', border: '1px solid #334155', borderRadius: 20, padding: '1rem' }}>
              <p style={{ textTransform: 'uppercase', letterSpacing: '0.2em', color: '#7dd3fc', marginTop: 0 }}>Latest memory</p>
              <h3 style={{ marginTop: 0 }}>{featured.title}</h3>
              <p style={{ color: '#cbd5e1', lineHeight: 1.6 }}>{featured.description}</p>
              <p style={{ color: '#94a3b8' }}>Location: {featured.location}</p>
              <p style={{ color: '#94a3b8' }}>Type: {featured.type}</p>
            </div>
            <div style={{ background: 'rgba(15, 23, 42, 0.9)', border: '1px solid #334155', borderRadius: 20, padding: '1rem' }}>
              {featured.type === 'video' ? (
                <video controls src={featured.url} style={{ width: '100%', borderRadius: 12 }} />
              ) : (
                <img src={featured.url} alt={featured.title} style={{ width: '100%', borderRadius: 12, objectFit: 'cover', maxHeight: 320 }} />
              )}
            </div>
          </section>
        ) : null}

        <section style={{ display: 'grid', gap: '1rem', gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))' }}>
          {items.map((item) => (
            <article key={item.id} style={{ background: 'rgba(15, 23, 42, 0.9)', border: '1px solid #334155', borderRadius: 20, overflow: 'hidden' }}>
              {item.type === 'video' ? (
                <video controls src={item.url} style={{ width: '100%', height: 180, objectFit: 'cover', background: '#020617' }} />
              ) : (
                <img src={item.url} alt={item.title} style={{ width: '100%', height: 180, objectFit: 'cover' }} />
              )}
              <div style={{ padding: '0.9rem' }}>
                <h3 style={{ margin: '0 0 0.35rem' }}>{item.title}</h3>
                <p style={{ margin: '0 0 0.5rem', color: '#cbd5e1', lineHeight: 1.5 }}>{item.description}</p>
                <p style={{ margin: '0', color: '#94a3b8', fontSize: '0.92rem' }}>{item.location}</p>
              </div>
            </article>
          ))}
        </section>
      </div>
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
