import React, { useState, useEffect, useCallback, useRef } from 'react';
import { GoogleGenAI } from "@google/genai";
import { MapPin, Bell, Navigation, Settings, AlertCircle, Volume2, VolumeX, Search, History, Trash2, Share2, Check, Play, LogOut, User as UserIcon, Loader2, Bookmark, X, Bike, Footprints, Car, Edit2 } from 'lucide-react';
import Map from './components/Map';
import { calculateDistance } from './utils/distance';
import { motion, AnimatePresence } from 'motion/react';
import { auth, db } from './firebase';
import { onAuthStateChanged, User } from 'firebase/auth';
import { collection, query, onSnapshot, doc, setDoc, deleteDoc, getDocs, orderBy, writeBatch, getDoc } from 'firebase/firestore';
import Auth, { LogoutButton } from './components/Auth';
import { 
  saveDestinationOffline, 
  getDestinationsOffline, 
  deleteDestinationOffline, 
  clearDestinationsOffline,
  addPendingSync,
  getPendingSyncs,
  removePendingSync,
  saveRouteOffline,
  getRoutesOffline,
  deleteRouteOffline,
  clearRoutesOffline,
  SavedRoute
} from './lib/offlineDb';

interface RecentDestination {
  id: string;
  name: string;
  lat: number;
  lng: number;
  timestamp: number;
  updatedAt: number;
  count: number;
  hours?: number[]; // Track hours of the day this destination is visited
}

