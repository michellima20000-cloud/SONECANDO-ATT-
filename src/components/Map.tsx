import { MapContainer, TileLayer, Marker, Popup, useMap, useMapEvents, Circle } from 'react-leaflet';
import { useEffect, useState, useRef } from 'react';
import L from 'leaflet';
import 'leaflet-routing-machine';
import { Clock, Navigation, MapPin, Route } from 'lucide-react';

// Fix for default marker icons in Leaflet
import icon from 'leaflet/dist/images/marker-icon.png';
import iconShadow from 'leaflet/dist/images/marker-shadow.png';

let DefaultIcon = L.icon({
  iconUrl: icon,
  shadowUrl: iconShadow,
  iconSize: [25, 41],
  iconAnchor: [12, 41]
});

L.Marker.prototype.options.icon = DefaultIcon;

interface MapProps {
  currentLocation: [number, number] | null;
  destinations: [number, number][];
  onDestinationSelect: (lat: number, lng: number, quickAlarm?: boolean) => void;
  onRadiusSelect?: (radius: number) => void;
  onRouteInfo?: (summary: { totalDistance: number; totalTime: number } | null) => void;
  onRouteCoordinates?: (coords: [number, number][]) => void;
  radius: number; // in meters
  currentStopIndex: number;
  transportMode?: 'car' | 'bus' | 'train';
  autoCenter?: boolean;
  simulationCoords?: [number, number][];
}

