import { useEffect, useState } from 'react';
import { motion } from 'motion/react';
import {
  Calendar,
  ExternalLink,
  GitCompare,
  Loader2,
  MapPin,
  Search,
  Sparkles,
} from 'lucide-react';
import type {
  CountryComparisonAnalysis,
  CountryEventRecord,
  CountryHistoryBundle,
  CountryHistoryResponse,
  EpistemicTier,
} from '../types/history';
import { ArchivalImage } from './ArchivalImage';
import { CountrySelector } from './CountrySelector';
import { InteractiveGlobe } from './InteractiveGlobe';

interface CountryExplorerWorkspaceProps {
  isDark: boolean;
}

const HISTORICAL_EXAMPLES = [
  {
    label: 'Ethiopia & United States · Nov 19, 1975',
    year: 1975,
    month: 11,
    day: 19,
    countries: ['ET', 'US'],
  },
  {
    label: 'Germany & United States · Nov 9, 1989',
    year: 1989,
    month: 11,
    day: 9,
    countries: ['DE', 'US'],
  },
  {
    label: 'India & United Kingdom · Aug 15, 1947',
    year: 1947,
    month: 8,
    day: 15,
    countries: ['IN', 'GB'],
  },
  {
    label: 'France & United States · Jul 4, 1776',
    year: 1776,
    month: 7,
    day: 4,
    countries: ['FR', 'US'],
  },
];

const MONTHS = [
  'January',
  'February',
  'March',
  'April',
  'May',
  'June',
  'July',
  'August',
  'September',
  'October',
  'November',
  'December',
];

function pad2(n: number): string {
  return String(n).padStart(2, '0');
}

function tierLabel(tier: EpistemicTier): string {
  if (tier === 'exact_date') return 'Exact Date';
  if (tier === 'around_date') return 'Around Date';
  return 'Background';
}

function tierColorClass(tier: EpistemicTier): string {
  if (tier === 'exact_date') return 'text-[#14532D] dark:text-[#4ADE80]';
  if (tier === 'around_date') return 'text-[#9A3412] dark:text-[#EA8C55]';
  return 'text-[#1E3A8A] dark:text-[#60A5FA]';
}