export default function App() {
  const [user, setUser] = useState<User | null>(null);
  const [isAuthReady, setIsAuthReady] = useState(false);
  const [currentLocation, setCurrentLocation] = useState<[number, number] | null>(null);
  const [currentAddress, setCurrentAddress] = useState<string>('');
  const [destinations, setDestinations] = useState<[number, number][]>([]);
  const [destinationNames, setDestinationNames] = useState<string[]>([]);
  const [currentStopIndex, setCurrentStopIndex] = useState(0);
  const [radius, setRadius] = useState(500); // meters
  const [isAlarmActive, setIsAlarmActive] = useState(false);
  const [isAlarmTriggered, setIsAlarmTriggered] = useState(false);
  const [distanceToDest, setDistanceToDest] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState<any[]>([]);
  const [isSearching, setIsSearching] = useState(false);
  const [isMuted, setIsMuted] = useState(false);
  const [vibrationEnabled, setVibrationEnabled] = useState(true);
  const [selectedSound, setSelectedSound] = useState('classic');
  const [recentDestinations, setRecentDestinations] = useState<RecentDestination[]>([]);
  const [savedRoutes, setSavedRoutes] = useState<SavedRoute[]>([]);
  const [routeName, setRouteName] = useState('');
  const [isSavingRoute, setIsSavingRoute] = useState(false);
  const [editingRouteId, setEditingRouteId] = useState<string | null>(null);
  const [editingRouteName, setEditingRouteName] = useState('');
  const [showShareToast, setShowShareToast] = useState(false);
  const [trackingMode, setTrackingMode] = useState<'high' | 'balanced' | 'low' | 'eco'>('balanced');
  const [speed, setSpeed] = useState<number | null>(null);
  const [isPowerSaveMode, setIsPowerSaveMode] = useState(false);
  const [isOffline, setIsOffline] = useState(!navigator.onLine);
  const [routeInfo, setRouteInfo] = useState<{ totalDistance: number; totalTime: number } | null>(null);
  const [isSimulationMode, setIsSimulationMode] = useState(false);
  const [autoCenter, setAutoCenter] = useState(true);
  const [transportMode, setTransportMode] = useState<'car' | 'bus' | 'train'>('car');
  const [isSignalLost, setIsSignalLost] = useState(false);
  const [simulationCoords, setSimulationCoords] = useState<[number, number][]>([]);
  const [simulationIndex, setSimulationIndex] = useState(0);
  const [simulationSpeed, setSimulationSpeed] = useState(5); // multiplier
  const [notificationPermission, setNotificationPermission] = useState<NotificationPermission>('default');
  const [isInIframe, setIsInIframe] = useState(false);

  const audioRef = useRef<HTMLAudioElement | null>(null);
  const watchIdRef = useRef<number | null>(null);

  const ALARM_SOUNDS = {
    classic: 'https://assets.mixkit.co/active_storage/sfx/2869/2869-preview.mp3',
    digital: 'https://assets.mixkit.co/active_storage/sfx/995/995-preview.mp3',
    gentle: 'https://assets.mixkit.co/active_storage/sfx/2568/2568-preview.mp3'
  };

  // Load history and shared route on mount
  useEffect(() => {
    const unsubscribeAuth = onAuthStateChanged(auth, async (user) => {
      setUser(user);
      setIsAuthReady(true);
      
      if (user) {
        // Ensure user profile exists in Firestore
        const userRef = doc(db, 'users', user.uid);
        try {
          const userDoc = await getDoc(userRef);
          if (!userDoc.exists()) {
            await setDoc(userRef, {
              uid: user.uid,
              email: user.email,
              displayName: user.displayName,
              createdAt: new Date().toISOString(),
              settings: {
                radius: 500,
                transportMode: 'car',
                vibrationEnabled: true,
                selectedSound: 'classic',
                autoCenter: true,
                isMuted: false,
                trackingMode: 'balanced'
              }
            });
          }
        } catch (e) {
          console.error("Error ensuring user profile:", e);
        }
      }
    });

    // Load from IndexedDB on mount
    const loadOfflineData = async () => {
      const offlineHistory = await getDestinationsOffline();
      if (offlineHistory.length > 0) {
        setRecentDestinations(offlineHistory.sort((a, b) => b.timestamp - a.timestamp));
      }
      const offlineRoutes = await getRoutesOffline();
      if (offlineRoutes.length > 0) {
        setSavedRoutes(offlineRoutes.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()));
      }
    };
    loadOfflineData();

    // Check for shared route in URL
    const params = new URLSearchParams(window.location.search);
    const sharedRoute = params.get('route');
    if (sharedRoute) {
      try {
        const decoded = JSON.parse(atob(sharedRoute));
        if (Array.isArray(decoded.coords) && Array.isArray(decoded.names)) {
          setDestinations(decoded.coords);
          setDestinationNames(decoded.names);
          // Clear URL params after loading
          window.history.replaceState({}, document.title, window.location.pathname);
        }
      } catch (e) {
        console.error("Failed to parse shared route", e);
      }
    }

    audioRef.current = new Audio(ALARM_SOUNDS[selectedSound as keyof typeof ALARM_SOUNDS]);
    audioRef.current.loop = true;

    return () => unsubscribeAuth();
  }, []);

  // Sync history with Firestore if logged in
  useEffect(() => {
    if (!user) {
      // If not logged in, we still use IndexedDB as cache
      return;
    }

    const historyRef = collection(db, 'users', user.uid, 'history');
    const qHistory = query(historyRef, orderBy('timestamp', 'desc'));
    
    const unsubscribeHistory = onSnapshot(qHistory, async (snapshot) => {
      const history: RecentDestination[] = [];
      snapshot.forEach((doc) => {
        history.push(doc.data() as RecentDestination);
      });
      
      for (const dest of history) {
        await saveDestinationOffline({ ...dest, syncStatus: 'synced' });
      }
      
      setRecentDestinations(history);
    }, (err) => {
      console.error("Firestore history error:", err);
    });

    const routesRef = collection(db, 'users', user.uid, 'routes');
    const qRoutes = query(routesRef, orderBy('createdAt', 'desc'));

    const unsubscribeRoutes = onSnapshot(qRoutes, async (snapshot) => {
      const routes: SavedRoute[] = [];
      snapshot.forEach((doc) => {
        routes.push(doc.data() as SavedRoute);
      });

      for (const route of routes) {
        await saveRouteOffline({ ...route, syncStatus: 'synced' });
      }

      setSavedRoutes(routes);
    }, (err) => {
      console.error("Firestore routes error:", err);
    });

    return () => {
      unsubscribeHistory();
      unsubscribeRoutes();
    };
  }, [user]);

  // Sync pending changes when online
  useEffect(() => {
    const syncPendingChanges = async () => {
      if (!user || isOffline) return;

      const pendingSyncs = await getPendingSyncs();
      if (pendingSyncs.length === 0) return;

      console.log(`Syncing ${pendingSyncs.length} pending changes...`);
      
      for (const sync of pendingSyncs) {
        try {
          const col = sync.collection || 'history';
          const docRef = doc(db, 'users', user.uid, col, sync.data.id);
          
          if (sync.action === 'add' || sync.action === 'update') {
            // Conflict Resolution: Fetch server version first
            const serverDoc = await getDoc(docRef);
            
            if (serverDoc.exists()) {
              const serverData = serverDoc.data();
              const serverUpdatedAt = serverData.updatedAt || 0;
              const localUpdatedAt = sync.data.updatedAt || 0;

              if (serverUpdatedAt > localUpdatedAt) {
                console.log(`Conflict detected for ${sync.data.id}. Server version is newer. Updating local cache.`);
                // Server wins: Update local cache and state
                if (col === 'history') {
                  const updatedDest = { ...serverData, id: sync.data.id, syncStatus: 'synced' as const } as unknown as RecentDestination;
                  await saveDestinationOffline(updatedDest);
                  setRecentDestinations(prev => prev.map(d => d.id === updatedDest.id ? updatedDest : d));
                } else {
                  const updatedRoute = { ...serverData, id: sync.data.id, syncStatus: 'synced' as const } as unknown as SavedRoute;
                  await saveRouteOffline(updatedRoute);
                  setSavedRoutes(prev => prev.map(r => r.id === updatedRoute.id ? updatedRoute : r));
                }
                await removePendingSync(sync.id);
                continue; // Skip this sync action as server is already newer
              }
            }
            
            // Local wins or no server version: Push to Firestore
            const syncData = { ...sync.data, syncStatus: 'synced' as const };
            await setDoc(docRef, syncData);
            
            // Update local status to synced
            if (col === 'history') {
              await saveDestinationOffline(syncData as RecentDestination);
            } else {
              await saveRouteOffline(syncData as SavedRoute);
            }
          } else if (sync.action === 'delete') {
            await deleteDoc(docRef);
          }
          
          await removePendingSync(sync.id);
        } catch (e) {
          console.error("Failed to sync change", e);
          // Don't break the loop, try next one but maybe add a retry limit later
        }
      }
    };

    if (!isOffline && user) {
      syncPendingChanges();
    }
  }, [isOffline, user]);

  // Update audio source when sound changes
  useEffect(() => {
    if (audioRef.current) {
      const wasPlaying = !audioRef.current.paused;
      audioRef.current.src = ALARM_SOUNDS[selectedSound as keyof typeof ALARM_SOUNDS];
      if (wasPlaying) audioRef.current.play();
    }
  }, [selectedSound]);

  // Save history when it changes (only for local storage if not logged in)
  useEffect(() => {
    if (!user) {
      // We already save to IndexedDB in addToHistory, but this handles state changes
      // Actually, we'll rely on the explicit save calls in addToHistory
    }
  }, [recentDestinations, user]);

  const addToHistory = async (name: string, lat: number, lng: number) => {
    const currentHour = new Date().getHours();
    const id = Math.random().toString(36).substr(2, 9);
    
    let newDest: RecentDestination;
    const existingIdx = recentDestinations.findIndex(d => 
      Math.abs(d.lat - lat) < 0.0001 && Math.abs(d.lng - lng) < 0.0001
    );

    if (existingIdx !== -1) {
      const dest = recentDestinations[existingIdx];
      const hours = dest.hours || [];
      if (!hours.includes(currentHour)) {
        hours.push(currentHour);
      }
      newDest = {
        ...dest,
        count: (dest.count || 1) + 1,
        timestamp: Date.now(),
        updatedAt: Date.now(),
        hours
      };
    } else {
      newDest = {
        id,
        name: name || `Local marcado (${lat.toFixed(4)}, ${lng.toFixed(4)})`,
        lat,
        lng,
        timestamp: Date.now(),
        updatedAt: Date.now(),
        count: 1,
        hours: [currentHour]
      };
    }

    // Always save to IndexedDB first (Optimistic UI)
    const destWithStatus = { ...newDest, syncStatus: (user && !isOffline) ? 'synced' : 'pending' } as RecentDestination;
    await saveDestinationOffline(destWithStatus);
    setRecentDestinations(prev => {
      const filtered = prev.filter(d => d.id !== destWithStatus.id);
      return [destWithStatus, ...filtered].slice(0, 20);
    });

    if (user) {
      if (!isOffline) {
        try {
          await setDoc(doc(db, 'users', user.uid, 'history', destWithStatus.id), newDest);
        } catch (e) {
          console.error("Failed to save to Firestore, adding to pending sync", e);
          await addPendingSync('add', { ...newDest, syncStatus: 'pending' as const });
          // Update local status to pending if it was assumed synced
          await saveDestinationOffline({ ...newDest, syncStatus: 'pending' as const });
          setRecentDestinations(prev => prev.map(d => d.id === newDest.id ? { ...d, syncStatus: 'pending' as const } : d));
        }
      } else {
        await addPendingSync('add', { ...newDest, syncStatus: 'pending' as const });
      }
    }
  };

  const clearHistory = async () => {
    if (user) {
      if (!isOffline) {
        try {
          const historyRef = collection(db, 'users', user.uid, 'history');
          const snapshot = await getDocs(historyRef);
          const deletePromises = snapshot.docs.map(d => deleteDoc(doc(db, 'users', user.uid, 'history', d.id)));
          await Promise.all(deletePromises);
        } catch (e) {
          console.error("Failed to clear Firestore history", e);
        }
      } else {
        for (const dest of recentDestinations) {
          await addPendingSync('delete', { id: dest.id }, 'history');
        }
      }
    }
    
    await clearDestinationsOffline();
    setRecentDestinations([]);
    localStorage.removeItem('sonecando_history');
  };

  const saveCurrentRoute = async () => {
    if (destinations.length < 2 || !routeName.trim()) return;

    const id = Math.random().toString(36).substr(2, 9);
    const newRoute: SavedRoute = {
      id,
      name: routeName.trim(),
      destinations: destinations.map(d => ({ lat: d.lat, lng: d.lng, name: d.name })),
      createdAt: new Date().toISOString(),
      updatedAt: Date.now(),
      syncStatus: (user && !isOffline) ? 'synced' : 'pending'
    };

    // Optimistic UI
    await saveRouteOffline(newRoute);
    setSavedRoutes(prev => [newRoute, ...prev]);
    setRouteName('');
    setIsSavingRoute(false);

    if (user) {
      if (!isOffline) {
        try {
          await setDoc(doc(db, 'users', user.uid, 'routes', id), newRoute);
        } catch (e) {
          console.error("Failed to save route to Firestore", e);
          const pendingRoute = { ...newRoute, syncStatus: 'pending' as const };
          await addPendingSync('add', pendingRoute, 'routes');
          // Update local status to pending
          await saveRouteOffline(pendingRoute);
          setSavedRoutes(prev => prev.map(r => r.id === id ? pendingRoute : r));
        }
      } else {
        await addPendingSync('add', { ...newRoute, syncStatus: 'pending' as const }, 'routes');
      }
    }
  };

  const deleteRoute = async (id: string) => {
    // Optimistic UI
    await deleteRouteOffline(id);
    setSavedRoutes(prev => prev.filter(r => r.id !== id));

    if (user) {
      if (!isOffline) {
        try {
          await deleteDoc(doc(db, 'users', user.uid, 'routes', id));
        } catch (e) {
          console.error("Failed to delete route from Firestore", e);
          await addPendingSync('delete', { id }, 'routes');
        }
      } else {
        await addPendingSync('delete', { id }, 'routes');
      }
    }
  };

  const updateRouteName = async (id: string, newName: string) => {
    if (!newName.trim()) {
      setEditingRouteId(null);
      return;
    }

    const routeToUpdate = savedRoutes.find(r => r.id === id);
    if (!routeToUpdate) {
      setEditingRouteId(null);
      return;
    }

    if (routeToUpdate.name === newName) {
      setEditingRouteId(null);
      return;
    }

    const updatedRoute: SavedRoute = {
      ...routeToUpdate,
      name: newName,
      updatedAt: Date.now(),
      syncStatus: (user && !isOffline) ? 'synced' : 'pending'
    };

    // Optimistic UI
    await saveRouteOffline(updatedRoute);
    setSavedRoutes(prev => prev.map(r => r.id === id ? updatedRoute : r));
    setEditingRouteId(null);

    if (user) {
      if (!isOffline) {
        try {
          await setDoc(doc(db, 'users', user.uid, 'routes', id), updatedRoute);
        } catch (e) {
          console.error("Failed to update route in Firestore", e);
          const pendingRoute = { ...updatedRoute, syncStatus: 'pending' as const };
          await addPendingSync('update', pendingRoute, 'routes');
          await saveRouteOffline(pendingRoute);
          setSavedRoutes(prev => prev.map(r => r.id === id ? pendingRoute : r));
        }
      } else {
        await addPendingSync('update', { ...updatedRoute, syncStatus: 'pending' as const }, 'routes');
      }
    }
  };

  const loadRoute = (route: SavedRoute) => {
    setDestinations(route.destinations.map(d => ({
      ...d,
      id: Math.random().toString(36).substr(2, 9)
    })));
  };

  // Network status listeners
  useEffect(() => {
    const handleOnline = () => setIsOffline(false);
    const handleOffline = () => setIsOffline(true);
    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);
    return () => {
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
    };
  }, []);

  // Request notification permission
  useEffect(() => {
    setIsInIframe(window.self !== window.top);

    if ('Notification' in window) {
      setNotificationPermission(Notification.permission);
      if (Notification.permission === 'default') {
        Notification.requestPermission().then(setNotificationPermission);
      }
    }

    // Register Service Worker for better notifications
    if ('serviceWorker' in navigator) {
      navigator.serviceWorker.register('/sw.js')
        .then(reg => console.log('SW registered:', reg))
        .catch(err => console.error('SW registration failed:', err));
    }
  }, []);

  // Geolocation tracking
  useEffect(() => {
    if (!navigator.geolocation) {
      setError('Geolocalização não é suportada pelo seu navegador.');
      return;
    }

    if (watchIdRef.current !== null) {
      navigator.geolocation.clearWatch(watchIdRef.current);
    }

    const options: PositionOptions = {
      enableHighAccuracy: trackingMode === 'high' && !isPowerSaveMode,
      maximumAge: isPowerSaveMode ? 120000 : trackingMode === 'eco' ? 60000 : trackingMode === 'low' ? 30000 : trackingMode === 'balanced' ? 10000 : 2000,
      timeout: 20000
    };

    if (isSimulationMode) {
      setError(null);
      return; // Don't track real position in simulation mode
    }

    watchIdRef.current = navigator.geolocation.watchPosition(
      (position) => {
        const { latitude, longitude, speed: currentSpeed } = position.coords;
        setCurrentLocation([latitude, longitude]);
        setSpeed(currentSpeed);
        setError(null);
      },
      (err) => {
        if (err.code === 1) {
          setError('Permissão de localização negada. Por favor, habilite o GPS nas configurações do seu navegador para usar o rastreamento em tempo real.');
        } else {
          setError('Erro ao obter localização: ' + err.message);
        }
      },
      options
    );

    return () => {
      if (watchIdRef.current !== null) {
        navigator.geolocation.clearWatch(watchIdRef.current);
      }
    };
  }, [trackingMode, isSimulationMode, isPowerSaveMode]);

  // Simulation Logic
  useEffect(() => {
    let interval: NodeJS.Timeout;
    if (isSimulationMode && isAlarmActive && simulationCoords.length > 0 && !isAlarmTriggered) {
      interval = setInterval(() => {
        setSimulationIndex(prev => {
          const next = prev + 1;
          if (next < simulationCoords.length) {
            // Even if signal is lost, we move the "estimated" position in simulation
            setCurrentLocation(simulationCoords[next]);
            return next;
          } else {
            setIsSimulationMode(false);
            return prev;
          }
        });
      }, 4000 / simulationSpeed); // Base interval of 4s per step at 1x
    }
    return () => clearInterval(interval);
  }, [isSimulationMode, isAlarmActive, simulationCoords, simulationSpeed, isAlarmTriggered]);

  // Sync settings with Firestore
  useEffect(() => {
    if (!user || isOffline) return;

    const userRef = doc(db, 'users', user.uid);
    
    const unsubscribe = onSnapshot(userRef, (doc) => {
      if (doc.exists()) {
        const data = doc.data();
        if (data.settings) {
          const s = data.settings;
          // Only update if different to avoid loops
          setRadius(prev => s.radius !== undefined && s.radius !== prev ? s.radius : prev);
          setTransportMode(prev => s.transportMode !== undefined && s.transportMode !== prev ? s.transportMode : prev);
          setVibrationEnabled(prev => s.vibrationEnabled !== undefined && s.vibrationEnabled !== prev ? s.vibrationEnabled : prev);
          setSelectedSound(prev => s.selectedSound !== undefined && s.selectedSound !== prev ? s.selectedSound : prev);
          setAutoCenter(prev => s.autoCenter !== undefined && s.autoCenter !== prev ? s.autoCenter : prev);
          setIsMuted(prev => s.isMuted !== undefined && s.isMuted !== prev ? s.isMuted : prev);
          setTrackingMode(prev => s.trackingMode !== undefined && s.trackingMode !== prev ? s.trackingMode : prev);
        }
      }
    }, (err) => {
      console.error("Error syncing settings:", err);
    });

    return () => unsubscribe();
  }, [user, isOffline]);

  // Save settings when they change (debounced)
  useEffect(() => {
    if (!user || isOffline) return;

    const timer = setTimeout(async () => {
      try {
        const userRef = doc(db, 'users', user.uid);
        await setDoc(userRef, {
          settings: {
            radius,
            transportMode,
            vibrationEnabled,
            selectedSound,
            autoCenter,
            isMuted,
            trackingMode
          }
        }, { merge: true });
      } catch (e) {
        console.error("Error saving settings:", e);
      }
    }, 3000);

    return () => clearTimeout(timer);
  }, [user, radius, transportMode, vibrationEnabled, selectedSound, autoCenter, isMuted, trackingMode]);

  // Reverse geocode current location with debounce/throttle
  useEffect(() => {
    if (!currentLocation) return;
    
    const timer = setTimeout(async () => {
      // Only fetch if we don't have an address or if we've moved significantly (> 100m)
      // For simplicity, we just fetch once or when the user explicitly asks, 
      // but here we'll do it once per session or if address is empty
      if (!currentAddress) {
        const address = await reverseGeocode(currentLocation[0], currentLocation[1]);
        setCurrentAddress(address);
      }
    }, 1000); // Respect Nominatim 1 req/sec policy

    return () => clearTimeout(timer);
  }, [currentLocation, currentAddress]);

  const reverseGeocode = async (lat: number, lng: number): Promise<string> => {
    try {
      const response = await fetch(`https://nominatim.openstreetmap.org/reverse?format=json&lat=${lat}&lon=${lng}`);
      const data = await response.json();
      return data.display_name || `Local (${lat.toFixed(4)}, ${lng.toFixed(4)})`;
    } catch (e) {
      console.error("Reverse geocoding failed", e);
    }
    return `Local (${lat.toFixed(4)}, ${lng.toFixed(4)})`;
  };

  // Handle automatic alarm sound playback when triggered
  useEffect(() => {
    if (isAlarmTriggered && !isMuted && audioRef.current) {
      audioRef.current.play().catch(e => {
        console.error("Automatic alarm play failed", e);
        setError("Interação necessária para tocar o som do alarme.");
      });
    } else if (!isAlarmTriggered && audioRef.current) {
      audioRef.current.pause();
      audioRef.current.currentTime = 0;
    }
  }, [isAlarmTriggered, isMuted, selectedSound]);

  // Distance monitoring and tracking mode adjustment
  useEffect(() => {
    if (currentLocation && destinations.length > 0 && isAlarmActive && !isAlarmTriggered) {
      const target = destinations[currentStopIndex];
      if (!target) return;

      const dist = calculateDistance(
        currentLocation[0],
        currentLocation[1],
        target[0],
        target[1]
      );
      setDistanceToDest(dist);

      // Adaptive tracking mode based on distance, speed and network/power status
      // Speed is in m/s. 15 m/s = 54 km/h, 2 m/s = 7.2 km/h
      const isMovingFast = speed !== null && speed > 15;
      const isMovingSlow = speed !== null && speed < 2;
      const shouldBeConservative = isPowerSaveMode || isOffline || isSignalLost;
      
      let nextMode: typeof trackingMode = 'balanced';

      if (shouldBeConservative) {
        nextMode = 'eco';
      } else if (isMovingFast) {
        // Fast movement always needs high accuracy to not miss the trigger zone
        nextMode = 'high';
      } else if (dist > 30) {
        // Very far away: use eco to save battery
        nextMode = 'eco';
      } else if (dist > 10) {
        // Far away: use low accuracy
        nextMode = 'low';
      } else if (dist < 1.5) {
        // Close to destination: high accuracy to trigger alarm precisely
        // UNLESS moving very slowly (user request: "if moving slowly, use lower accuracy")
        nextMode = isMovingSlow ? 'balanced' : 'high';
      } else {
        // Mid-range: balanced
        nextMode = 'balanced';
      }

      if (trackingMode !== nextMode) {
        setTrackingMode(nextMode);
      }

      if (dist * 1000 <= radius) {
        triggerAlarm();
      }
    } else if (destinations.length === 0 || !isAlarmActive) {
      setDistanceToDest(null);
      if (trackingMode !== 'balanced') setTrackingMode('balanced');
    }
  }, [currentLocation, destinations, isAlarmActive, radius, isAlarmTriggered, currentStopIndex, trackingMode, speed, isPowerSaveMode, isOffline, isSignalLost]);

  const triggerAlarm = () => {
    if (isAlarmTriggered) return;
    setIsAlarmTriggered(true);

    // Vibration
    if (vibrationEnabled && 'vibrate' in navigator) {
      navigator.vibrate([500, 200, 500, 200, 500, 200, 500]);
    }

    // Push Notification
    if ('Notification' in window && Notification.permission === 'granted') {
      const title = 'Sonecando Pro: Chegando!';
      const options = {
        body: `Você está a menos de ${radius}m de ${destinationNames[currentStopIndex] || 'seu destino'}.`,
        icon: 'https://cdn-icons-png.flaticon.com/512/3177/3177361.png', // Alarm icon
        vibrate: [500, 200, 500, 200, 500],
        tag: 'destination-arrival',
        renotify: true,
        requireInteraction: true, // Keeps it until the user interacts
        silent: false
      };

      if ('serviceWorker' in navigator) {
        navigator.serviceWorker.ready.then(registration => {
          registration.showNotification(title, options);
        });
      } else {
        const notification = new Notification(title, options as any);
        notification.onclick = () => {
          window.focus();
          notification.close();
        };
      }
    }
  };

  const stopAlarm = () => {
    setIsAlarmTriggered(false);

    // Move to next stop if available
    if (currentStopIndex < destinations.length - 1) {
      setCurrentStopIndex(prev => prev + 1);
    } else {
      setIsAlarmActive(false);
      setCurrentStopIndex(0);
    }
  };

  const testAlarm = () => {
    if (audioRef.current) {
      if (audioRef.current.paused) {
        audioRef.current.play().catch(e => setError("Interação necessária para tocar som."));
        setTimeout(() => {
          if (!isAlarmTriggered) {
            audioRef.current?.pause();
            if (audioRef.current) audioRef.current.currentTime = 0;
          }
        }, 3000);
      } else {
        audioRef.current.pause();
        audioRef.current.currentTime = 0;
      }
    }
  };



  const handleSearch = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!searchQuery) return;

    setIsSearching(true);
    setSearchResults([]);
    setError(null);

    try {
      // 1. Build Search URL with Location Bias (approx 50km radius)
      let url = `https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(searchQuery)}&limit=10&addressdetails=1&countrycodes=br`;
      
      if (currentLocation) {
        const [lat, lon] = currentLocation;
        const offset = 0.45; // Approx 50km in degrees
        const viewbox = `${lon - offset},${lat + offset},${lon + offset},${lat - offset}`;
        url += `&viewbox=${viewbox}&bounded=0`; // bounded=0 uses it as bias, not strict limit
      }

      const response = await fetch(url);
      const rawData = await response.json();

      if (rawData && rawData.length > 0) {
        // 2. Use Gemini to refine and rank results for public transport context
        try {
          const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY || '' });
          const prompt = `
            O usuário está no transporte público e buscou por: "${searchQuery}".
            Localização atual do usuário: ${currentLocation ? `${currentLocation[0]}, ${currentLocation[1]}` : 'Não disponível'}.
            
            Abaixo estão os resultados da busca geográfica (JSON).
            Sua tarefa:
            1. Ordene-os por relevância para alguém que quer descer em um ponto de ônibus, estação de metrô/trem, terminal ou local público conhecido.
            2. PRIORIZE ABSOLUTAMENTE resultados que contenham "Ponto de Ônibus", "Estação", "Parada" ou "Terminal" no nome ou tipo.
            3. Use a localização atual para priorizar resultados que estejam na mesma cidade ou região próxima.
            4. Limpe os nomes para ficarem concisos e legíveis (ex: "Estação Pinheiros" em vez de "Estação Pinheiros, Rua Capri, Pinheiros, São Paulo").
            5. Adicione uma propriedade "category" ao JSON: "transport" para pontos/estações, "landmark" para locais conhecidos, "address" para ruas.
            6. Retorne APENAS o array JSON final com os objetos originais (mantendo lat, lon, display_name) + a nova propriedade "category".
            
            Resultados brutos: ${JSON.stringify(rawData.slice(0, 10).map((r: any) => ({
              place_id: r.place_id,
              display_name: r.display_name,
              type: r.type,
              class: r.class,
              lat: r.lat,
              lon: r.lon
            })))}
          `;

          const aiResponse = await ai.models.generateContent({
            model: "gemini-3-flash-preview",
            contents: prompt,
            config: {
              responseMimeType: "application/json",
            }
          });

          const refinedData = JSON.parse(aiResponse.text || '[]');
          if (Array.isArray(refinedData) && refinedData.length > 0) {
            setSearchResults(refinedData);
          } else {
            setSearchResults(rawData.slice(0, 5));
          }
        } catch (aiErr) {
          console.error('AI Refinement failed, using raw results:', aiErr);
          setSearchResults(rawData.slice(0, 5));
        }
      } else {
        setError('Local não encontrado próximo a você.');
      }
    } catch (err) {
      console.error('Search error:', err);
      setError('Erro ao buscar local.');
    } finally {
      setIsSearching(false);
    }
  };

  const handleSelectResult = (result: any, quickAlarm = false) => {
    const latNum = parseFloat(result.lat);
    const lonNum = parseFloat(result.lon);
    addStop(latNum, lonNum, result.display_name);
    setSearchResults([]);
    setSearchQuery('');
    
    if (quickAlarm) {
      // We need to set the index to the one we just added
      // Since setDestinations is async, we use a timeout or a side effect
      // But we can just set it to destinations.length
      setCurrentStopIndex(destinations.length);
      setIsAlarmActive(true);
      setIsAlarmTriggered(false);
    }
  };

  const startQuickTest = async () => {
    // Set a default destination in São Paulo (near the default center)
    const defaultDest: [number, number] = [-23.5555, -46.6383];
    await addStop(defaultDest[0], defaultDest[1], 'Teste Rápido');
    setIsSimulationMode(true);
    setSimulationIndex(0);
    setIsAlarmActive(true);
    setIsAlarmTriggered(false);
  };

  const addStop = async (lat: number, lng: number, name: string, quickAlarm: boolean = false) => {
    let stopName = name;
    if (!stopName) {
      stopName = await reverseGeocode(lat, lng);
    }
    
    setSearchQuery(stopName); // Update search bar with the address
    setDestinations(prev => {
      const newDestinations = [...prev, [lat, lng] as [number, number]];
      if (quickAlarm) {
        setCurrentStopIndex(newDestinations.length - 1);
        setIsAlarmActive(true);
        setIsAlarmTriggered(false);
      }
      return newDestinations;
    });
    setDestinationNames(prev => [...prev, stopName]);
    addToHistory(stopName, lat, lng);
    setError(null);
  };

  const removeStop = (index: number) => {
    setDestinations(prev => prev.filter((_, i) => i !== index));
    setDestinationNames(prev => prev.filter((_, i) => i !== index));
    if (currentStopIndex >= index && currentStopIndex > 0) {
      setCurrentStopIndex(prev => prev - 1);
    }
  };

  const selectFromHistory = (dest: RecentDestination) => {
    addStop(dest.lat, dest.lng, dest.name);
    setIsAlarmActive(false);
    setIsAlarmTriggered(false);
  };

  const handleShare = async () => {
    if (destinations.length === 0) return;
    
    const routeData = {
      coords: destinations,
      names: destinationNames
    };
    
    const encoded = btoa(JSON.stringify(routeData));
    const shareUrl = `${window.location.origin}${window.location.pathname}?route=${encoded}`;
    
    if (navigator.share) {
      try {
        await navigator.share({
          title: 'Minha Rota no Sonecando',
          text: `Confira minha rota com ${destinations.length} paradas no Sonecando!`,
          url: shareUrl,
        });
      } catch (err) {
        if ((err as Error).name !== 'AbortError') {
          console.error('Error sharing:', err);
        }
      }
    } else {
      navigator.clipboard.writeText(shareUrl).then(() => {
        setShowShareToast(true);
        setTimeout(() => setShowShareToast(false), 3000);
      });
    }
  };

  const toggleAlarm = () => {
    if (destinations.length === 0) {
      setError('Por favor, adicione ao menos um destino.');
      return;
    }
    setIsAlarmActive(!isAlarmActive);
    setIsAlarmTriggered(false);
    if (!isAlarmActive) {
      setCurrentStopIndex(0);
    }
  };

  const [activeTab, setActiveTab] = useState<'controls' | 'map'>('controls');

  if (!isAuthReady) {
    return (
      <div className="h-screen flex items-center justify-center bg-slate-50">
        <Loader2 className="w-8 h-8 text-blue-600 animate-spin" />
      </div>
    );
  }

  if (!user) {
    return <Auth onAuthChange={setUser} />;
  }

  return (
    <div className="flex flex-col h-screen bg-slate-50 overflow-hidden">
      {/* Header */}
      <header className="bg-white border-b border-slate-200 px-4 md:px-6 py-3 md:py-4 flex items-center justify-between z-30 shadow-sm sticky top-0">
        <div className="flex items-center gap-2 md:gap-3">
          <div className="bg-blue-600 p-1.5 md:p-2 rounded-lg shadow-blue-200 shadow-lg">
            <Bell className="text-white w-5 h-5 md:w-6 md:h-6" />
          </div>
          <h1 className="text-lg md:text-xl font-bold text-slate-800 tracking-tight">Sonecando</h1>
        </div>
        <div className="flex items-center gap-1.5 md:gap-2">
          {isOffline && (
            <button 
              onClick={() => window.location.reload()}
              className="flex items-center gap-1.5 px-2 py-1 bg-amber-50 border border-amber-100 rounded-lg text-amber-600 active:scale-95 transition-transform"
            >
              <AlertCircle className="w-3 h-3" />
              <span className="text-[9px] md:text-[10px] font-bold uppercase tracking-tight">Offline</span>
            </button>
          )}
          <div className="hidden sm:flex items-center gap-2 px-3 py-1.5 bg-blue-50 rounded-xl border border-blue-100 mr-2">
            <UserIcon className="w-3 h-3 text-blue-600" />
            <span className="text-[10px] font-bold text-blue-800">{user.displayName || user.email?.split('@')[0]}</span>
          </div>
          {destinations.length > 0 && (
            <button 
              onClick={handleShare}
              className="flex items-center gap-2 px-2 md:px-3 py-2 bg-slate-50 hover:bg-blue-50 text-slate-600 hover:text-blue-600 rounded-xl transition-all text-xs font-bold border border-slate-100 hover:border-blue-100 active:scale-95"
              title="Compartilhar Rota"
            >
              <Share2 className="w-4 h-4" />
              <span className="hidden sm:inline">Compartilhar</span>
            </button>
          )}
          <button 
            onClick={() => setIsMuted(!isMuted)}
            className="p-2 hover:bg-slate-100 rounded-full transition-colors active:scale-90"
          >
            {isMuted ? <VolumeX className="w-5 h-5 md:w-6 md:h-6 text-slate-400" /> : <Volume2 className="w-5 h-5 md:w-6 md:h-6 text-blue-600" />}
          </button>
          <LogoutButton />
        </div>
      </header>

      {/* Mobile Bottom Navigation */}
      <div className="md:hidden fixed bottom-0 left-0 right-0 bg-white border-t border-slate-200 flex items-center justify-around py-3 px-6 z-[60] shadow-[0_-4px_20px_rgba(0,0,0,0.05)]">
        <button 
          onClick={() => setActiveTab('controls')}
          className={`flex flex-col items-center gap-1 transition-all ${
            activeTab === 'controls' ? 'text-blue-600 scale-110' : 'text-slate-400'
          }`}
        >
          <Settings className={`w-6 h-6 ${activeTab === 'controls' ? 'fill-blue-50' : ''}`} />
          <span className="text-[10px] font-bold uppercase tracking-wider">Controles</span>
        </button>
        <div className="w-12 h-12 bg-blue-600 rounded-full -mt-10 border-4 border-slate-50 shadow-lg flex items-center justify-center text-white active:scale-90 transition-transform" onClick={() => setActiveTab('controls')}>
           <Navigation className="w-6 h-6" />
        </div>
        <button 
          onClick={() => setActiveTab('map')}
          className={`flex flex-col items-center gap-1 transition-all ${
            activeTab === 'map' ? 'text-blue-600 scale-110' : 'text-slate-400'
          }`}
        >
          <MapPin className={`w-6 h-6 ${activeTab === 'map' ? 'fill-blue-50' : ''}`} />
          <span className="text-[10px] font-bold uppercase tracking-wider">Mapa</span>
        </button>
      </div>

      {/* Share Toast */}
      <AnimatePresence>
        {showShareToast && (
          <motion.div
            initial={{ opacity: 0, y: -20, x: '-50%' }}
            animate={{ opacity: 1, y: 20, x: '-50%' }}
            exit={{ opacity: 0, y: -20, x: '-50%' }}
            className="fixed top-20 left-1/2 z-50 bg-slate-900 text-white px-6 py-3 rounded-2xl shadow-2xl flex items-center gap-3 border border-white/10 backdrop-blur-md"
          >
            <div className="bg-green-500 p-1 rounded-full">
              <Check className="w-4 h-4 text-white" />
            </div>
            <span className="text-sm font-bold">Link da rota copiado!</span>
          </motion.div>
        )}
      </AnimatePresence>

      <main className="flex-1 flex flex-col md:flex-row overflow-hidden relative">
        {/* Sidebar / Controls */}
        <div className={`w-full md:w-96 bg-white border-r border-slate-200 p-6 flex flex-col gap-6 overflow-y-auto z-20 shadow-xl md:shadow-none pb-24 md:pb-6 ${
          activeTab === 'controls' ? 'flex' : 'hidden md:flex'
        }`}>
          
          {/* Search */}
          <div className="relative space-y-3">
            <form onSubmit={handleSearch} className="relative">
              <input
                type="text"
                placeholder="Adicionar parada..."
                className="w-full pl-10 pr-10 py-3 bg-slate-50 border border-slate-200 rounded-xl focus:ring-2 focus:ring-blue-500 focus:border-transparent outline-none transition-all text-sm"
                value={searchQuery}
                onChange={(e) => {
                  setSearchQuery(e.target.value);
                  if (!e.target.value) setSearchResults([]);
                }}
              />
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
              {isSearching && (
                <div className="absolute right-3 top-1/2 -translate-y-1/2">
                  <div className="w-4 h-4 border-2 border-blue-600 border-t-transparent rounded-full animate-spin"></div>
                </div>
              )}
              <button type="submit" className="hidden">Adicionar</button>
            </form>



            {/* Search Results Dropdown */}
            <AnimatePresence>
              {searchResults.length > 0 && (
                <motion.div
                  initial={{ opacity: 0, y: -10 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -10 }}
                  className="absolute top-full left-0 right-0 mt-2 bg-white rounded-xl shadow-2xl border border-slate-200 z-[60] overflow-hidden"
                >
                  {searchResults.map((result, idx) => (
                    <div key={idx} className="flex items-center border-b border-slate-100 last:border-none group hover:bg-blue-50 transition-colors">
                      <button
                        onClick={() => handleSelectResult(result)}
                        className="flex-1 text-left px-4 py-3"
                      >
                        <div className="flex items-start gap-3">
                          <div className={`p-1.5 rounded-lg shrink-0 mt-0.5 ${
                            result.category === 'transport' ? 'bg-blue-100 text-blue-600' : 
                            result.category === 'landmark' ? 'bg-amber-100 text-amber-600' : 
                            'bg-slate-100 text-slate-400'
                          }`}>
                            {result.category === 'transport' ? <Navigation className="w-3 h-3" /> : 
                             result.category === 'landmark' ? <MapPin className="w-3 h-3" /> : 
                             <Search className="w-3 h-3" />}
                          </div>
                          <div className="flex-1">
                            <div className="flex items-center gap-2 mb-0.5">
                              <p className="text-xs font-bold text-slate-800 line-clamp-1">{result.display_name.split(',')[0]}</p>
                              {result.category === 'transport' && (
                                <span className="text-[8px] bg-blue-600 text-white px-1 rounded font-bold uppercase">Transporte</span>
                              )}
                            </div>
                            <p className="text-[10px] text-slate-400 line-clamp-1">{result.display_name}</p>
                          </div>
                        </div>
                      </button>
                      <button 
                        onClick={() => handleSelectResult(result, true)}
                        className="p-4 text-blue-400 hover:text-blue-600 transition-colors"
                        title="Definir Alarme Imediato"
                      >
                        <Bell className="w-4 h-4" />
                      </button>
                    </div>
                  ))}
                </motion.div>
              )}
            </AnimatePresence>
          </div>

          {/* Stops List */}
          <div className="space-y-3">
            <h3 className="text-xs font-bold uppercase tracking-wider text-slate-400 flex items-center gap-2">
              <Navigation className="w-3 h-3" /> Rota de Paradas
            </h3>
            <div className="space-y-2">
              {destinations.length > 0 ? (
                destinations.map((_, index) => (
                  <div 
                    key={index}
                    className={`flex items-center gap-3 p-3 rounded-xl border transition-all ${
                      index === currentStopIndex && isAlarmActive 
                        ? 'bg-blue-50 border-blue-200 ring-1 ring-blue-100' 
                        : 'bg-slate-50 border-slate-100'
                    }`}
                  >
                    <div className={`w-6 h-6 rounded-full flex items-center justify-center text-[10px] font-bold shrink-0 ${
                      index < currentStopIndex 
                        ? 'bg-green-500 text-white' 
                        : index === currentStopIndex && isAlarmActive
                          ? 'bg-blue-600 text-white animate-pulse'
                          : 'bg-slate-300 text-slate-600'
                    }`}>
                      {index + 1}
                    </div>
                    <p className="text-xs font-medium text-slate-700 line-clamp-1 flex-1">
                      {destinationNames[index]}
                    </p>
                    <div className="flex items-center gap-1">
                      <button 
                        onClick={() => {
                          setCurrentStopIndex(index);
                          setIsAlarmTriggered(false);
                          if (!isAlarmActive) setIsAlarmActive(true);
                        }}
                        className={`p-1.5 rounded-lg transition-colors ${index === currentStopIndex ? 'text-blue-600 bg-blue-100' : 'text-slate-300 hover:text-blue-400 hover:bg-slate-100'}`}
                        title="Definir como alvo do alarme"
                      >
                        <Bell className="w-4 h-4" />
                      </button>
                      <button 
                        onClick={() => removeStop(index)}
                        className="p-1.5 text-slate-300 hover:text-red-500 transition-colors"
                        title="Remover Parada"
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    </div>
                  </div>
                ))
              ) : (
                <p className="text-xs text-slate-400 italic text-center py-4 bg-slate-50 rounded-xl border border-dashed border-slate-200">
                  Clique no mapa ou busque para adicionar paradas
                </p>
              )}
            </div>
          </div>

          {/* Saved Routes Section */}
          {savedRoutes.length > 0 && (
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <h3 className="text-xs font-bold uppercase tracking-wider text-slate-400 flex items-center gap-2">
                  <Bookmark className="w-3 h-3" /> Rotas Salvas
                </h3>
              </div>
              <div className="flex gap-2 overflow-x-auto pb-2 scrollbar-hide">
                {savedRoutes.map(route => (
                  <div key={route.id} className="shrink-0 group relative">
                    {editingRouteId === route.id ? (
                      <div className="flex items-center gap-1 bg-white border border-blue-200 rounded-lg px-2 py-1 shadow-sm">
                        <input
                          autoFocus
                          type="text"
                          value={editingRouteName}
                          onChange={(e) => setEditingRouteName(e.target.value)}
                          onKeyDown={(e) => {
                            if (e.key === 'Enter') updateRouteName(route.id, editingRouteName);
                            if (e.key === 'Escape') setEditingRouteId(null);
                          }}
                          onBlur={() => updateRouteName(route.id, editingRouteName)}
                          className="w-24 text-[10px] font-bold text-blue-700 outline-none bg-transparent"
                        />
                        <button 
                          onClick={() => updateRouteName(route.id, editingRouteName)}
                          className="text-blue-600 hover:text-blue-800"
                        >
                          <Check className="w-3 h-3" />
                        </button>
                      </div>
                    ) : (
                      <div className="flex items-center gap-1">
                        <button
                          onClick={() => loadRoute(route)}
                          className={`px-3 py-2 rounded-lg border transition-all text-[10px] font-bold flex items-center gap-2 ${
                            route.syncStatus === 'pending' 
                              ? 'bg-amber-50 border-amber-200 text-amber-700' 
                              : 'bg-blue-50 border-blue-100 hover:border-blue-300 hover:bg-blue-100 text-blue-700'
                          }`}
                        >
                          <Navigation className="w-3 h-3" />
                          {route.name}
                          {route.syncStatus === 'pending' && (
                            <Loader2 className="w-2.5 h-2.5 animate-spin" />
                          )}
                        </button>
                        <button 
                          onClick={(e) => {
                            e.stopPropagation();
                            setEditingRouteId(route.id);
                            setEditingRouteName(route.name);
                          }}
                          className="absolute -top-1 right-3 bg-white shadow-sm border border-slate-100 rounded-full p-0.5 opacity-0 group-hover:opacity-100 transition-opacity text-blue-400 hover:text-blue-600 z-10"
                        >
                          <Edit2 className="w-2.5 h-2.5" />
                        </button>
                        <button 
                          onClick={(e) => {
                            e.stopPropagation();
                            deleteRoute(route.id);
                          }}
                          className="absolute -top-1 -right-1 bg-white shadow-sm border border-slate-100 rounded-full p-0.5 opacity-0 group-hover:opacity-100 transition-opacity text-red-400 hover:text-red-600 z-10"
                        >
                          <X className="w-2.5 h-2.5" />
                        </button>
                      </div>
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Recent Destinations (Horizontal) */}
          {recentDestinations.length > 3 && (
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <h3 className="text-xs font-bold uppercase tracking-wider text-slate-400 flex items-center gap-2">
                  <History className="w-3 h-3" /> Histórico Recente
                </h3>
                <button onClick={clearHistory} className="text-slate-300 hover:text-red-400 transition-colors">
                  <Trash2 className="w-3 h-3" />
                </button>
              </div>
              <div className="flex gap-2 overflow-x-auto pb-2 scrollbar-hide">
                {recentDestinations
                  .sort((a, b) => b.timestamp - a.timestamp)
                  .map(dest => (
                    <button
                      key={dest.id}
                      onClick={() => selectFromHistory(dest)}
                      className={`shrink-0 px-3 py-2 rounded-lg border transition-all text-[10px] font-medium whitespace-nowrap flex items-center gap-2 ${
                        dest.syncStatus === 'pending'
                          ? 'bg-amber-50 border-amber-100 text-amber-600'
                          : 'bg-slate-50 border-slate-100 hover:border-blue-200 hover:bg-blue-50 text-slate-600'
                      }`}
                    >
                      {dest.name.split(',')[0]}
                      {dest.syncStatus === 'pending' && (
                        <div className="w-1.5 h-1.5 bg-amber-400 rounded-full animate-pulse" />
                      )}
                    </button>
                  ))}
              </div>
            </div>
          )}

          {/* Status Card */}
          <div className="bg-slate-50 rounded-2xl p-5 border border-slate-100">
            <div className="flex items-center justify-between mb-4">
              <div className="flex flex-col">
                <span className="text-xs font-semibold uppercase tracking-wider text-slate-400">Monitoramento</span>
                {isAlarmActive && (
                  <div className="flex flex-col">
                    <span className={`text-[10px] font-bold ${
                      trackingMode === 'eco' ? 'text-green-600' : 
                      trackingMode === 'low' ? 'text-emerald-500' : 
                      trackingMode === 'balanced' ? 'text-blue-500' : 
                      'text-orange-500'
                    }`}>
                      {trackingMode === 'eco' ? 'Modo Ultra Eco' : 
                       trackingMode === 'low' ? 'Economia de Bateria' : 
                       trackingMode === 'balanced' ? 'Modo Equilibrado' : 
                       'Alta Precisão'}
                    </span>
                    {speed !== null && speed > 0 && (
                      <span className="text-[8px] text-slate-400 font-medium">
                        Velocidade: {(speed * 3.6).toFixed(0)} km/h
                      </span>
                    )}
                  </div>
                )}
              </div>
              <div className="flex items-center gap-3">
                {destinations.length > 0 && (
                  <>
                    <button 
                      onClick={handleShare}
                      className="p-2 bg-white hover:bg-blue-50 text-slate-400 hover:text-blue-600 rounded-xl transition-all border border-slate-100 hover:border-blue-100 shadow-sm"
                      title="Compartilhar Rota"
                    >
                      <Share2 className="w-4 h-4" />
                    </button>
                    <button 
                      onClick={() => {
                        setDestinations([]);
                        setDestinationNames([]);
                        setIsAlarmActive(false);
                        setIsAlarmTriggered(false);
                        setIsSimulationMode(false);
                        setSearchQuery('');
                      }}
                      className="p-2 bg-white hover:bg-red-50 text-slate-400 hover:text-red-500 rounded-xl transition-all border border-slate-100 hover:border-red-100 shadow-sm"
                      title="Limpar Rota"
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                  </>
                )}
                <div className={`w-2 h-2 rounded-full ${isAlarmActive ? 'bg-green-500 animate-pulse' : 'bg-slate-300'}`}></div>
              </div>
            </div>

            {currentAddress && (
              <div className="mb-4 pb-4 border-b border-slate-200/50">
                <div className="flex items-start gap-3">
                  <Navigation className="w-4 h-4 text-slate-400 mt-0.5 shrink-0" />
                  <div>
                    <p className="text-[10px] uppercase font-bold text-slate-400">Local de Partida</p>
                    <p className="text-xs font-medium text-slate-600 line-clamp-1">{currentAddress}</p>
                  </div>
                </div>
              </div>
            )}
            
            {routeInfo && destinations.length > 0 && (
              <div className="grid grid-cols-2 gap-3 mb-4">
                <div className="bg-white p-3 rounded-xl border border-slate-100">
                  <p className="text-[10px] text-slate-400 uppercase font-bold mb-1">Distância Total</p>
                  <p className="text-sm font-bold text-slate-700">{(routeInfo.totalDistance / 1000).toFixed(1)} km</p>
                </div>
                <div className="bg-white p-3 rounded-xl border border-slate-100">
                  <p className="text-[10px] text-slate-400 uppercase font-bold mb-1">Tempo Est.</p>
                  <p className="text-sm font-bold text-slate-700">{Math.round(routeInfo.totalTime / 60)} min</p>
                </div>
              </div>
            )}

            {destinations.length > 0 ? (
              <div className="space-y-3">
                <div className="flex items-start gap-3">
                  <MapPin className="w-5 h-5 text-blue-600 mt-0.5 shrink-0" />
                  <div className="flex-1">
                    <p className="text-[10px] uppercase font-bold text-slate-400">Próxima Parada</p>
                    <p className="text-sm font-bold text-slate-800 line-clamp-1">{destinationNames[currentStopIndex]}</p>
                  </div>
                  {!isAlarmActive && (
                    <button 
                      onClick={() => {
                        setIsSimulationMode(true);
                        setSimulationIndex(0);
                        setIsAlarmActive(true);
                        setIsAlarmTriggered(false);
                      }}
                      className="p-1.5 bg-blue-50 text-blue-600 rounded-lg hover:bg-blue-100 transition-colors"
                      title="Simular esta rota"
                    >
                      <Play className="w-3 h-3" />
                    </button>
                  )}
                </div>
                {distanceToDest !== null && (
                  <div className="space-y-2">
                    <div className="flex items-center gap-3">
                      <Navigation className="w-5 h-5 text-blue-600 shrink-0" />
                      <p className="text-lg font-bold text-slate-800">
                        {distanceToDest < 1 ? `${(distanceToDest * 1000).toFixed(0)}m` : `${distanceToDest.toFixed(2)}km`}
                      </p>
                    </div>
                    {/* Progress Bar to Radius */}
                    <div className="space-y-1">
                      <div className="flex justify-between items-center px-1">
                        <span className="text-[8px] font-bold text-slate-400 uppercase">Progresso</span>
                        {routeInfo && (
                          <div className="flex flex-col items-end">
                            <span className="text-[8px] font-bold text-blue-500 uppercase">
                              Faltam ~{Math.round((distanceToDest / (routeInfo.totalDistance / 1000)) * (routeInfo.totalTime / 60))} min
                            </span>
                            {simulationCoords.length > 0 && (
                              <span className="text-[7px] font-bold text-slate-400 uppercase">
                                ~{Math.max(0, Math.floor((simulationCoords.length - simulationIndex) / 20))} paradas restantes
                              </span>
                            )}
                          </div>
                        )}
                      </div>
                      <div className="w-full h-2 bg-slate-200 rounded-full overflow-hidden">
                        <motion.div 
                          className="h-full bg-blue-500"
                          initial={{ width: 0 }}
                          animate={{ 
                            width: `${Math.max(0, Math.min(100, (1 - (distanceToDest * 1000 - radius) / (routeInfo ? routeInfo.totalDistance : 2000)) * 100))}%` 
                          }}
                        />
                      </div>
                      <p className="text-[9px] text-slate-400 text-center">Aproximando-se da zona de ativação</p>
                    </div>
                  </div>
                )}
              </div>
            ) : (
              <div className="space-y-3">
                <p className="text-sm text-slate-400 italic">Nenhuma rota definida</p>
                <button 
                  onClick={startQuickTest}
                  className="w-full py-2 bg-blue-50 text-blue-600 rounded-xl text-xs font-bold hover:bg-blue-100 transition-colors flex items-center justify-center gap-2"
                >
                  <Play className="w-3 h-3" /> Teste Rápido (Simulação)
                </button>
              </div>
            )}
            {destinations.length > 0 && (
              <div className="pt-4 border-t border-slate-200/50">
                {!isSavingRoute ? (
                  <button 
                    onClick={() => setIsSavingRoute(true)}
                    className="w-full py-2 bg-slate-100 hover:bg-blue-50 text-slate-600 hover:text-blue-600 rounded-xl text-[10px] font-bold transition-all flex items-center justify-center gap-2 border border-dashed border-slate-300 hover:border-blue-200"
                  >
                    <Bookmark className="w-3 h-3" /> Salvar esta Rota
                  </button>
                ) : (
                  <div className="space-y-2">
                    <input
                      type="text"
                      placeholder="Nome da rota (ex: Casa -> Trabalho)"
                      className="w-full px-3 py-2 bg-white border border-blue-200 rounded-xl text-[10px] outline-none focus:ring-2 focus:ring-blue-500"
                      value={routeName}
                      onChange={(e) => setRouteName(e.target.value)}
                      autoFocus
                    />
                    <div className="flex gap-2">
                      <button 
                        onClick={saveCurrentRoute}
                        disabled={!routeName.trim()}
                        className="flex-1 py-2 bg-blue-600 text-white rounded-xl text-[10px] font-bold hover:bg-blue-700 disabled:opacity-50 transition-all"
                      >
                        Confirmar
                      </button>
                      <button 
                        onClick={() => {
                          setIsSavingRoute(false);
                          setRouteName('');
                        }}
                        className="px-4 py-2 bg-slate-100 text-slate-600 rounded-xl text-[10px] font-bold hover:bg-slate-200 transition-all"
                      >
                        Cancelar
                      </button>
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>

          {/* Settings */}
          <div className="space-y-4">
            <div className="flex items-center justify-between">
              <label className="text-sm font-medium text-slate-700 flex items-center gap-2">
                <Settings className="w-4 h-4" /> Raio de Ativação
              </label>
              <span className="text-sm font-bold text-blue-600">{radius}m</span>
            </div>
            <input
              type="range"
              min="100"
              max="5000"
              step="100"
              value={radius}
              onChange={(e) => setRadius(parseInt(e.target.value))}
              className="w-full h-2 bg-slate-200 rounded-lg appearance-none cursor-pointer accent-blue-600"
            />
            
            <div className="space-y-3 pt-2">
              <div className="flex items-center justify-between">
                <span className="text-xs font-bold text-slate-500 uppercase tracking-wider">Som do Alarme</span>
                <select 
                  value={selectedSound}
                  onChange={(e) => setSelectedSound(e.target.value)}
                  className="text-xs bg-slate-50 border border-slate-200 rounded-lg px-2 py-1 outline-none focus:ring-1 focus:ring-blue-500"
                >
                  <option value="classic">Clássico</option>
                  <option value="digital">Digital</option>
                  <option value="gentle">Suave</option>
                </select>
              </div>

              <div className="flex items-center justify-between">
                <span className="text-xs font-bold text-slate-500 uppercase tracking-wider">Vibração</span>
                <button 
                  onClick={() => setVibrationEnabled(!vibrationEnabled)}
                  className={`w-10 h-5 rounded-full transition-colors relative ${vibrationEnabled ? 'bg-blue-600' : 'bg-slate-300'}`}
                >
                  <div className={`absolute top-1 w-3 h-3 bg-white rounded-full transition-all ${vibrationEnabled ? 'left-6' : 'left-1'}`}></div>
                </button>
              </div>

              <div className="flex items-center justify-between">
                <div className="flex flex-col">
                  <span className="text-xs font-bold text-slate-500 uppercase tracking-wider">Economia de Energia</span>
                  <span className="text-[10px] text-slate-400">Reduz precisão do GPS</span>
                </div>
                <button 
                  onClick={() => setIsPowerSaveMode(!isPowerSaveMode)}
                  className={`w-10 h-5 rounded-full transition-colors relative ${isPowerSaveMode ? 'bg-green-500' : 'bg-slate-300'}`}
                >
                  <div className={`absolute top-1 w-3 h-3 bg-white rounded-full transition-all ${isPowerSaveMode ? 'left-6' : 'left-1'}`}></div>
                </button>
              </div>

              <div className="flex flex-col gap-2 pt-2 border-t border-slate-100">
                <div className="flex items-center justify-between">
                  <div className="flex flex-col">
                    <span className="text-xs font-bold text-slate-500 uppercase tracking-wider">Notificações Push</span>
                    <span className="text-[10px] text-slate-400">Alerta mesmo em segundo plano</span>
                  </div>
                  <button 
                    onClick={() => {
                      if ('Notification' in window) {
                        Notification.requestPermission().then(permission => {
                          setNotificationPermission(permission);
                          if (permission === 'granted') {
                            const title = 'Notificações Ativadas!';
                            const options = { 
                              body: 'Você receberá alertas quando chegar ao destino.',
                              icon: 'https://cdn-icons-png.flaticon.com/512/3177/3177361.png'
                            };
                            if ('serviceWorker' in navigator) {
                              navigator.serviceWorker.ready.then(reg => reg.showNotification(title, options));
                            } else {
                              new Notification(title, options);
                            }
                          } else if (permission === 'denied') {
                            setError('Notificações bloqueadas. Por favor, habilite nas configurações do seu navegador.');
                          }
                        });
                      }
                    }}
                    className={`w-10 h-5 rounded-full transition-colors relative ${notificationPermission === 'granted' ? 'bg-blue-600' : 'bg-slate-300'}`}
                  >
                    <div className={`absolute top-1 w-3 h-3 bg-white rounded-full transition-all ${notificationPermission === 'granted' ? 'left-6' : 'left-1'}`}></div>
                  </button>
                </div>
                {isInIframe && (
                  <div className="flex items-center gap-2 p-2 bg-amber-50 border border-amber-100 rounded-lg">
                    <AlertCircle className="w-3 h-3 text-amber-500" />
                    <span className="text-[10px] text-amber-700 leading-tight">
                      Para notificações funcionarem em segundo plano, abra o app em uma <strong>nova aba</strong>.
                    </span>
                  </div>
                )}
              </div>

              <div className="flex items-center justify-between pt-2 border-t border-slate-100">
                <div className="flex flex-col">
                  <span className="text-xs font-bold text-slate-500 uppercase tracking-wider">Auto-Centralizar Mapa</span>
                  <span className="text-[10px] text-slate-400">Segue sua posição no mapa</span>
                </div>
                <button 
                  onClick={() => setAutoCenter(!autoCenter)}
                  className={`w-10 h-5 rounded-full transition-colors relative ${autoCenter ? 'bg-blue-600' : 'bg-slate-300'}`}
                >
                  <div className={`absolute top-1 w-3 h-3 bg-white rounded-full transition-all ${autoCenter ? 'left-6' : 'left-1'}`}></div>
                </button>
              </div>

              <div className="flex items-center justify-between pt-2 border-t border-slate-100">
                <div className="flex flex-col">
                  <span className="text-xs font-bold text-slate-500 uppercase tracking-wider">Modo Simulação</span>
                  <span className="text-[10px] text-slate-400">Teste o alarme na rota</span>
                </div>
                <button 
                  onClick={() => {
                    setIsSimulationMode(!isSimulationMode);
                    if (!isSimulationMode) setSimulationIndex(0);
                  }}
                  className={`w-10 h-5 rounded-full transition-colors relative ${isSimulationMode ? 'bg-blue-600' : 'bg-slate-300'}`}
                >
                  <div className={`absolute top-1 w-3 h-3 bg-white rounded-full transition-all ${isSimulationMode ? 'left-6' : 'left-1'}`}></div>
                </button>
              </div>
            </div>

            <button 
              onClick={testAlarm}
              className="w-full py-2 border border-slate-200 rounded-xl text-xs font-semibold text-slate-500 hover:bg-slate-50 transition-colors flex items-center justify-center gap-2"
            >
              <Volume2 className="w-3 h-3" /> Testar Configurações
            </button>
          </div>

          {/* Simulation Toggle */}
          <div className="flex items-center justify-between p-4 bg-slate-50 border border-slate-200 rounded-2xl mb-2 shadow-sm">
            <div className="flex items-center gap-3">
              <div className={`p-2 rounded-xl ${isSimulationMode ? 'bg-blue-100 text-blue-600' : 'bg-slate-200 text-slate-400'}`}>
                <Play className="w-4 h-4" />
              </div>
              <div className="flex flex-col">
                <span className="text-xs font-bold text-slate-800 uppercase tracking-tight">Modo Simulação</span>
                <span className="text-[10px] text-slate-400">Simular viagem na rota</span>
              </div>
            </div>
            <button 
              onClick={() => {
                setIsSimulationMode(!isSimulationMode);
                if (!isSimulationMode) setSimulationIndex(0);
              }}
              className={`w-12 h-6 rounded-full transition-all relative ${isSimulationMode ? 'bg-blue-600 shadow-inner' : 'bg-slate-300'}`}
            >
              <div className={`absolute top-1 w-4 h-4 bg-white rounded-full shadow-md transition-all ${isSimulationMode ? 'left-7' : 'left-1'}`}></div>
            </button>
          </div>

          {/* Simulation Active Controls */}
          <AnimatePresence>
            {isSimulationMode && (
              <motion.div 
                initial={{ opacity: 0, height: 0, marginBottom: 0 }}
                animate={{ opacity: 1, height: 'auto', marginBottom: 16 }}
                exit={{ opacity: 0, height: 0, marginBottom: 0 }}
                className="overflow-hidden"
              >
                <div className="p-4 bg-blue-50 border border-blue-100 rounded-2xl space-y-4 shadow-sm">
                  <div className="flex items-center justify-between">
                    <span className="text-[10px] font-bold text-blue-600 uppercase tracking-wider">Configurações de Simulação</span>
                    <div className="flex gap-1">
                      <button 
                        onClick={() => setTransportMode('car')}
                        className={`p-1.5 rounded-lg transition-colors ${transportMode === 'car' ? 'bg-blue-600 text-white shadow-sm' : 'bg-white text-slate-400 border border-slate-100'}`}
                        title="Carro"
                      >
                        <Car className="w-3 h-3" />
                      </button>
                      <button 
                        onClick={() => setTransportMode('bus')}
                        className={`p-1.5 rounded-lg transition-colors ${transportMode === 'bus' ? 'bg-blue-600 text-white shadow-sm' : 'bg-white text-slate-400 border border-slate-100'}`}
                        title="Ônibus"
                      >
                        <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M19 17h2c.6 0 1-.4 1-1v-3c0-.9-.7-1.7-1.5-1.9C18.7 10.7 16 10 16 10V4c0-1.1-.9-2-2-2H6c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h0c1.1 0 2-.9 2-2v-2h8v2c0 1.1.9 2 2 2h0c1.1 0 2-.9 2-2v-1z"/><path d="M14 6H6"/><path d="M14 10H6"/><path d="M8 14h0"/><path d="M14 14h0"/></svg>
                      </button>
                      <button 
                        onClick={() => setTransportMode('train')}
                        className={`p-1.5 rounded-lg transition-colors ${transportMode === 'train' ? 'bg-blue-600 text-white shadow-sm' : 'bg-white text-slate-400 border border-slate-100'}`}
                        title="Trem/Metrô"
                      >
                        <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect width="16" height="16" x="4" y="3" rx="2"/><path d="M4 11h16"/><path d="M12 3v8"/><path d="M8 19l-2 3"/><path d="M16 19l2 3"/></svg>
                      </button>
                    </div>
                  </div>

                  <div className="flex items-center justify-between">
                    <div className="flex flex-col">
                      <span className="text-[10px] font-bold text-slate-500 uppercase">Simular Perda de Sinal</span>
                      <span className="text-[8px] text-slate-400 italic">Estima posição por tempo</span>
                    </div>
                    <button 
                      onClick={() => setIsSignalLost(!isSignalLost)}
                      className={`w-8 h-4 rounded-full transition-colors relative ${isSignalLost ? 'bg-red-500 shadow-inner' : 'bg-slate-300'}`}
                    >
                      <div className={`absolute top-0.5 w-3 h-3 bg-white rounded-full shadow-sm transition-all ${isSignalLost ? 'left-4.5' : 'left-0.5'}`}></div>
                    </button>
                  </div>

                  <div className="space-y-2">
                    <div className="flex items-center justify-between">
                      <span className="text-[10px] font-bold text-slate-500 uppercase">Velocidade da Viagem</span>
                      <span className="text-xs font-bold text-blue-600 bg-white px-2 py-0.5 rounded-lg shadow-sm border border-blue-50">{simulationSpeed}x</span>
                    </div>
                    
                    <div className="flex gap-1">
                      <button 
                        onClick={() => setSimulationSpeed(0.5)}
                        className={`flex-1 py-1.5 px-2 rounded-lg text-[9px] font-bold transition-all flex items-center justify-center gap-1.5 ${simulationSpeed === 0.5 ? 'bg-blue-600 text-white shadow-md' : 'bg-white text-slate-500 border border-slate-100 hover:bg-slate-50'}`}
                      >
                        <Footprints className="w-3 h-3" />
                        <span>Andar</span>
                      </button>
                      <button 
                        onClick={() => setSimulationSpeed(2)}
                        className={`flex-1 py-1.5 px-2 rounded-lg text-[9px] font-bold transition-all flex items-center justify-center gap-1.5 ${simulationSpeed === 2 ? 'bg-blue-600 text-white shadow-md' : 'bg-white text-slate-500 border border-slate-100 hover:bg-slate-50'}`}
                      >
                        <Bike className="w-3 h-3" />
                        <span>Pedalar</span>
                      </button>
                      <button 
                        onClick={() => setSimulationSpeed(10)}
                        className={`flex-1 py-1.5 px-2 rounded-lg text-[9px] font-bold transition-all flex items-center justify-center gap-1.5 ${simulationSpeed === 10 ? 'bg-blue-600 text-white shadow-md' : 'bg-white text-slate-500 border border-slate-100 hover:bg-slate-50'}`}
                      >
                        <Car className="w-3 h-3" />
                        <span>Dirigir</span>
                      </button>
                    </div>

                    <input 
                      type="range" 
                      min="0.5" 
                      max="100" 
                      step="0.5"
                      value={simulationSpeed} 
                      onChange={(e) => setSimulationSpeed(parseFloat(e.target.value))}
                      className="w-full h-1.5 bg-slate-200 rounded-lg appearance-none cursor-pointer accent-blue-600"
                    />
                  </div>

                  <div className="grid grid-cols-2 gap-2 pt-1">
                    <button 
                      onClick={() => {
                        if (simulationCoords.length > 0) {
                          const nearEndIndex = Math.max(0, simulationCoords.length - 20);
                          setSimulationIndex(nearEndIndex);
                          setCurrentLocation(simulationCoords[nearEndIndex]);
                        }
                      }}
                      className="py-2 bg-white text-blue-600 border border-blue-100 rounded-xl text-[10px] font-bold hover:bg-blue-50 transition-colors shadow-sm"
                    >
                      Pular para o Fim
                    </button>
                    <button 
                      onClick={() => {
                        setSimulationIndex(0);
                        if (simulationCoords.length > 0) setCurrentLocation(simulationCoords[0]);
                      }}
                      className="py-2 bg-white text-slate-600 border border-slate-100 rounded-xl text-[10px] font-bold hover:bg-slate-50 transition-colors shadow-sm"
                    >
                      Reiniciar
                    </button>
                  </div>
                </div>
              </motion.div>
            )}
          </AnimatePresence>

          {/* Action Button */}
          <button
            onClick={toggleAlarm}
            disabled={destinations.length === 0}
            className={`w-full py-4 rounded-2xl font-bold text-lg shadow-lg transition-all active:scale-95 flex items-center justify-center gap-2 ${
              destinations.length === 0 
                ? 'bg-slate-200 text-slate-400 cursor-not-allowed shadow-none' 
                : isAlarmActive 
                  ? 'bg-red-500 text-white shadow-red-200' 
                  : 'bg-blue-600 text-white shadow-blue-200 hover:bg-blue-700'
            }`}
          >
            {isAlarmActive ? 'Parar Monitoramento' : 'Iniciar Rota'}
          </button>

          {isOffline && (
            <div className="flex items-center gap-2 p-3 bg-amber-50 text-amber-600 rounded-xl text-xs border border-amber-100">
              <AlertCircle className="w-4 h-4 shrink-0" />
              <span>Você está offline. O rastreamento pode ser menos preciso.</span>
            </div>
          )}

          {isSignalLost && (
            <div className="flex items-center gap-2 p-3 bg-red-50 text-red-600 rounded-xl text-xs border border-red-100 animate-pulse">
              <AlertCircle className="w-4 h-4 shrink-0" />
              <span>Sinal de GPS perdido. Estimando posição...</span>
            </div>
          )}

          {error && (
            <motion.div 
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              className="flex flex-col gap-2 p-3 bg-red-50 text-red-600 rounded-xl text-xs border border-red-100"
            >
              <div className="flex items-center gap-2">
                <AlertCircle className="w-4 h-4 shrink-0" />
                <span>{error}</span>
              </div>
              {error.includes('Permissão') && (
                <button 
                  onClick={() => {
                    setTrackingMode(prev => prev === 'high' ? 'low' : 'high'); // Toggle to trigger useEffect
                    setError(null);
                  }}
                  className="mt-1 py-1 px-2 bg-red-100 hover:bg-red-200 rounded-lg font-bold transition-colors w-fit"
                >
                  Tentar Novamente
                </button>
              )}
            </motion.div>
          )}
        </div>

        {/* Map Area */}
        <div className={`flex-1 relative ${activeTab === 'map' ? 'flex' : 'hidden md:flex'}`}>
          <Map 
            currentLocation={currentLocation}
            destinations={destinations}
            currentStopIndex={currentStopIndex}
            onDestinationSelect={(lat, lng, quickAlarm) => {
              addStop(lat, lng, '', quickAlarm);
            }}
            onRouteInfo={setRouteInfo}
            onRouteCoordinates={setSimulationCoords}
            onRadiusSelect={setRadius}
            radius={radius}
            transportMode={transportMode}
            autoCenter={autoCenter}
            onAutoCenterChange={setAutoCenter}
            simulationCoords={simulationCoords}
          />
          
          {/* Mobile Overlay Info */}
          <div className="absolute bottom-6 left-1/2 -translate-x-1/2 w-[90%] md:hidden pointer-events-none">
             {isAlarmActive && distanceToDest !== null && (
               <div className="bg-white/90 backdrop-blur-md p-4 rounded-2xl shadow-2xl border border-white/20 flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    <Navigation className="w-5 h-5 text-blue-600 animate-pulse" />
                    <div>
                      <p className="text-[10px] uppercase font-bold text-slate-400">Próxima Parada</p>
                      <p className="text-lg font-black text-slate-800">
                        {distanceToDest < 1 ? `${(distanceToDest * 1000).toFixed(0)}m` : `${distanceToDest.toFixed(2)}km`}
                      </p>
                    </div>
                  </div>
                  <div className="text-right">
                    <p className="text-[10px] uppercase font-bold text-slate-400">Gatilho</p>
                    <p className="text-sm font-bold text-blue-600">{radius}m</p>
                  </div>
               </div>
             )}
          </div>
        </div>

        {/* Alarm Triggered Modal */}
        <AnimatePresence>
          {isAlarmTriggered && (
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ 
                opacity: 1,
                backgroundColor: ["rgba(37, 99, 235, 0.9)", "rgba(220, 38, 38, 0.9)", "rgba(37, 99, 235, 0.9)"]
              }}
              transition={{ 
                backgroundColor: { duration: 1, repeat: Infinity, ease: "linear" }
              }}
              exit={{ opacity: 0 }}
              className="fixed inset-0 z-[100] flex items-center justify-center p-6 backdrop-blur-lg"
            >
              <motion.div
                initial={{ scale: 0.9, y: 20 }}
                animate={{ scale: 1, y: 0 }}
                className="bg-white rounded-[40px] p-10 max-w-sm w-full text-center shadow-2xl"
              >
                <div className="relative mb-8 flex justify-center">
                  <div className="absolute inset-0 bg-blue-100 rounded-full animate-ping opacity-50"></div>
                  <div className="relative bg-blue-600 p-6 rounded-full shadow-xl">
                    <Bell className="w-12 h-12 text-white animate-bounce" />
                  </div>
                </div>
                <h2 className="text-3xl font-black text-slate-800 mb-2">Chegando!</h2>
                <p className="text-slate-500 mb-2 leading-relaxed">
                  Você está chegando em:
                </p>
                <p className="text-xl font-black text-blue-600 mb-6 leading-tight">
                  {destinationNames[currentStopIndex]}
                </p>
                <button
                  onClick={stopAlarm}
                  className="w-full py-5 bg-slate-900 text-white rounded-3xl font-black text-xl shadow-xl active:scale-95 transition-transform"
                >
                  {currentStopIndex < destinations.length - 1 ? 'PRÓXIMA PARADA' : 'FINALIZAR ROTA'}
                </button>
              </motion.div>
            </motion.div>
          )}
        </AnimatePresence>
      </main>
    </div>
  );
}
