import AsyncStorage from '@react-native-async-storage/async-storage';
import * as FileSystem from 'expo-file-system/legacy';
import * as Crypto from 'expo-crypto';
import type { Photo } from '../shared/types';
import { MAX_PHOTO, type StorageAdapter } from './history';
const folder = (key: string) => `${FileSystem.documentDirectory}history/${encodeURIComponent(key)}/`;
const pendingPhotos = new Set<string>();
export const imageUri = (key: string, photo: Photo) => folder(key) + photo.path;
export const nativeStorage: StorageAdapter = {
  read: key => AsyncStorage.getItem(key),
  write: (key, value) => AsyncStorage.setItem(key, value),
  async collect(key, retained) {
    const dir = folder(key), info = await FileSystem.getInfoAsync(dir);
    if (!info.exists) return;
    for (const file of await FileSystem.readDirectoryAsync(dir)) {
      if (retained.includes(file)) pendingPhotos.delete(dir + file);
      else if (/^[a-f\d-]+\.jpg$/i.test(file) && !pendingPhotos.has(dir + file)) await FileSystem.deleteAsync(dir + file, { idempotent: true });
    }
  },
};
export async function savePhoto(key: string, uri: string, capturedAt: string, valid: () => boolean): Promise<Photo | undefined> {
  const info = await FileSystem.getInfoAsync(uri);
  if (!valid() || !info.exists || info.isDirectory || info.size > MAX_PHOTO) return;
  await FileSystem.makeDirectoryAsync(folder(key), { intermediates: true });
  const photo = { path: `${Crypto.randomUUID()}.jpg`, bytes: info.size, capturedAt };
  pendingPhotos.add(imageUri(key, photo));
  try { await FileSystem.copyAsync({ from: uri, to: imageUri(key, photo) }); }
  catch (error) { await discardPhoto(key, photo).catch(() => {}); throw error; }
  if (!valid()) { pendingPhotos.delete(imageUri(key, photo)); await FileSystem.deleteAsync(imageUri(key, photo), { idempotent: true }); return; }
  return photo;
}
export async function discardPhoto(key: string, photo?: Photo) { if (photo) { pendingPhotos.delete(imageUri(key, photo)); await FileSystem.deleteAsync(imageUri(key, photo), { idempotent: true }); } }
