import { useMemo, useRef, useState, useEffect } from 'react';
import { ChevronDown, Search, X } from 'lucide-react';
import { COUNTRIES, COUNTRY_BY_CODE, countryFlagEmoji } from '../data/countries';

interface CountrySelectorProps {
  selectedCodes: string[];
  onToggleCountry: (code: string) => void;
  maxCountries?: number;
}

export function CountrySelector({
  selectedCodes,
  onToggleCountry,
  maxCountries = 4,
}: CountrySelectorProps) {
  const [open, setOpen] = useState(false);
  const [filterText, setFilterText] = useState('');
  const [regionFilter, setRegionFilter] = useState<string>('All');
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function handleOutsideClick(e: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener('mousedown', handleOutsideClick);
    return () => document.removeEventListener('mousedown', handleOutsideClick);
  }, []);

  const filteredCountries = useMemo(() => {
    const q = filterText.trim().toLowerCase();
    return COUNTRIES.filter((c) => {
      if (regionFilter !== 'All' && c.region !== regionFilter) return false;
      if (!q) return true;
      return (
        c.name.toLowerCase().includes(q) ||
        c.capital.toLowerCase().includes(q) ||
        c.code.toLowerCase() === q
      );
    });
  }, [filterText, regionFilter]);

  return (
    <div ref={containerRef} className="relative space-y-2.5">
      <div className="flex items-center justify-between gap-2">
        <label className="text-xs font-medium tracking-wide text-[#57534E] dark:text-[#B8B2A6]">
          Countries ({selectedCodes.length}/{maxCountries} selected)
        </label>
      </div>

      {/* Trigger Dropdown Button */}
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="w-full flex items-center justify-between gap-3 px-3.5 py-2.5 text-sm bg-[#FBF9F5] dark:bg-[#141311] border border-[#D6CEBE] dark:border-[#3A3630] rounded-lg text-[#1C1917] dark:text-[#F5F2EB] hover:border-[#1E3A8A] dark:hover:border-[#60A5FA] transition-colors duration-150 cursor-pointer text-left"
      >
        <span className="truncate">
          {selectedCodes.length === 0
            ? 'Search and select countries...'
            : selectedCodes
                .map((code) => {
                  const c = COUNTRY_BY_CODE.get(code);
                  return c ? `${countryFlagEmoji(c.code)} ${c.name}` : code;
                })
                .join('  vs.  ')}
        </span>
        <ChevronDown
          className={`w-4 h-4 text-[#78716C] dark:text-[#9A9388] shrink-0 transition-transform duration-150 ${
            open ? 'rotate-180' : ''
          }`}
        />
      </button>

      {/* Selected Country Removable Controls */}
      {selectedCodes.length > 0 && (
        <div className="flex flex-wrap items-center gap-2">
          {selectedCodes.map((code) => {
            const country = COUNTRY_BY_CODE.get(code);
            if (!country) return null;
            return (
              <button
                key={code}
                type="button"
                onClick={() => onToggleCountry(code)}
                className="inline-flex items-center gap-1.5 px-2.5 py-1 text-xs font-medium bg-[#F3EFE7] dark:bg-[#22201D] border border-[#D6CEBE] dark:border-[#3A3630] rounded-md text-[#1C1917] dark:text-[#F5F2EB] hover:bg-[#E5DFD3] dark:hover:bg-[#2E2B27] transition-colors duration-150 cursor-pointer whitespace-nowrap shrink-0"
                title={`Remove ${country.name}`}
              >
                <span>{countryFlagEmoji(country.code)}</span>
                <span>{country.name}</span>
                <X className="w-3 h-3 text-[#78716C] dark:text-[#9A9388]" />
              </button>
            );
          })}
        </div>
      )}

      {/* Searchable Dropdown Panel */}
      {open && (
        <div className="absolute left-0 right-0 z-30 mt-1 border border-[#D6CEBE] dark:border-[#3A3630] rounded-lg bg-[#FFFFFF] dark:bg-[#191816] shadow-lg overflow-hidden">
          <div className="p-3 border-b border-[#E5DFD3] dark:border-[#2C2925] space-y-2.5">
            <div className="relative">
              <Search className="w-3.5 h-3.5 text-[#78716C] dark:text-[#9A9388] absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
              <input
                type="text"
                value={filterText}
                onChange={(e) => setFilterText(e.target.value)}
                placeholder="Filter by country name, capital, or ISO code..."
                autoFocus
                className="w-full pl-8 pr-3 py-1.5 text-xs bg-[#FBF9F5] dark:bg-[#141311] border border-[#D6CEBE] dark:border-[#3A3630] rounded-md text-[#1C1917] dark:text-[#F5F2EB] placeholder:text-[#78716C] dark:placeholder:text-[#8A8378] focus:outline-none focus:border-[#1E3A8A] dark:focus:border-[#60A5FA]"
              />
            </div>

            <div className="flex flex-wrap items-center gap-1">
              {['All', 'Africa', 'Americas', 'Asia', 'Europe', 'Oceania'].map((reg) => (
                <button
                  key={reg}
                  type="button"
                  onClick={() => setRegionFilter(reg)}
                  className={`px-2.5 py-1 text-[11px] font-medium rounded-md transition-colors duration-150 cursor-pointer whitespace-nowrap shrink-0 ${
                    regionFilter === reg
                      ? 'bg-[#1C1917] dark:bg-[#F5F2EB] text-[#FBF9F5] dark:text-[#111110]'
                      : 'bg-[#F3EFE7] dark:bg-[#22201D] text-[#57534E] dark:text-[#B8B2A6] hover:text-[#1C1917] dark:hover:text-[#F5F2EB]'
                  }`}
                >
                  {reg}
                </button>
              ))}
            </div>
          </div>

          <ul className="max-h-64 overflow-y-auto divide-y divide-[#F3EFE7] dark:divide-[#24221E]">
            {filteredCountries.length === 0 ? (
              <li className="px-4 py-4 text-xs text-[#78716C] dark:text-[#9A9388]">
                No matching countries found.
              </li>
            ) : (
              filteredCountries.map((country) => {
                const isSelected = selectedCodes.includes(country.code);
                const disabled = !isSelected && selectedCodes.length >= maxCountries;
                return (
                  <li key={country.code}>
                    <button
                      type="button"
                      disabled={disabled}
                      onClick={() => onToggleCountry(country.code)}
                      className={`w-full px-3.5 py-2 text-left text-xs flex items-center justify-between gap-3 transition-colors duration-150 cursor-pointer ${
                        isSelected
                          ? 'bg-[#1E3A8A]/10 dark:bg-[#60A5FA]/15 text-[#1E3A8A] dark:text-[#93C5FD] font-semibold'
                          : disabled
                            ? 'opacity-40 cursor-not-allowed text-[#78716C]'
                            : 'hover:bg-[#FBF9F5] dark:hover:bg-[#22201D] text-[#1C1917] dark:text-[#F5F2EB]'
                      }`}
                    >
                      <span className="flex items-center gap-2 min-w-0">
                        <span className="text-base leading-none">{countryFlagEmoji(country.code)}</span>
                        <span className="truncate">{country.name}</span>
                        <span className="text-[#78716C] dark:text-[#8A8378] font-normal truncate">
                          · {country.capital}
                        </span>
                      </span>
                      <span className="font-mono text-[11px] text-[#78716C] dark:text-[#8A8378] shrink-0">
                        {isSelected ? 'Selected' : country.region}
                      </span>
                    </button>
                  </li>
                );
              })
            )}
          </ul>
        </div>
      )}
    </div>
  );
}