export function CountryExplorerWorkspace({ isDark }: CountryExplorerWorkspaceProps) {
  const [year, setYear] = useState(1975);
  const [month, setMonth] = useState(11);
  const [day, setDay] = useState(19);
  const [selectedCodes, setSelectedCodes] = useState<string[]>(['ET', 'US']);

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<CountryHistoryResponse | null>(null);

  const [tierFilter, setTierFilter] = useState<'all' | EpistemicTier>('all');
  const [viewMode, setViewMode] = useState<'comparison' | 'timeline'>('comparison');

  const [analysis, setAnalysis] = useState<CountryComparisonAnalysis | null>(null);
  const [analyzing, setAnalyzing] = useState(false);
  const [analysisError, setAnalysisError] = useState<string | null>(null);

  const dateInputValue =
    year >= 1000 && year <= 2026
      ? `${String(year).padStart(4, '0')}-${pad2(month)}-${pad2(day)}`
      : '';

  function handleCalendarChange(val: string) {
    const match = val.match(/^(\d{4})-(\d{2})-(\d{2})$/);
    if (!match) return;
    setYear(Number.parseInt(match[1], 10));
    setMonth(Number.parseInt(match[2], 10));
    setDay(Number.parseInt(match[3], 10));
  }

  function handleToggleCountry(code: string) {
    setSelectedCodes((prev) => {
      if (prev.includes(code)) {
        return prev.length > 1 ? prev.filter((c) => c !== code) : prev;
      }
      if (prev.length >= 4) {
        return [...prev.slice(1), code];
      }
      return [...prev, code];
    });
  }

  async function runExplore(
    y = year,
    m = month,
    d = day,
    codes = selectedCodes
  ) {
    if (codes.length === 0) return;
    setLoading(true);
    setError(null);
    setAnalysis(null);
    setAnalysisError(null);

    try {
      const res = await fetch('/api/country-history', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ year: y, month: m, day: d, countries: codes }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to retrieve historical records');
      setResult(data as CountryHistoryResponse);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to fetch country history');
    } finally {
      setLoading(false);
    }
  }

  async function runComparisonSynthesis() {
    if (!result || result.countries.length === 0) return;
    setAnalyzing(true);
    setAnalysisError(null);
    try {
      const res = await fetch('/api/assistant/country-compare', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          dateDisplay: result.dateDisplay,
          countries: result.countries,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Comparative analysis failed');
      setAnalysis(data as CountryComparisonAnalysis);
    } catch (err) {
      setAnalysisError(err instanceof Error ? err.message : 'Comparative analysis failed');
    } finally {
      setAnalyzing(false);
    }
  }

  useEffect(() => {
    runExplore(1975, 11, 19, ['ET', 'US']);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function filterCountryEvents(bundle: CountryHistoryBundle): CountryEventRecord[] {
    if (tierFilter === 'exact_date') return bundle.exactDateEvents;
    if (tierFilter === 'around_date') return bundle.aroundDateEvents;
    if (tierFilter === 'historical_background') return bundle.backgroundEvents;
    return [
      ...bundle.exactDateEvents,
      ...bundle.aroundDateEvents,
      ...bundle.backgroundEvents,
    ];
  }

  const allTimelineEvents =
    result?.countries
      .flatMap((c) => filterCountryEvents(c))
      .sort((a, b) => a.sortDateValue - b.sortDateValue) ?? [];

  return (
    <div className="space-y-12">
      {/* Minimalist Hero + Date / Country / Globe Workbench */}
      <section
        id="explorer"
        className="grid grid-cols-1 lg:grid-cols-12 gap-8 items-start pb-12 border-b border-[#E5DFD3] dark:border-[#2C2925]"
      >
        <div className="lg:col-span-6 space-y-6">
          <div className="space-y-3">
            <h1 className="font-serif text-4xl lg:text-[42px] font-semibold text-[#1C1917] dark:text-[#F5F2EB] leading-[1.12] text-balance">
              Explore any historical date across nations side by side.
            </h1>
            <p className="text-[15px] text-[#57534E] dark:text-[#B8B2A6] leading-relaxed max-w-xl">
              Select a date and pick one or more countries from the searchable list or 3D globe to compare verified historical records from open archives.
            </p>
          </div>

          <form
            onSubmit={(e) => {
              e.preventDefault();
              runExplore();
            }}
            className="border border-[#E5DFD3] dark:border-[#2C2925] rounded-xl bg-[#FFFFFF] dark:bg-[#191816] p-5 space-y-5 transition-colors duration-200"
          >
            {/* Date Picker Controls */}
            <div className="space-y-2">
              <label className="text-xs font-medium tracking-wide text-[#57534E] dark:text-[#B8B2A6] flex items-center gap-1.5">
                <Calendar className="w-3.5 h-3.5 text-[#9A3412] dark:text-[#EA8C55]" />
                Historical Date
              </label>

              <div className="grid grid-cols-1 sm:grid-cols-4 gap-2.5">
                <input
                  type="date"
                  value={dateInputValue}
                  onChange={(e) => handleCalendarChange(e.target.value)}
                  aria-label="Calendar date picker"
                  className="sm:col-span-2 px-3 py-2 text-sm font-mono tabular-nums bg-[#FBF9F5] dark:bg-[#141311] border border-[#D6CEBE] dark:border-[#3A3630] rounded-lg text-[#1C1917] dark:text-[#F5F2EB] focus:outline-none focus:border-[#1E3A8A] dark:focus:border-[#60A5FA] transition-colors"
                />
                <select
                  value={month}
                  onChange={(e) => setMonth(Number(e.target.value))}
                  aria-label="Month"
                  className="px-2.5 py-2 text-sm bg-[#FBF9F5] dark:bg-[#141311] border border-[#D6CEBE] dark:border-[#3A3630] rounded-lg text-[#1C1917] dark:text-[#F5F2EB] focus:outline-none focus:border-[#1E3A8A] dark:focus:border-[#60A5FA]"
                >
                  {MONTHS.map((mName, idx) => (
                    <option key={mName} value={idx + 1}>
                      {mName}
                    </option>
                  ))}
                </select>
                <div className="flex gap-2">
                  <input
                    type="number"
                    min={1}
                    max={31}
                    value={day}
                    onChange={(e) => setDay(Math.max(1, Math.min(31, Number(e.target.value) || 1)))}
                    aria-label="Day"
                    className="w-16 px-2.5 py-2 text-sm font-mono tabular-nums bg-[#FBF9F5] dark:bg-[#141311] border border-[#D6CEBE] dark:border-[#3A3630] rounded-lg text-[#1C1917] dark:text-[#F5F2EB] focus:outline-none focus:border-[#1E3A8A] dark:focus:border-[#60A5FA]"
                  />
                  <input
                    type="number"
                    min={-3000}
                    max={2026}
                    value={year}
                    onChange={(e) => setYear(Number.parseInt(e.target.value, 10) || 1975)}
                    aria-label="Year"
                    placeholder="Year"
                    className="flex-1 min-w-[76px] px-2.5 py-2 text-sm font-mono tabular-nums bg-[#FBF9F5] dark:bg-[#141311] border border-[#D6CEBE] dark:border-[#3A3630] rounded-lg text-[#1C1917] dark:text-[#F5F2EB] focus:outline-none focus:border-[#1E3A8A] dark:focus:border-[#60A5FA]"
                  />
                </div>
              </div>
            </div>

            {/* Searchable Multi-Country Dropdown */}
            <CountrySelector
              selectedCodes={selectedCodes}
              onToggleCountry={handleToggleCountry}
              maxCountries={4}
            />

            {/* Primary Search & Compare Actions */}
            <div className="flex flex-wrap items-center gap-3 pt-1">
              <button
                type="submit"
                disabled={loading || selectedCodes.length === 0}
                className="inline-flex items-center justify-center gap-2 px-5 py-2.5 text-sm font-medium rounded-lg bg-[#1E3A8A] dark:bg-[#2563EB] text-white hover:bg-[#172D6B] dark:hover:bg-[#1D4ED8] disabled:opacity-50 transition-colors duration-150 cursor-pointer whitespace-nowrap shrink-0"
              >
                {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Search className="w-4 h-4" />}
                Explore Date
              </button>

              {result && (
                <button
                  type="button"
                  onClick={() => runComparisonSynthesis()}
                  disabled={analyzing}
                  className="inline-flex items-center justify-center gap-2 px-4 py-2.5 text-sm font-medium rounded-lg border border-[#D6CEBE] dark:border-[#3A3630] bg-[#FBF9F5] dark:bg-[#141311] text-[#1C1917] dark:text-[#F5F2EB] hover:bg-[#F3EFE7] dark:hover:bg-[#22201D] disabled:opacity-50 transition-colors duration-150 cursor-pointer whitespace-nowrap shrink-0"
                >
                  {analyzing ? <Loader2 className="w-4 h-4 animate-spin" /> : <Sparkles className="w-4 h-4 text-[#9A3412] dark:text-[#EA8C55]" />}
                  {result.countries.length >= 2 ? 'Compare Side-by-Side' : 'Summarize Context'}
                </button>
              )}
            </div>
          </form>

          {/* Featured Historical Presets */}
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-xs text-[#78716C] dark:text-[#8A8378] mr-1">Examples:</span>
            {HISTORICAL_EXAMPLES.map((ex) => (
              <button
                key={ex.label}
                type="button"
                onClick={() => {
                  setYear(ex.year);
                  setMonth(ex.month);
                  setDay(ex.day);
                  setSelectedCodes(ex.countries);
                  runExplore(ex.year, ex.month, ex.day, ex.countries);
                }}
                className="px-3 py-1.5 text-xs rounded-lg bg-[#F3EFE7] dark:bg-[#191816] border border-transparent dark:border-[#2C2925] text-[#292524] dark:text-[#D6CEBE] hover:bg-[#E5DFD3] dark:hover:bg-[#22201D] transition-colors duration-150 cursor-pointer whitespace-nowrap shrink-0"
              >
                {ex.label}
              </button>
            ))}
          </div>
        </div>

        {/* Interactive 3D Globe */}
        <div className="lg:col-span-6">
          <InteractiveGlobe
            selectedCodes={selectedCodes}
            onToggleCountry={handleToggleCountry}
            isDark={isDark}
          />
        </div>
      </section>

      {error && (
        <div className="p-4 rounded-xl border border-[#9A3412]/30 dark:border-[#EA8C55]/30 bg-[#9A3412]/5 dark:bg-[#EA8C55]/10 text-sm text-[#9A3412] dark:text-[#EA8C55]">
          {error}
        </div>
      )}

      {loading && (
        <div className="py-16 rounded-xl border border-[#E5DFD3] dark:border-[#2C2925] bg-[#FFFFFF] dark:bg-[#191816] flex flex-col items-center justify-center gap-3 text-sm text-[#57534E] dark:text-[#B8B2A6]">
          <Loader2 className="w-5 h-5 animate-spin text-[#1E3A8A] dark:text-[#60A5FA]" />
          <span>
            Retrieving archival records for {MONTHS[month - 1]} {day}, {year}...
          </span>
        </div>
      )}

      {!loading && result && (
        <motion.div
          key={`${result.dateDisplay}-${result.countries.map((c) => c.countryCode).join('-')}`}
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.25, ease: [0.16, 1, 0.3, 1] }}
          className="space-y-8"
        >
          {/* Result Summary Strip & Filter Controls */}
          <section
            id="timeline"
            className="flex flex-wrap items-center justify-between gap-4 border-b border-[#E5DFD3] dark:border-[#2C2925] pb-5"
          >
            <div>
              <h2 className="font-serif text-2xl font-semibold text-[#1C1917] dark:text-[#F5F2EB]">
                {result.dateDisplay}
              </h2>
              <p className="text-xs text-[#57534E] dark:text-[#B8B2A6] mt-1">
                {result.countries.map((c) => `${c.flag} ${c.countryName}`).join('  ·  ')}
              </p>
            </div>

            <div className="flex flex-wrap items-center gap-3">
              {/* Epistemic Tier Filter */}
              <div className="flex items-center gap-1 p-1 rounded-lg bg-[#F3EFE7] dark:bg-[#191816] border border-[#E5DFD3] dark:border-[#2C2925]">
                {(
                  [
                    { id: 'all', label: 'All Evidence' },
                    { id: 'exact_date', label: 'Exact Date' },
                    { id: 'around_date', label: 'Around Date' },
                    { id: 'historical_background', label: 'Background' },
                  ] as const
                ).map((t) => (
                  <button
                    key={t.id}
                    type="button"
                    onClick={() => setTierFilter(t.id)}
                    className={`px-3 py-1 text-xs font-medium rounded-md transition-colors duration-150 cursor-pointer whitespace-nowrap shrink-0 ${
                      tierFilter === t.id
                        ? 'bg-[#FFFFFF] dark:bg-[#2C2925] text-[#1C1917] dark:text-[#F5F2EB] shadow-sm'
                        : 'text-[#57534E] dark:text-[#B8B2A6] hover:text-[#1C1917] dark:hover:text-[#F5F2EB]'
                    }`}
                  >
                    {t.label}
                  </button>
                ))}
              </div>

              {/* View Mode Switch */}
              <div className="flex items-center gap-1 p-1 rounded-lg bg-[#F3EFE7] dark:bg-[#191816] border border-[#E5DFD3] dark:border-[#2C2925]">
                <button
                  type="button"
                  onClick={() => setViewMode('comparison')}
                  className={`px-3 py-1 text-xs font-medium rounded-md transition-colors duration-150 cursor-pointer whitespace-nowrap shrink-0 ${
                    viewMode === 'comparison'
                      ? 'bg-[#1C1917] dark:bg-[#F5F2EB] text-[#FBF9F5] dark:text-[#111110]'
                      : 'text-[#57534E] dark:text-[#B8B2A6] hover:text-[#1C1917] dark:hover:text-[#F5F2EB]'
                  }`}
                >
                  Side-by-Side
                </button>
                <button
                  type="button"
                  onClick={() => setViewMode('timeline')}
                  className={`px-3 py-1 text-xs font-medium rounded-md transition-colors duration-150 cursor-pointer whitespace-nowrap shrink-0 ${
                    viewMode === 'timeline'
                      ? 'bg-[#1C1917] dark:bg-[#F5F2EB] text-[#FBF9F5] dark:text-[#111110]'
                      : 'text-[#57534E] dark:text-[#B8B2A6] hover:text-[#1C1917] dark:hover:text-[#F5F2EB]'
                  }`}
                >
                  Timeline
                </button>
              </div>
            </div>
          </section>

          {/* Grounded Gemini Side-by-Side Comparative Analysis */}
          {(analysisError || analysis) && (
            <motion.section
              id="comparison"
              initial={{ opacity: 0, y: 6 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.2 }}
              className="border border-[#D6CEBE] dark:border-[#3A3630] rounded-xl bg-[#FFFFFF] dark:bg-[#191816] p-6 space-y-6"
            >
              {analysisError && (
                <p className="text-sm text-[#9A3412] dark:text-[#EA8C55]">{analysisError}</p>
              )}

              {analysis && (
                <>
                  <div className="flex flex-wrap items-baseline justify-between gap-4 border-b border-[#E5DFD3] dark:border-[#2C2925] pb-4">
                    <div>
                      <p className="text-xs font-medium uppercase tracking-widest text-[#1E3A8A] dark:text-[#60A5FA] mb-1">
                        Comparative Synthesis · {analysis.dateDisplay}
                      </p>
                      <h3 className="font-serif text-2xl font-semibold text-[#1C1917] dark:text-[#F5F2EB]">
                        {analysis.headline}
                      </h3>
                    </div>
                    <button
                      type="button"
                      onClick={() => setAnalysis(null)}
                      className="text-xs text-[#78716C] dark:text-[#9A9388] hover:text-[#1C1917] dark:hover:text-[#F5F2EB] underline cursor-pointer"
                    >
                      Dismiss
                    </button>
                  </div>

                  <p className="text-[15px] leading-relaxed text-[#292524] dark:text-[#E7E2D8]">
                    {analysis.executiveOverview}
                  </p>

                  <div
                    className={`grid grid-cols-1 ${
                      analysis.countrySummaries.length > 1 ? 'md:grid-cols-2' : ''
                    } gap-5`}
                  >
                    {analysis.countrySummaries.map((cs) => (
                      <div
                        key={cs.countryName}
                        className="rounded-lg border border-[#E5DFD3] dark:border-[#2C2925] bg-[#FBF9F5] dark:bg-[#141311] p-4 space-y-2.5"
                      >
                        <h4 className="font-serif text-lg font-semibold text-[#1C1917] dark:text-[#F5F2EB]">
                          {cs.countryName}
                        </h4>
                        <div className="text-sm text-[#292524] dark:text-[#D6CEBE]">
                          <span className="font-semibold text-[#1C1917] dark:text-[#F5F2EB]">
                            Political Situation:{' '}
                          </span>
                          {cs.politicalSituation}
                        </div>
                        <div className="text-sm text-[#292524] dark:text-[#D6CEBE]">
                          <span className="font-semibold text-[#1C1917] dark:text-[#F5F2EB]">
                            Key Developments:{' '}
                          </span>
                          {cs.keyDevelopments}
                        </div>
                        <div className="text-sm text-[#57534E] dark:text-[#B8B2A6]">
                          <span className="font-semibold text-[#1C1917] dark:text-[#F5F2EB]">
                            Significance:{' '}
                          </span>
                          {cs.whyItMattered}
                        </div>
                      </div>
                    ))}
                  </div>

                  {analysis.similarities.length > 0 && analysis.differences.length > 0 && (
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-6 pt-3 border-t border-[#E5DFD3] dark:border-[#2C2925]">
                      <div>
                        <h4 className="text-xs font-semibold uppercase tracking-wider text-[#14532D] dark:text-[#4ADE80] mb-2">
                          Parallels &amp; Similarities
                        </h4>
                        <ul className="space-y-1.5 text-sm text-[#292524] dark:text-[#D6CEBE]">
                          {analysis.similarities.map((item, idx) => (
                            <li key={idx}>• {item}</li>
                          ))}
                        </ul>
                      </div>
                      <div>
                        <h4 className="text-xs font-semibold uppercase tracking-wider text-[#9A3412] dark:text-[#EA8C55] mb-2">
                          Key Differences
                        </h4>
                        <ul className="space-y-1.5 text-sm text-[#292524] dark:text-[#D6CEBE]">
                          {analysis.differences.map((item, idx) => (
                            <li key={idx}>• {item}</li>
                          ))}
                        </ul>
                      </div>
                    </div>
                  )}

                  <div className="grid grid-cols-1 md:grid-cols-2 gap-6 pt-3 border-t border-[#E5DFD3] dark:border-[#2C2925] text-sm">
                    <div>
                      <span className="font-semibold text-[#1C1917] dark:text-[#F5F2EB]">
                        International Context:{' '}
                      </span>
                      <span className="text-[#44403C] dark:text-[#D6CEBE]">
                        {analysis.internationalRelationships}
                      </span>
                    </div>
                    <div>
                      <span className="font-semibold text-[#1C1917] dark:text-[#F5F2EB]">
                        Evidence Scope:{' '}
                      </span>
                      <span className="text-[#57534E] dark:text-[#B8B2A6]">
                        {analysis.evidenceScopeNote}
                      </span>
                    </div>
                  </div>
                </>
              )}
            </motion.section>
          )}

          {/* Side-by-Side Country Comparison Panels */}
          {viewMode === 'comparison' && (
            <section
              className={`grid grid-cols-1 ${
                result.countries.length === 2
                  ? 'lg:grid-cols-2'
                  : result.countries.length >= 3
                    ? 'lg:grid-cols-2 xl:grid-cols-3'
                    : ''
              } gap-6 items-start`}
            >
              {result.countries.map((bundle) => {
                const filtered = filterCountryEvents(bundle);
                return (
                  <div
                    key={bundle.countryCode}
                    className="border border-[#E5DFD3] dark:border-[#2C2925] rounded-xl bg-[#FFFFFF] dark:bg-[#191816] overflow-hidden flex flex-col transition-colors duration-200"
                  >
                    {/* Country Header */}
                    <div className="p-5 border-b border-[#E5DFD3] dark:border-[#2C2925] bg-[#F3EFE7]/50 dark:bg-[#22201D]/60 space-y-3">
                      <div className="flex items-center justify-between gap-3">
                        <div className="flex items-center gap-3">
                          <span className="text-3xl leading-none" role="img" aria-label={bundle.countryName}>
                            {bundle.flag}
                          </span>
                          <div>
                            <h3 className="font-serif text-2xl font-semibold text-[#1C1917] dark:text-[#F5F2EB]">
                              {bundle.countryName}
                            </h3>
                            <p className="text-xs text-[#57534E] dark:text-[#B8B2A6]">
                              {bundle.region} · Capital: {bundle.capital}
                            </p>
                          </div>
                        </div>
                        <div className="text-right font-mono text-xs tabular-nums text-[#57534E] dark:text-[#B8B2A6]">
                          <div>{bundle.exactDateEvents.length} exact</div>
                          <div>{bundle.aroundDateEvents.length} near date</div>
                        </div>
                      </div>

                      {(bundle.sovereignPolities.length > 0 || bundle.rulersInOffice.length > 0) && (
                        <div className="pt-2.5 border-t border-[#E5DFD3] dark:border-[#2C2925] text-xs space-y-1 text-[#44403C] dark:text-[#D6CEBE]">
                          {bundle.sovereignPolities.length > 0 && (
                            <div>
                              <span className="font-semibold text-[#1C1917] dark:text-[#F5F2EB]">
                                Polity:{' '}
                              </span>
                              {bundle.sovereignPolities.map((p) => p.name).join(', ')}
                            </div>
                          )}
                          {bundle.rulersInOffice.length > 0 && (
                            <div>
                              <span className="font-semibold text-[#1C1917] dark:text-[#F5F2EB]">
                                Rulers:{' '}
                              </span>
                              {bundle.rulersInOffice
                                .map((r) => `${r.name}${r.title ? ` (${r.title})` : ''}`)
                                .join(' · ')}
                            </div>
                          )}
                        </div>
                      )}
                    </div>

                    {/* Archival Photography Strip */}
                    {bundle.galleryImages.length > 0 && (
                      <div className="p-4 border-b border-[#E5DFD3] dark:border-[#2C2925] bg-[#FBF9F5] dark:bg-[#141311]">
                        <div className="grid grid-cols-3 gap-2.5">
                          {bundle.galleryImages.slice(0, 3).map((img, idx) => (
                            <a
                              key={idx}
                              href={img.sourceUrl ?? '#'}
                              target="_blank"
                              rel="noreferrer"
                              className="group block rounded-lg border border-[#E5DFD3] dark:border-[#2C2925] bg-[#FFFFFF] dark:bg-[#191816] overflow-hidden"
                            >
                              <ArchivalImage
                                src={img.imageUrl}
                                alt={img.title}
                                category="event"
                                className="w-full h-24 object-cover group-hover:scale-[1.03] transition-transform duration-200"
                              />
                              <div className="p-1.5 text-[11px] text-[#57534E] dark:text-[#B8B2A6] truncate">
                                {img.title}
                              </div>
                            </a>
                          ))}
                        </div>
                      </div>
                    )}

                    {/* Events List */}
                    <div className="divide-y divide-[#F3EFE7] dark:divide-[#26231F]">
                      {filtered.length === 0 ? (
                        <div className="p-6 text-sm text-[#78716C] dark:text-[#9A9388]">
                          No events matched this filter for {bundle.countryName}. Switch to &ldquo;All Evidence&rdquo; to inspect surrounding events and historical context.
                        </div>
                      ) : (
                        filtered.map((ev) => (
                          <article key={ev.id} className="p-5 space-y-2">
                            <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs">
                              <span className={`font-semibold ${tierColorClass(ev.tier)}`}>
                                {tierLabel(ev.tier)}
                              </span>
                              <span aria-hidden="true" className="text-[#78716C]">·</span>
                              <span className="font-mono tabular-nums text-[#57534E] dark:text-[#B8B2A6]">
                                {ev.dateLabel}
                              </span>
                              <span aria-hidden="true" className="text-[#78716C]">·</span>
                              <span className="capitalize text-[#78716C] dark:text-[#9A9388]">
                                {ev.category}
                              </span>
                              <span aria-hidden="true" className="text-[#78716C]">·</span>
                              <span className="text-[#1E3A8A] dark:text-[#60A5FA] font-medium">
                                {ev.sourceLabel}
                              </span>
                            </div>

                            <h4 className="font-serif text-lg font-semibold text-[#1C1917] dark:text-[#F5F2EB] leading-snug">
                              {ev.title}
                            </h4>

                            <p className="text-sm text-[#44403C] dark:text-[#D6CEBE] leading-relaxed">
                              {ev.summary}
                            </p>

                            <div className="flex flex-wrap items-center justify-between gap-2 pt-1 text-xs text-[#78716C] dark:text-[#9A9388]">
                              {ev.location && (
                                <span className="inline-flex items-center gap-1">
                                  <MapPin className="w-3 h-3" />
                                  {ev.location}
                                </span>
                              )}
                              {ev.sourceUrl && (
                                <a
                                  href={ev.sourceUrl}
                                  target="_blank"
                                  rel="noreferrer"
                                  className="inline-flex items-center gap-1 text-[#1E3A8A] dark:text-[#60A5FA] hover:underline font-medium"
                                >
                                  Source
                                  <ExternalLink className="w-3 h-3" />
                                </a>
                              )}
                            </div>

                            {ev.references && ev.references.length > 0 && (
                              <div className="text-[11px] text-[#78716C] dark:text-[#8A8378] pt-1 border-t border-[#F3EFE7] dark:border-[#26231F] truncate">
                                Citations: {ev.references.join(' · ')}
                              </div>
                            )}
                          </article>
                        ))
                      )}
                    </div>
                  </div>
                );
              })}
            </section>
          )}

          {/* Unified Chronological Timeline */}
          {viewMode === 'timeline' && (
            <section className="rounded-xl border border-[#E5DFD3] dark:border-[#2C2925] bg-[#FFFFFF] dark:bg-[#191816] divide-y divide-[#E5DFD3] dark:divide-[#2C2925] overflow-hidden">
              {allTimelineEvents.length === 0 ? (
                <div className="p-8 text-sm text-[#78716C] dark:text-[#9A9388] text-center">
                  No timeline entries match the selected filter.
                </div>
              ) : (
                allTimelineEvents.map((ev) => {
                  const bundle = result.countries.find((c) => c.countryCode === ev.countryCode);
                  return (
                    <article key={ev.id} className="p-5 flex flex-col sm:flex-row gap-5 items-start">
                      <div className="sm:w-44 shrink-0 space-y-1">
                        <div className="font-mono text-xs font-semibold tabular-nums text-[#9A3412] dark:text-[#EA8C55]">
                          {ev.dateLabel}
                        </div>
                        <div className="text-sm font-medium text-[#1C1917] dark:text-[#F5F2EB]">
                          {bundle?.flag} {ev.countryName}
                        </div>
                        <div className={`text-xs font-medium ${tierColorClass(ev.tier)}`}>
                          {tierLabel(ev.tier)}
                        </div>
                      </div>

                      <div className="flex-1 min-w-0 space-y-1.5">
                        <h4 className="font-serif text-lg font-semibold text-[#1C1917] dark:text-[#F5F2EB]">
                          {ev.title}
                        </h4>
                        <p className="text-sm text-[#44403C] dark:text-[#D6CEBE] leading-relaxed">
                          {ev.summary}
                        </p>
                        <div className="flex flex-wrap items-center gap-4 pt-1 text-xs text-[#78716C] dark:text-[#9A9388]">
                          <span>{ev.sourceLabel}</span>
                          {ev.sourceUrl && (
                            <a
                              href={ev.sourceUrl}
                              target="_blank"
                              rel="noreferrer"
                              className="inline-flex items-center gap-1 text-[#1E3A8A] dark:text-[#60A5FA] hover:underline"
                            >
                              Reference
                              <ExternalLink className="w-3 h-3" />
                            </a>
                          )}
                        </div>
                      </div>

                      {ev.imageUrl && (
                        <div className="w-24 h-20 shrink-0 rounded-lg border border-[#E5DFD3] dark:border-[#2C2925] overflow-hidden">
                          <ArchivalImage
                            src={ev.imageUrl}
                            alt={ev.title}
                            category="event"
                            className="w-full h-full object-cover"
                          />
                        </div>
                      )}
                    </article>
                  );
                })
              )}
            </section>
          )}

          {/* Bottom Comparative Action Callout */}
          {result.countries.length >= 2 && !analysis && !analyzing && (
            <div
              id="comparison"
              className="rounded-xl border border-[#D6CEBE] dark:border-[#3A3630] bg-[#F3EFE7]/60 dark:bg-[#191816] p-5 flex flex-wrap items-center justify-between gap-4"
            >
              <div className="space-y-0.5">
                <div className="font-serif text-lg font-semibold text-[#1C1917] dark:text-[#F5F2EB]">
                  Side-by-Side Comparative Analysis
                </div>
                <p className="text-xs text-[#57534E] dark:text-[#B8B2A6]">
                  Synthesize political conditions, similarities, differences, and global context for {result.dateDisplay}.
                </p>
              </div>
              <button
                type="button"
                onClick={() => runComparisonSynthesis()}
                className="inline-flex items-center gap-2 px-4 py-2 text-xs font-medium rounded-lg bg-[#1E3A8A] dark:bg-[#2563EB] text-white hover:bg-[#172D6B] dark:hover:bg-[#1D4ED8] transition-colors cursor-pointer whitespace-nowrap shrink-0"
              >
                <GitCompare className="w-3.5 h-3.5" />
                Compare Countries
              </button>
            </div>
          )}
        </motion.div>
      )}
    </div>
  );
}
