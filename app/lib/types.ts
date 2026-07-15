export interface MediaItem {
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
  hidden?: boolean;
}
