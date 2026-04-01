import { openDB, IDBPDatabase } from 'idb';

const DB_NAME = 'sonecando_offline_db';
const DB_VERSION = 2;

export interface OfflineDestination {
  id: string;
  name: string;
  lat: number;
  lng: number;
  timestamp: number;
  updatedAt: number;
  count: number;
  hours?: number[];
  syncStatus?: 'synced' | 'pending';
}

export interface SavedRoute {
  id: string;
  name: string;
  destinations: { lat: number; lng: number; name: string }[];
  createdAt: string;
  updatedAt: number;
  syncStatus?: 'synced' | 'pending';
}

export interface PendingSync {
  id: number;
  action: 'add' | 'update' | 'delete';
  collection: 'history' | 'routes';
  data: any;
  timestamp: number;
}

let dbPromise: Promise<IDBPDatabase> | null = null;

const getDB = () => {
  if (!dbPromise) {
    dbPromise = openDB(DB_NAME, DB_VERSION, {
      upgrade(db, oldVersion) {
        if (!db.objectStoreNames.contains('destinations')) {
          db.createObjectStore('destinations', { keyPath: 'id' });
        }
        if (!db.objectStoreNames.contains('pending_sync')) {
          db.createObjectStore('pending_sync', { keyPath: 'id', autoIncrement: true });
        }
        if (oldVersion < 2) {
          if (!db.objectStoreNames.contains('routes')) {
            db.createObjectStore('routes', { keyPath: 'id' });
          }
        }
      },
    });
  }
  return dbPromise;
};

export const saveDestinationOffline = async (dest: OfflineDestination) => {
  const db = await getDB();
  await db.put('destinations', dest);
};

export const getDestinationsOffline = async (): Promise<OfflineDestination[]> => {
  const db = await getDB();
  return db.getAll('destinations');
};

export const deleteDestinationOffline = async (id: string) => {
  const db = await getDB();
  await db.delete('destinations', id);
};

export const clearDestinationsOffline = async () => {
  const db = await getDB();
  await db.clear('destinations');
};

export const getPendingSyncs = async () => {
  const db = await getDB();
  return db.getAll('pending_sync');
};

export const removePendingSync = async (id: number) => {
  const db = await getDB();
  await db.delete('pending_sync', id);
};

export const saveRouteOffline = async (route: SavedRoute) => {
  const db = await getDB();
  await db.put('routes', route);
};

export const getRoutesOffline = async (): Promise<SavedRoute[]> => {
  const db = await getDB();
  return db.getAll('routes');
};

export const deleteRouteOffline = async (id: string) => {
  const db = await getDB();
  await db.delete('routes', id);
};

export const clearRoutesOffline = async () => {
  const db = await getDB();
  await db.clear('routes');
};

export const addPendingSync = async (action: 'add' | 'update' | 'delete', data: any, collection: 'history' | 'routes' = 'history') => {
  const db = await getDB();
  const syncData = { ...data };
  if (action !== 'delete' && !syncData.updatedAt) {
    syncData.updatedAt = Date.now();
  }
  await db.add('pending_sync', { action, data: syncData, collection, timestamp: Date.now() });
};