function RoutingMachine({ start, waypoints, onRouteInfo, onRouteCoordinates }: { 
  start: [number, number] | null; 
  waypoints: [number, number][]; 
  onRouteInfo?: (summary: { totalDistance: number; totalTime: number } | null) => void;
  onRouteCoordinates?: (coords: [number, number][]) => void;
}) {
  const map = useMap();
  const routingControlRef = useRef<any>(null);
  const [summary, setSummary] = useState<{ totalDistance: number; totalTime: number } | null>(null);

  useEffect(() => {
    if (!map || waypoints.length === 0) {
      if (routingControlRef.current) {
        map.removeControl(routingControlRef.current);
        routingControlRef.current = null;
      }
      setSummary(null);
      if (onRouteInfo) onRouteInfo(null);
      if (onRouteCoordinates) onRouteCoordinates([]);
      return;
    }

    const waypointsList = [];
    if (start) {
      waypointsList.push(L.latLng(start[0], start[1]));
    }
    waypointsList.push(...waypoints.map(w => L.latLng(w[0], w[1])));

    if (waypointsList.length < 2) {
      if (routingControlRef.current) {
        map.removeControl(routingControlRef.current);
        routingControlRef.current = null;
      }
      setSummary(null);
      if (onRouteInfo) onRouteInfo(null);
      if (onRouteCoordinates) onRouteCoordinates([]);
      return;
    }

    if (routingControlRef.current) {
      map.removeControl(routingControlRef.current);
    }

    routingControlRef.current = (L as any).Routing.control({
      waypoints: waypointsList,
      router: (L as any).Routing.osrmv1({
        serviceUrl: 'https://router.project-osrm.org/route/v1'
      }),
      lineOptions: {
        styles: [{ color: '#3b82f6', weight: 6, opacity: 0.8 }],
        extendToWaypoints: true,
        missingRouteTolerance: 0
      },
      show: false,
      addWaypoints: false,
      routeWhileDragging: false,
      fitSelectedRoutes: true,
      showAlternatives: false,
      createMarker: () => null // We handle markers manually
    }).addTo(map);

    routingControlRef.current.on('routesfound', (e: any) => {
      const routes = e.routes;
      const s = routes[0].summary;
      const coords = routes[0].coordinates.map((c: any) => [c.lat, c.lng]);
      
      const summaryData = {
        totalDistance: s.totalDistance,
        totalTime: s.totalTime
      };
      setSummary(summaryData);
      if (onRouteInfo) {
        onRouteInfo(summaryData);
      }
      if (onRouteCoordinates) {
        onRouteCoordinates(coords);
      }
    });

    return () => {
      if (routingControlRef.current) {
        map.removeControl(routingControlRef.current);
      }
    };
  }, [map, start, waypoints, onRouteInfo, onRouteCoordinates]);

  if (!summary) return null;

  const formatTime = (seconds: number) => {
    const h = Math.floor(seconds / 3600);
    const m = Math.floor((seconds % 3600) / 60);
    if (h > 0) return `${h}h ${m}min`;
    return `${m} min`;
  };

  const formatDistance = (meters: number) => {
    if (meters >= 1000) return `${(meters / 1000).toFixed(1)} km`;
    return `${Math.round(meters)} m`;
  };

  return (
    <div className="leaflet-top leaflet-right mt-16 mr-4 z-[1000] pointer-events-none">
      <div className="leaflet-control bg-white/95 backdrop-blur-md p-4 rounded-2xl shadow-2xl border border-white/20 pointer-events-auto min-w-[180px] animate-in fade-in slide-in-from-right-4 duration-500">
        <div className="flex flex-col gap-3">
          <div className="flex items-center justify-between border-b border-slate-100 pb-2">
            <div className="flex items-center gap-2">
              <div className="bg-blue-100 p-1.5 rounded-lg">
                <Route className="w-3.5 h-3.5 text-blue-600" />
              </div>
              <span className="text-[10px] font-bold text-slate-500 uppercase tracking-widest">Detalhes da Rota</span>
            </div>
            <div className="bg-slate-100 px-2 py-0.5 rounded-full">
              <span className="text-[9px] font-bold text-slate-500 uppercase">{waypoints.length} {waypoints.length === 1 ? 'Parada' : 'Paradas'}</span>
            </div>
          </div>
          
          <div className="space-y-3">
            <div className="flex items-center gap-3">
              <div className="bg-slate-50 p-2 rounded-xl border border-slate-100">
                <Navigation className="w-4 h-4 text-blue-500" />
              </div>
              <div className="flex flex-col">
                <span className="text-[9px] font-bold text-slate-400 uppercase leading-none mb-0.5">Distância</span>
                <span className="text-base font-black text-slate-800 leading-none">
                  {formatDistance(summary.totalDistance)}
                </span>
              </div>
            </div>

            <div className="flex items-center gap-3">
              <div className="bg-slate-50 p-2 rounded-xl border border-slate-100">
                <Clock className="w-4 h-4 text-blue-500" />
              </div>
              <div className="flex flex-col">
                <span className="text-[9px] font-bold text-slate-400 uppercase leading-none mb-0.5">Tempo Estimado</span>
                <span className="text-base font-black text-slate-800 leading-none">
                  {formatTime(summary.totalTime)}
                </span>
              </div>
            </div>
          </div>

          <div className="mt-1 pt-2 border-t border-slate-100">
            <div className="flex items-center gap-2 text-[9px] font-medium text-slate-400">
              <div className="w-1.5 h-1.5 rounded-full bg-green-500 animate-pulse"></div>
              <span>Tráfego em tempo real</span>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function MapEvents({ onDestinationSelect, onRadiusSelect }: { 
  onDestinationSelect: (lat: number, lng: number, quickAlarm?: boolean) => void;
  onRadiusSelect?: (lat: number, lng: number) => void;
}) {
  const map = useMap();
  const [pendingLocation, setPendingLocation] = useState<L.LatLng | null>(null);

  useMapEvents({
    click(e) {
      // If user clicks while holding shift, set radius
      if ((e.originalEvent as MouseEvent).shiftKey && onRadiusSelect) {
        onRadiusSelect(e.latlng.lat, e.latlng.lng);
      } else {
        setPendingLocation(e.latlng);
      }
    },
  });

  if (!pendingLocation) return null;

  return (
    <Popup position={pendingLocation} onClose={() => setPendingLocation(null)}>
      <div className="p-2 min-w-[180px]">
        <p className="text-xs font-bold text-slate-700 mb-2">Definir destino?</p>
        <div className="flex flex-col gap-2">
          <button 
            onClick={() => {
              onDestinationSelect(pendingLocation.lat, pendingLocation.lng, true);
              setPendingLocation(null);
            }}
            className="w-full py-2 bg-blue-600 text-white text-[10px] font-bold rounded-lg hover:bg-blue-700 transition-colors flex items-center justify-center gap-2"
          >
            <Navigation className="w-3 h-3" />
            Confirmar e Ativar Alarme
          </button>
          <div className="flex gap-2">
            <button 
              onClick={() => {
                onDestinationSelect(pendingLocation.lat, pendingLocation.lng, false);
                setPendingLocation(null);
              }}
              className="flex-1 py-1.5 bg-slate-100 text-slate-600 text-[10px] font-bold rounded-lg hover:bg-slate-200 transition-colors"
            >
              Só Adicionar
            </button>
            <button 
              onClick={() => setPendingLocation(null)}
              className="flex-1 py-1.5 bg-white border border-slate-200 text-slate-400 text-[10px] font-bold rounded-lg hover:bg-slate-50 transition-colors"
            >
              Cancelar
            </button>
          </div>
        </div>
      </div>
    </Popup>
  );
}

function RecenterMap({ center }: { center: [number, number] | null }) {
  const map = useMap();
  useEffect(() => {
    if (center) {
      map.flyTo(center, map.getZoom(), {
        animate: true,
        duration: 1.5
      });
    }
  }, [center, map]);
  return null;
}

function ResizeHandler() {
  const map = useMap();
  useEffect(() => {
    const timer = setTimeout(() => {
      map.invalidateSize();
    }, 100);
    
    window.addEventListener('resize', () => map.invalidateSize());
    return () => {
      clearTimeout(timer);
      window.removeEventListener('resize', () => map.invalidateSize());
    };
  }, [map]);
  return null;
}

function FollowMarker({ position, enabled }: { position: [number, number] | null, enabled: boolean }) {
  const map = useMap();
  useEffect(() => {
    if (enabled && position) {
      map.flyTo(position, map.getZoom(), {
        animate: true,
        duration: 1
      });
    }
  }, [position, enabled, map]);
  return null;
}

// Helper to calculate a point at a distance and bearing from a center
function getPointAtDistance(center: [number, number], distance: number, bearing: number): [number, number] {
  const R = 6371e3; // Earth radius in meters
  const φ1 = center[0] * Math.PI / 180;
  const λ1 = center[1] * Math.PI / 180;
  const d = distance;
  const brng = bearing * Math.PI / 180;

  const φ2 = Math.asin(Math.sin(φ1) * Math.cos(d / R) +
    Math.cos(φ1) * Math.sin(d / R) * Math.cos(brng));
  const λ2 = λ1 + Math.atan2(Math.sin(brng) * Math.sin(d / R) * Math.cos(φ1),
    Math.cos(d / R) - Math.sin(φ1) * Math.sin(φ2));

  return [φ2 * 180 / Math.PI, λ2 * 180 / Math.PI];
}

function DraggableRadius({ center, radius, onRadiusChange }: { 
  center: [number, number], 
  radius: number, 
  onRadiusChange: (newRadius: number) => void 
}) {
  const handlePos = getPointAtDistance(center, radius, 90); // 90 degrees = East
  
  const markerRef = useRef<L.Marker>(null);
  const eventHandlers = {
    drag() {
      const marker = markerRef.current;
      if (marker != null) {
        const newPos = marker.getLatLng();
        const centerLatLng = L.latLng(center[0], center[1]);
        const newRadius = Math.round(centerLatLng.distanceTo(newPos));
        // Clamp radius between 100m and 5000m
        onRadiusChange(Math.max(100, Math.min(5000, newRadius)));
      }
    },
  };

  const handleIcon = L.divIcon({
    className: 'custom-div-icon',
    html: `
      <div class="w-4 h-4 bg-white border-2 border-blue-600 rounded-full shadow-md cursor-ew-resize flex items-center justify-center">
        <div class="w-1.5 h-1.5 bg-blue-600 rounded-full"></div>
      </div>
    `,
    iconSize: [16, 16],
    iconAnchor: [8, 8]
  });

  return (
    <Marker
      position={handlePos}
      draggable={true}
      eventHandlers={eventHandlers}
      ref={markerRef}
      icon={handleIcon}
    />
  );
}

export default function Map({ currentLocation, destinations, onDestinationSelect, onRadiusSelect, onRouteInfo, onRouteCoordinates, radius, currentStopIndex, transportMode = 'car', autoCenter = true, simulationCoords = [] }: MapProps) {
  const [mapCenter, setMapCenter] = useState<[number, number]>([-23.5505, -46.6333]); // Default to São Paulo

  useEffect(() => {
    if (destinations.length > 0) {
      const lastDest = destinations[destinations.length - 1];
      setMapCenter(lastDest);
    } else if (currentLocation) {
      setMapCenter(currentLocation);
    }
  }, [destinations.length, currentLocation]);

  const activeDest = destinations[currentStopIndex];

  const isTransportMode = transportMode === 'bus' || transportMode === 'train';

  return (
    <div className="h-full w-full rounded-xl overflow-hidden shadow-lg border border-slate-200 relative">
      <MapContainer 
        center={mapCenter} 
        zoom={13} 
        style={{ height: '100%', width: '100%' }}
        scrollWheelZoom={true}
      >
        <TileLayer
          attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
          url={isTransportMode 
            ? "https://{s}.tile.memomaps.de/tilegen/{z}/{x}/{y}.png"
            : "https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
          }
        />
        
        {currentLocation && (
          <Marker 
            position={currentLocation}
            icon={L.divIcon({
              className: 'custom-div-icon',
              html: `
                <div class="relative">
                  <div class="absolute -top-4 -left-4 w-8 h-8 ${isTransportMode ? 'bg-amber-600' : 'bg-blue-600'} rounded-full border-2 border-white shadow-lg flex items-center justify-center text-white">
                    ${transportMode === 'bus' ? '<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M19 17h2c.6 0 1-.4 1-1v-3c0-.9-.7-1.7-1.5-1.9C18.7 10.7 16 10 16 10V4c0-1.1-.9-2-2-2H6c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h0c1.1 0 2-.9 2-2v-2h8v2c0 1.1.9 2 2 2h0c1.1 0 2-.9 2-2v-1z"/><path d="M14 6H6"/><path d="M14 10H6"/><path d="M8 14h0"/><path d="M14 14h0"/></svg>' : 
                      transportMode === 'train' ? '<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect width="16" height="16" x="4" y="3" rx="2"/><path d="M4 11h16"/><path d="M12 3v8"/><path d="M8 19l-2 3"/><path d="M16 19l2 3"/></svg>' : 
                      '<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><circle cx="12" cy="12" r="3"/></svg>'}
                  </div>
                  <div class="absolute -top-4 -left-4 w-8 h-8 ${isTransportMode ? 'bg-amber-600' : 'bg-blue-600'} rounded-full animate-ping opacity-20"></div>
                </div>
              `,
              iconSize: [0, 0],
              iconAnchor: [0, 0]
            })}
          >
            <Popup>Sua localização atual</Popup>
          </Marker>
        )}

        {destinations.map((dest, index) => {
          const isActive = index === currentStopIndex;
          const customIcon = L.divIcon({
            className: 'custom-div-icon',
            html: `
              <div class="relative flex items-center justify-center">
                ${isActive ? '<div class="absolute w-8 h-8 bg-blue-500/20 rounded-full animate-ping"></div>' : ''}
                <div class="w-6 h-6 ${isActive ? 'bg-blue-600' : 'bg-slate-400'} text-white rounded-full border-2 border-white shadow-md flex items-center justify-center text-[10px] font-bold z-10">
                  ${index + 1}
                </div>
              </div>
            `,
            iconSize: [24, 24],
            iconAnchor: [12, 12]
          });

          return (
            <Marker 
              key={`${dest[0]}-${dest[1]}-${index}`} 
              position={dest} 
              icon={customIcon}
            >
              <Popup>{isActive ? 'Próxima Parada' : `Parada ${index + 1}`}</Popup>
            </Marker>
          );
        })}

        {activeDest && (
          <>
            <Circle 
              center={activeDest} 
              radius={radius} 
              pathOptions={{ 
                color: '#3b82f6', 
                fillColor: '#3b82f6', 
                fillOpacity: 0.5,
                weight: 1,
                className: 'animate-circle-pulse'
              }} 
            />
            {onRadiusSelect && (
              <DraggableRadius 
                center={activeDest} 
                radius={radius} 
                onRadiusChange={(newRadius) => onRadiusSelect(newRadius)} 
              />
            )}
          </>
        )}

        <RoutingMachine 
          start={currentLocation} 
          waypoints={destinations} 
          onRouteInfo={onRouteInfo} 
          onRouteCoordinates={(coords) => {
            if (onRouteCoordinates) onRouteCoordinates(coords);
            // We could also generate "stops" here if we wanted to visualize them
          }}
        />
        
        {/* Visualizing "Stops" along the route (simulated) */}
        {simulationCoords.length > 0 && simulationCoords.map((coord, idx) => {
          // Only show every 20th point as a "stop" to avoid clutter
          if (idx % 20 !== 0 || idx === 0 || idx === simulationCoords.length - 1) return null;
          
          const distToDest = activeDest ? L.latLng(coord[0], coord[1]).distanceTo(L.latLng(activeDest[0], activeDest[1])) : Infinity;
          const isInActivationZone = distToDest <= radius;

          return (
            <Circle 
              key={`stop-${idx}`}
              center={coord}
              radius={isInActivationZone ? 8 : 5}
              pathOptions={{ 
                color: isInActivationZone ? '#ef4444' : '#94a3b8', 
                fillColor: isInActivationZone ? '#ef4444' : '#94a3b8', 
                fillOpacity: 0.8, 
                weight: 1 
              }}
            >
              <Popup>
                <p className="text-[10px] font-bold">{isInActivationZone ? 'Zona de Alarme' : 'Ponto de Passagem'}</p>
                <p className="text-[9px] text-slate-500">~{Math.round(distToDest)}m do destino</p>
              </Popup>
            </Circle>
          );
        })}

        <MapEvents 
          onDestinationSelect={onDestinationSelect} 
          onRadiusSelect={(lat, lng) => {
            if (onRadiusSelect && destinations[currentStopIndex]) {
              const target = destinations[currentStopIndex];
              const dist = L.latLng(lat, lng).distanceTo(L.latLng(target[0], target[1]));
              onRadiusSelect(Math.round(dist));
            }
          }} 
        />
        <RecenterMap center={mapCenter} />
        <ResizeHandler />
        <FollowMarker position={currentLocation} enabled={autoCenter} />
      </MapContainer>
    </div>
  );
}
