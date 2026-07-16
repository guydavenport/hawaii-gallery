'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import type { CSSProperties } from 'react';
import Link from 'next/link';
import 'leaflet/dist/leaflet.css';
import type { MediaItem } from '@/app/lib/types';
import Lightbox from '@/app/components/Lightbox';
import { PAGE_BACKGROUND } from '@/app/lib/theme';

interface LocationGroup {
  location: string;
  latitude: number;
  longitude: number;
  items: MediaItem[];
}

export default function MapApp() {
  const mapContainerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<import('leaflet').Map | null>(null);
  const [items, setItems] = useState<MediaItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [authenticated, setAuthenticated] = useState<boolean | null>(null);
  const [lightboxItems, setLightboxItems] = useState<MediaItem[] | null>(null);
  const [lightboxIndex, setLightboxIndex] = useState(0);

  useEffect(() => {
    fetch('/api/auth')
      .then((res) => res.json())
      .then((data) => {
        setAuthenticated(Boolean(data.authenticated));
        if (!data.authenticated) {
          setLoading(false);
          return;
        }
        return fetch('/api/media')
          .then((res) => (res.ok ? res.json() : []))
          .then((data) => setItems(Array.isArray(data) ? data : []))
          .finally(() => setLoading(false));
      });
  }, []);

  const groups = useMemo<LocationGroup[]>(() => {
    const byLocation = new Map<string, MediaItem[]>();
    for (const item of items) {
      if (item.latitude == null || item.longitude == null) continue;
      const key = item.location || 'Unknown';
      if (!byLocation.has(key)) byLocation.set(key, []);
      byLocation.get(key)!.push(item);
    }
    return Array.from(byLocation.entries()).map(([location, groupItems]) => {
      const latitude = groupItems.reduce((sum, i) => sum + (i.latitude || 0), 0) / groupItems.length;
      const longitude = groupItems.reduce((sum, i) => sum + (i.longitude || 0), 0) / groupItems.length;
      return { location, latitude, longitude, items: groupItems };
    });
  }, [items]);

  useEffect(() => {
    if (loading || !mapContainerRef.current || groups.length === 0) return;

    let cancelled = false;

    import('leaflet').then((L) => {
      if (cancelled || !mapContainerRef.current) return;

      if (!mapRef.current) {
        mapRef.current = L.map(mapContainerRef.current);
        L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
          attribution: '&copy; OpenStreetMap contributors',
          maxZoom: 19,
        }).addTo(mapRef.current);
      }

      const map = mapRef.current;
      const bounds = L.latLngBounds(groups.map((g) => [g.latitude, g.longitude]));

      for (const group of groups) {
        const radius = 10 + Math.sqrt(group.items.length) * 6;
        const marker = L.circleMarker([group.latitude, group.longitude], {
          radius,
          color: '#38bdf8',
          fillColor: '#38bdf8',
          fillOpacity: 0.55,
          weight: 2,
        }).addTo(map);

        const thumbs = group.items
          .slice(0, 6)
          .map(
            (item, i) =>
              `<img data-idx="${i}" src="${item.url}" style="width:56px;height:56px;object-fit:cover;border-radius:6px;cursor:pointer;margin:2px" />`
          )
          .join('');

        const popupEl = document.createElement('div');
        popupEl.style.color = '#0f172a';
        popupEl.innerHTML = `
          <div style="font-weight:700;margin-bottom:4px;">${group.location}</div>
          <div style="margin-bottom:6px;color:#475569;">${group.items.length} item${group.items.length === 1 ? '' : 's'}</div>
          <div style="display:flex;flex-wrap:wrap;max-width:200px;">${thumbs}</div>
        `;
        popupEl.querySelectorAll<HTMLImageElement>('img[data-idx]').forEach((img) => {
          img.addEventListener('click', () => {
            const idx = Number(img.dataset.idx);
            setLightboxItems(group.items);
            setLightboxIndex(idx);
          });
        });

        marker.bindPopup(popupEl);
      }

      map.fitBounds(bounds, { padding: [40, 40] });
    });

    return () => {
      cancelled = true;
    };
  }, [loading, groups]);

  useEffect(() => {
    return () => {
      mapRef.current?.remove();
      mapRef.current = null;
    };
  }, []);

  return (
    <div style={{ minHeight: '100vh', background: PAGE_BACKGROUND, backgroundAttachment: 'fixed', color: 'white' }}>
      <header style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '1.25rem 1.5rem', gap: '1rem', flexWrap: 'wrap' }}>
        <div>
          <p style={{ margin: 0, textTransform: 'uppercase', letterSpacing: '0.3em', color: '#7dd3fc' }}>Hawaii trip gallery</p>
          <h1 style={{ margin: '0.35rem 0 0', fontSize: '1.5rem' }}>Map</h1>
        </div>
        <Link href="/" style={linkStyle}>Back to gallery</Link>
      </header>

      {loading ? (
        <p style={{ padding: '1.5rem' }}>Loading map...</p>
      ) : !authenticated ? (
        <p style={{ padding: '1.5rem', color: '#94a3b8' }}>
          Please <Link href="/" style={linkStyle}>sign in</Link> to view the map.
        </p>
      ) : groups.length === 0 ? (
        <p style={{ padding: '1.5rem', color: '#94a3b8' }}>No photos with location data yet.</p>
      ) : (
        <div ref={mapContainerRef} style={{ height: 'calc(100vh - 90px)', width: '100%' }} />
      )}

      {lightboxItems ? (
        <Lightbox
          items={lightboxItems}
          index={lightboxIndex}
          onClose={() => setLightboxItems(null)}
          onNavigate={setLightboxIndex}
        />
      ) : null}
    </div>
  );
}

const linkStyle: CSSProperties = {
  color: '#7dd3fc',
  textDecoration: 'none',
  fontWeight: 600,
};
