import { useEffect, useMemo, useRef, useState } from 'react';
import { geoGraticule10, geoNaturalEarth1, geoOrthographic, geoPath, type GeoPermissibleObjects } from 'd3-geo';
import { feature } from 'topojson-client';
import type { Topology, GeometryCollection } from 'topojson-specification';
import worldAtlas from 'world-atlas/countries-110m.json';
import { Globe, Map as MapIcon, RotateCcw, ZoomIn, ZoomOut } from 'lucide-react';
import {
  COUNTRIES,
  COUNTRY_BY_CODE,
  COUNTRY_BY_NUMERIC_ID,
  countryFlagEmoji,
  type CountryEntry,
} from '../data/countries';

interface InteractiveGlobeProps {
  selectedCodes: string[];
  onToggleCountry: (code: string) => void;
  isDark: boolean;
}

const SELECTION_COLORS_LIGHT = ['#1E3A8A', '#9A3412', '#14532D', '#78350F'];
const SELECTION_COLORS_DARK = ['#3B82F6', '#EA580C', '#16A34A', '#D97706'];

export function InteractiveGlobe({ selectedCodes, onToggleCountry, isDark }: InteractiveGlobeProps) {
  const [mode, setMode] = useState<'globe' | 'flat'>('globe');
  const [rotation, setRotation] = useState<[number, number, number]>([-15, -18, 0]);
  const [zoom, setZoom] = useState(1);
  const [hoveredCountry, setHoveredCountry] = useState<CountryEntry | null>(null);
  const draggingRef = useRef<{ active: boolean; x: number; y: number; moved: boolean }>({
    active: false,
    x: 0,
    y: 0,
    moved: false,
  });

  const width = 540;
  const height = 400;
  const palette = isDark ? SELECTION_COLORS_DARK : SELECTION_COLORS_LIGHT;

  const countryFeatures = useMemo(() => {
    const topology = worldAtlas as unknown as Topology<{
      countries: GeometryCollection<{ name: string }>;
    }>;
    const geo = feature(topology, topology.objects.countries);
    return geo.features.map((f) => {
      const idStr = String(f.id ?? '').padStart(3, '0');
      const matched = COUNTRY_BY_NUMERIC_ID.get(idStr) ?? null;
      return { feature: f, idStr, country: matched };
    });
  }, []);

  // Orient globe smoothly toward the latest selected country
  useEffect(() => {
    if (selectedCodes.length === 0) return;
    const latest = COUNTRY_BY_CODE.get(selectedCodes[selectedCodes.length - 1]);
    if (latest) {
      setRotation([-latest.lon, Math.max(-55, Math.min(55, -latest.lat * 0.7)), 0]);
    }
  }, [selectedCodes]);

  const { projection, pathGen, spherePath, graticulePath } = useMemo(() => {
    const proj =
      mode === 'globe'
        ? geoOrthographic()
            .scale(170 * zoom)
            .translate([width / 2, height / 2])
            .clipAngle(90)
            .rotate(rotation)
        : geoNaturalEarth1()
            .scale(98 * zoom)
            .translate([width / 2, height / 2 + 8]);

    const pg = geoPath(proj);
    return {
      projection: proj,
      pathGen: pg,
      spherePath: pg({ type: 'Sphere' }) ?? '',
      graticulePath: pg(geoGraticule10()) ?? '',
    };
  }, [mode, rotation, zoom]);

  function handlePointerDown(e: React.PointerEvent<SVGSVGElement>) {
    if (mode !== 'globe') return;
    draggingRef.current = { active: true, x: e.clientX, y: e.clientY, moved: false };
  }

  function handlePointerMove(e: React.PointerEvent<SVGSVGElement>) {
    if (!draggingRef.current.active || mode !== 'globe') return;
    const dx = e.clientX - draggingRef.current.x;
    const dy = e.clientY - draggingRef.current.y;
    if (Math.abs(dx) > 3 || Math.abs(dy) > 3) {
      draggingRef.current.moved = true;
    }
    draggingRef.current.x = e.clientX;
    draggingRef.current.y = e.clientY;
    setRotation(([lambda, phi, gamma]) => [
      lambda + dx * 0.45,
      Math.max(-75, Math.min(75, phi - dy * 0.45)),
      gamma,
    ]);
  }

  function handlePointerUp() {
    draggingRef.current.active = false;
  }

  const selectedMarkers = useMemo(() => {
    return selectedCodes
      .map((code, idx) => {
        const c = COUNTRY_BY_CODE.get(code);
        if (!c) return null;
        if (mode === 'globe') {
          const [lambda, phi] = rotation;
          const dLon = ((c.lon + lambda) * Math.PI) / 180;
          const lat1 = (c.lat * Math.PI) / 180;
          const lat0 = (-phi * Math.PI) / 180;
          const cosC = Math.sin(lat0) * Math.sin(lat1) + Math.cos(lat0) * Math.cos(lat1) * Math.cos(dLon);
          if (cosC < 0) return null;
        }
        const pt = projection([c.lon, c.lat]);
        if (!pt) return null;
        return {
          country: c,
          x: pt[0],
          y: pt[1],
          color: palette[idx % palette.length],
        };
      })
      .filter((m): m is NonNullable<typeof m> => Boolean(m));
  }, [selectedCodes, projection, mode, rotation, palette]);

  const sphereFill = isDark ? '#181715' : '#EAE3D3';
  const sphereStroke = isDark ? '#3A3630' : '#C8BFA9';
  const graticuleStroke = isDark ? '#262420' : '#DCD3C1';
  const landBase = isDark ? '#2B2823' : '#DDD5C3';
  const landHover = isDark ? '#3F3A33' : '#C8BFA9';
  const landStroke = isDark ? '#111110' : '#FBF9F5';

  return (
    <div className="border border-[#E5DFD3] dark:border-[#2C2925] rounded-xl bg-[#FFFFFF] dark:bg-[#191816] overflow-hidden transition-colors duration-200">
      <div className="flex flex-wrap items-center justify-between gap-2 px-4 py-2.5 border-b border-[#E5DFD3] dark:border-[#2C2925] bg-[#F3EFE7]/70 dark:bg-[#22201D]/80">
        <div className="text-xs text-[#57534E] dark:text-[#B8B2A6]">
          <span className="font-medium text-[#1C1917] dark:text-[#F5F2EB]">
            {mode === 'globe' ? '3D Globe' : 'World Map'}
          </span>
          <span className="mx-2" aria-hidden="true">·</span>
          <span>{mode === 'globe' ? 'Drag to rotate, click to select' : 'Click any country'}</span>
        </div>

        <div className="flex items-center gap-1.5">
          <button
            type="button"
            onClick={() => setMode((m) => (m === 'globe' ? 'flat' : 'globe'))}
            className="inline-flex items-center gap-1.5 px-2.5 py-1 text-xs font-medium bg-[#FFFFFF] dark:bg-[#141311] border border-[#D6CEBE] dark:border-[#3A3630] rounded-md text-[#1C1917] dark:text-[#F5F2EB] hover:bg-[#F3EFE7] dark:hover:bg-[#2C2925] transition-colors duration-150 cursor-pointer whitespace-nowrap shrink-0"
          >
            {mode === 'globe' ? <MapIcon className="w-3.5 h-3.5" /> : <Globe className="w-3.5 h-3.5" />}
            {mode === 'globe' ? 'Flat Map' : '3D Globe'}
          </button>
          <button
            type="button"
            onClick={() => setZoom((z) => Math.min(2.2, +(z + 0.2).toFixed(1)))}
            aria-label="Zoom in"
            className="p-1.5 bg-[#FFFFFF] dark:bg-[#141311] border border-[#D6CEBE] dark:border-[#3A3630] rounded-md text-[#57534E] dark:text-[#B8B2A6] hover:text-[#1C1917] dark:hover:text-[#F5F2EB] transition-colors cursor-pointer"
          >
            <ZoomIn className="w-3.5 h-3.5" />
          </button>
          <button
            type="button"
            onClick={() => setZoom((z) => Math.max(0.8, +(z - 0.2).toFixed(1)))}
            aria-label="Zoom out"
            className="p-1.5 bg-[#FFFFFF] dark:bg-[#141311] border border-[#D6CEBE] dark:border-[#3A3630] rounded-md text-[#57534E] dark:text-[#B8B2A6] hover:text-[#1C1917] dark:hover:text-[#F5F2EB] transition-colors cursor-pointer"
          >
            <ZoomOut className="w-3.5 h-3.5" />
          </button>
          <button
            type="button"
            onClick={() => {
              setZoom(1);
              setRotation([-15, -18, 0]);
            }}
            aria-label="Reset globe view"
            className="p-1.5 bg-[#FFFFFF] dark:bg-[#141311] border border-[#D6CEBE] dark:border-[#3A3630] rounded-md text-[#57534E] dark:text-[#B8B2A6] hover:text-[#1C1917] dark:hover:text-[#F5F2EB] transition-colors cursor-pointer"
          >
            <RotateCcw className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>

      <div className="relative bg-[#F7F3EA] dark:bg-[#141311] transition-colors duration-200">
        <svg
          viewBox={`0 0 ${width} ${height}`}
          className={`w-full h-auto block select-none ${
            mode === 'globe' ? 'cursor-grab active:cursor-grabbing' : 'cursor-pointer'
          }`}
          onPointerDown={handlePointerDown}
          onPointerMove={handlePointerMove}
          onPointerUp={handlePointerUp}
          onPointerLeave={handlePointerUp}
          role="img"
          aria-label="Interactive globe for selecting historical countries"
        >
          <path d={spherePath} fill={sphereFill} stroke={sphereStroke} strokeWidth={1.2} />
          <path d={graticulePath} fill="none" stroke={graticuleStroke} strokeWidth={0.6} />

          {countryFeatures.map(({ feature: feat, idStr, country }) => {
            const d = pathGen(feat as unknown as GeoPermissibleObjects) ?? '';
            if (!d) return null;
            const selectedIndex = country ? selectedCodes.indexOf(country.code) : -1;
            const isSelected = selectedIndex >= 0;
            const isHovered = country && hoveredCountry?.code === country.code;
            const fill = isSelected
              ? palette[selectedIndex % palette.length]
              : isHovered
                ? landHover
                : landBase;

            return (
              <path
                key={`${idStr}-${feat.properties?.name}`}
                d={d}
                fill={fill}
                fillOpacity={isSelected ? 0.88 : 0.94}
                stroke={landStroke}
                strokeWidth={isSelected ? 1.1 : 0.55}
                className={country ? 'cursor-pointer transition-colors duration-100' : ''}
                onMouseEnter={() => {
                  if (country) setHoveredCountry(country);
                }}
                onMouseLeave={() => setHoveredCountry(null)}
                onClick={() => {
                  if (draggingRef.current.moved) return;
                  if (country) onToggleCountry(country.code);
                }}
              />
            );
          })}

          {selectedMarkers.map(({ country, x, y, color }) => (
            <g key={country.code} transform={`translate(${x}, ${y})`} className="pointer-events-none">
              <circle r={4.5} fill={isDark ? '#111110' : '#FFFFFF'} stroke={color} strokeWidth={2.2} />
              <text
                x={8}
                y={4}
                className="text-[11px] font-semibold"
                fill={isDark ? '#F5F2EB' : '#1C1917'}
                style={{
                  paintOrder: 'stroke',
                  stroke: isDark ? '#111110' : '#FBF9F5',
                  strokeWidth: 3,
                }}
              >
                {country.name}
              </text>
            </g>
          ))}
        </svg>

        {hoveredCountry && (
          <div className="pointer-events-none absolute bottom-12 left-3 bg-[#1C1917] dark:bg-[#F5F2EB] text-[#FBF9F5] dark:text-[#111110] px-3 py-1.5 rounded-md text-xs shadow-sm">
            <span className="mr-1.5">{countryFlagEmoji(hoveredCountry.code)}</span>
            <span className="font-medium">{hoveredCountry.name}</span>
            <span className="opacity-75 ml-2">
              {selectedCodes.includes(hoveredCountry.code) ? 'Click to remove' : 'Click to select'}
            </span>
          </div>
        )}

        <div className="px-4 py-2.5 border-t border-[#E5DFD3] dark:border-[#2C2925] bg-[#FFFFFF] dark:bg-[#191816] flex flex-wrap items-center justify-between gap-2 text-xs text-[#57534E] dark:text-[#B8B2A6]">
          <span>{COUNTRIES.length} nations indexed</span>
          <div className="flex flex-wrap items-center gap-3">
            {selectedCodes.map((code, idx) => {
              const c = COUNTRY_BY_CODE.get(code);
              if (!c) return null;
              return (
                <button
                  key={code}
                  type="button"
                  onClick={() =>
                    setRotation([-c.lon, Math.max(-55, Math.min(55, -c.lat * 0.7)), 0])
                  }
                  className="inline-flex items-center gap-1.5 text-xs font-medium text-[#1C1917] dark:text-[#F5F2EB] hover:underline cursor-pointer"
                >
                  <span
                    className="w-2.5 h-2.5 rounded-sm inline-block"
                    style={{ backgroundColor: palette[idx % palette.length] }}
                  />
                  <span>{countryFlagEmoji(c.code)}</span>
                  <span>{c.name}</span>
                </button>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
}
