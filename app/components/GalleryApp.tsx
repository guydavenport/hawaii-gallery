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
  filename: string;
  owner: string;
}

export default function GalleryApp() {
  const [items, setItems] = useState<MediaItem[]>([]);
  const [title, setTitle] = useState('');
  const [location, setLocation] = useState('Waikiki');
  const [type, setType] = useState<'photo' | 'video'>('photo');
  const [owner, setOwner] = useState('guest');
  const [file, setFile] = useState<File | null>(null);
  const [status, setStatus] = useState('Ready to upload');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [isLoggedIn, setIsLoggedIn] = useState(false);

  useEffect(() => {
    fetch('/api/media')
      .then((res) => res.json())
      .then((data) => setItems(Array.isArray(data) ? data : []))
      .catch(() => setItems([]));
  }, []);

  async function handleLogin(event: FormEvent) {
    event.preventDefault();
    setStatus('Signing in with demo auth...');
    const response = await fetch('/api/auth', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password }),
    });
    if (response.ok) {
      setIsLoggedIn(true);
      setStatus('Signed in. You can upload media to your gallery.');
    } else {
      setStatus('Login failed');
    }
  }

  async function handleUpload(event: FormEvent) {
    event.preventDefault();
    if (!file) {
      setStatus('Please select a file first.');
      return;
    }

    setStatus('Uploading and generating metadata...');
    const formData = new FormData();
    formData.append('title', title || file.name);
    formData.append('location', location);
    formData.append('type', type);
    formData.append('owner', owner);
    formData.append('file', file);

    const response = await fetch('/api/media', {
      method: 'POST',
      body: formData,
    });

    if (response.ok) {
      const newItem = await response.json();
      setItems((prev) => [newItem, ...prev]);
      setStatus(`Uploaded ${newItem.title}`);
      setTitle('');
      setFile(null);
    } else {
      const error = await response.json().catch(() => ({}));
      setStatus(error.error || 'Upload failed');
    }
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
          <form onSubmit={handleLogin} style={{ display: 'grid', gap: '0.75rem', maxWidth: 480 }}>
            <input value={email} onChange={(event) => setEmail(event.target.value)} placeholder="Email" style={inputStyle} />
            <input value={password} onChange={(event) => setPassword(event.target.value)} placeholder="Password" type="password" style={inputStyle} />
            <button type="submit" style={buttonStyle}>Demo sign in</button>
          </form>
          {isLoggedIn ? <p style={{ color: '#86efac' }}>Signed in. Uploads are enabled.</p> : <p style={{ color: '#cbd5e1' }}>This is a demo auth flow. Replace it with Cognito in production.</p>}
        </section>

        <section style={{ background: 'rgba(15, 23, 42, 0.9)', border: '1px solid #334155', borderRadius: 20, padding: '1.2rem' }}>
          <h2 style={{ marginTop: 0 }}>Upload a new memory</h2>
          <form onSubmit={handleUpload} style={{ display: 'grid', gap: '0.75rem', maxWidth: 640 }}>
            <input value={title} onChange={(event) => setTitle(event.target.value)} placeholder="Title" style={inputStyle} />
            <input value={location} onChange={(event) => setLocation(event.target.value)} placeholder="Location" style={inputStyle} />
            <select value={type} onChange={(event) => setType(event.target.value as 'photo' | 'video')} style={inputStyle}>
              <option value="photo">Photo</option>
              <option value="video">Video</option>
            </select>
            <input value={owner} onChange={(event) => setOwner(event.target.value)} placeholder="Owner" style={inputStyle} />
            <input type="file" accept="image/*,video/*" onChange={(event) => setFile(event.target.files?.[0] || null)} style={{ color: 'white' }} />
            <button type="submit" style={buttonStyle} disabled={!isLoggedIn}>Upload to gallery</button>
          </form>
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
