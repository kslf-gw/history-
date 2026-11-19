import { GoogleGenAI, ThinkingLevel, Type } from '@google/genai';
import type {
  AtlasYearSnapshot,
  CountryComparisonAnalysis,
  CountryHistoryBundle,
  GeminiComparisonResponse,
  GeminiSynthesisResponse,
  HistoricalRecord,
} from '../src/types/history.ts';

function getGeminiClient(): GoogleGenAI {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    throw new Error('GEMINI_API_KEY is not configured in server environment.');
  }
  return new GoogleGenAI({
    apiKey,
    httpOptions: {
      headers: {
        'User-Agent': 'aistudio-build',
      },
    },
  });
}

const MODEL_NAME = 'gemini-4-hydrogen';

function summarizeRecordsForPrompt(records: HistoricalRecord[]): string {
  return records
    .slice(0, 24)
    .map(
      (r, idx) =>
        `[${idx + 1}] Source: ${r.sourceLabel} | Category: ${r.category} | Title: ${r.title}${
          r.nativeTitle && r.nativeTitle !== r.title ? ` (Original: ${r.nativeTitle})` : ''
        } | Date: ${r.dateDisplay ?? 'Undated'} | Region/Location: ${r.location ?? r.region ?? 'Unspecified'}${
          r.confidenceScore !== null && r.confidenceScore !== undefined ? ` | Confidence: ${r.confidenceScore}` : ''
        }\nSummary: ${r.description}${r.ethicalNotes ? `\nEthical/Historiographical Note: ${r.ethicalNotes}` : ''}`
    )
    .join('\n\n');
}

export async function synthesizeHistoricalRecords(
  query: string,
  records: HistoricalRecord[]
): Promise<GeminiSynthesisResponse> {
  if (!records || records.length === 0) {
    throw new Error('At least one retrieved historical record is required for synthesis.');
  }

  const ai = getGeminiClient();
  const contextBlock = summarizeRecordsForPrompt(records);

  const response = await ai.models.generateContent({
    model: MODEL_NAME,
    contents: `Research Query: "${query}"\n\nRetrieved External Historical Records:\n${contextBlock}`,
    config: {
      systemInstruction:
        'You are a scholarly historical research assistant. Organize, explain, compare, and cross-reference ONLY the retrieved external historical records provided in the prompt. Never fabricate unverified facts or pretend a source exists that was not provided. Cite records explicitly by [Source: Title]. Distinguish clearly between geopolitical borders (AtlasPI), cultural/biographical milestones (Vetustas), museum artifacts, and archival monographs. Note any historiographical gaps or missing eras in the retrieved evidence.',
      thinkingConfig: { thinkingLevel: ThinkingLevel.LOW },
      responseMimeType: 'application/json',
      responseSchema: {
        type: Type.OBJECT,
        properties: {
          headline: { type: Type.STRING, description: 'Concise editorial headline summarizing the retrieved evidence.' },
          executiveSummary: {
            type: Type.STRING,
            description: '2-3 paragraph synthesis grounded strictly in the retrieved external records with inline [Source: Title] citations.',
          },
          chronologicalThreads: {
            type: Type.ARRAY,
            items: {
              type: Type.OBJECT,
              properties: {
                eraOrDate: { type: Type.STRING },
                insight: { type: Type.STRING },
                citedRecords: { type: Type.ARRAY, items: { type: Type.STRING } },
              },
              required: ['eraOrDate', 'insight', 'citedRecords'],
            },
          },
          crossSourceObservations: {
            type: Type.ARRAY,
            items: { type: Type.STRING },
            description: 'How geography, artifacts, texts, and events reinforce or contrast with one another.',
          },
          historiographicalGaps: {
            type: Type.STRING,
            description: 'What remains unverified, ambiguous, or absent from the retrieved APIs.',
          },
        },
        required: [
          'headline',
          'executiveSummary',
          'chronologicalThreads',
          'crossSourceObservations',
          'historiographicalGaps',
        ],
      },
    },
  });

  const parsed = JSON.parse((response.text ?? '{}').trim()) as Omit<GeminiSynthesisResponse, 'model'>;
  return { ...parsed, model: MODEL_NAME };
}

export async function compareHistoricalRecords(
  records: HistoricalRecord[]
): Promise<GeminiComparisonResponse> {
  if (!records || records.length < 2) {
    throw new Error('Select at least 2 historical records to compare.');
  }

  const ai = getGeminiClient();
  const contextBlock = summarizeRecordsForPrompt(records.slice(0, 4));

  const response = await ai.models.generateContent({
    model: MODEL_NAME,
    contents: `Compare the following ${Math.min(records.length, 4)} historical records retrieved from external APIs:\n\n${contextBlock}`,
    config: {
      systemInstruction:
        'You are a comparative historian. Compare the provided records across chronology, geography/provenance, historical significance, and source reliability. Rely strictly on the retrieved evidence provided; explicitly note where dates or attributes are missing in one record versus another.',
      thinkingConfig: { thinkingLevel: ThinkingLevel.LOW },
      responseMimeType: 'application/json',
      responseSchema: {
        type: Type.OBJECT,
        properties: {
          title: { type: Type.STRING },
          overview: { type: Type.STRING },
          dimensions: {
            type: Type.ARRAY,
            items: {
              type: Type.OBJECT,
              properties: {
                dimension: { type: Type.STRING },
                analysis: { type: Type.STRING },
              },
              required: ['dimension', 'analysis'],
            },
          },
          sourceDiscrepancies: { type: Type.STRING },
        },
        required: ['title', 'overview', 'dimensions', 'sourceDiscrepancies'],
      },
    },
  });

  const parsed = JSON.parse((response.text ?? '{}').trim()) as Omit<GeminiComparisonResponse, 'model'>;
  return { ...parsed, model: MODEL_NAME };
}

export async function briefYearSnapshot(snapshot: AtlasYearSnapshot): Promise<GeminiSynthesisResponse> {
  const ai = getGeminiClient();

  const entityLines = snapshot.entities
    .slice(0, 15)
    .map((e) => `- ${e.name} (${e.entity_type}, ${e.year_start ?? '?'} to ${e.year_end ?? '?'}, capital: ${e.capital?.name ?? 'N/A'})`)
    .join('\n');

  const rulerLines = snapshot.rulers
    .slice(0, 12)
    .map((r) => `- ${r.name_original} (${r.title ?? 'Ruler'}, ${r.entity_name_fallback ?? ''}, ${r.reign_start ?? '?'}–${r.reign_end ?? '?'})`)
    .join('\n');

  const eventLines = snapshot.events
    .slice(0, 10)
    .map((ev) => `- ${ev.name} (${ev.event_type}, ${ev.location_name ?? 'Unknown location'})`)
    .join('\n');

  const periodLines = snapshot.periods
    .slice(0, 12)
    .map((p) => `- ${p.name} (${p.region}, ${p.year_start} to ${p.year_end})`)
    .join('\n');

  const routeLines = snapshot.routes
    .slice(0, 8)
    .map((rt) => `- ${rt.name_original} (${rt.route_type}, commodities: ${rt.commodities?.join(', ') ?? 'unspecified'})`)
    .join('\n');

  const vetustasLines = snapshot.vetustasMilestones
    .slice(0, 10)
    .map((m) => `- [${m.sourceLabel}] ${m.title} (${m.subtitle ?? ''})`)
    .join('\n');

  const prompt = `Historical Year Snapshot: ${snapshot.yearDisplay} (${snapshot.year})
Total Active Polities in AtlasPI: ${snapshot.entityStats.totalActive}

Active Historical Periods (AtlasPI):
${periodLines || 'None returned'}

Polities & Empires (AtlasPI):
${entityLines || 'None returned'}

Rulers in Office (AtlasPI):
${rulerLines || 'None returned'}

Recorded Events That Year (AtlasPI):
${eventLines || 'None returned'}

Active Trade Routes (AtlasPI):
${routeLines || 'None returned'}

Milestones & Cultural Records (Vetustas):
${vetustasLines || 'None returned'}`;

  const response = await ai.models.generateContent({
    model: MODEL_NAME,
    contents: prompt,
    config: {
      systemInstruction:
        'You are a world-history curator. Produce a structured briefing for this exact historical year strictly grounded in the AtlasPI and Vetustas datasets provided. Highlight geopolitical balance, active rulers, trade networks, and cultural milestones without inventing external facts.',
      thinkingConfig: { thinkingLevel: ThinkingLevel.LOW },
      responseMimeType: 'application/json',
      responseSchema: {
        type: Type.OBJECT,
        properties: {
          headline: { type: Type.STRING },
          executiveSummary: { type: Type.STRING },
          chronologicalThreads: {
            type: Type.ARRAY,
            items: {
              type: Type.OBJECT,
              properties: {
                eraOrDate: { type: Type.STRING },
                insight: { type: Type.STRING },
                citedRecords: { type: Type.ARRAY, items: { type: Type.STRING } },
              },
              required: ['eraOrDate', 'insight', 'citedRecords'],
            },
          },
          crossSourceObservations: { type: Type.ARRAY, items: { type: Type.STRING } },
          historiographicalGaps: { type: Type.STRING },
        },
        required: [
          'headline',
          'executiveSummary',
          'chronologicalThreads',
          'crossSourceObservations',
          'historiographicalGaps',
        ],
      },
    },
  });

  const parsed = JSON.parse((response.text ?? '{}').trim()) as Omit<GeminiSynthesisResponse, 'model'>;
  return { ...parsed, model: MODEL_NAME };
}

export async function analyzeCountryComparison(
  dateDisplay: string,
  countries: CountryHistoryBundle[]
): Promise<CountryComparisonAnalysis> {
  if (!countries || countries.length === 0) {
    throw new Error('At least one country history bundle is required.');
  }

  const ai = getGeminiClient();

  const bundleText = countries
    .map((c) => {
      const exact = c.exactDateEvents
        .slice(0, 6)
        .map((e) => `  - [EXACT DATE ${e.dateLabel} | ${e.sourceLabel}] ${e.title}: ${e.summary}`)
        .join('\n');
      const around = c.aroundDateEvents
        .slice(0, 6)
        .map((e) => `  - [AROUND DATE ${e.dateLabel} | ${e.sourceLabel}] ${e.title}: ${e.summary}`)
        .join('\n');
      const bg = c.backgroundEvents
        .slice(0, 5)
        .map((e) => `  - [BACKGROUND ${e.dateLabel} | ${e.sourceLabel}] ${e.title}: ${e.summary}`)
        .join('\n');
      const rulers = c.rulersInOffice
        .map((r) => `${r.name}${r.title ? ` (${r.title})` : ''} [${r.reignSpan}]`)
        .join('; ');
      const polities = c.sovereignPolities.map((p) => `${p.name} (${p.entityType})`).join('; ');

      return `COUNTRY: ${c.countryName} (${c.region}, Capital: ${c.capital})
Sovereign Polities (AtlasPI): ${polities || 'Not mapped in AtlasPI'}
Rulers in Office (AtlasPI): ${rulers || 'Not listed in AtlasPI'}
Exact-Date Records:
${exact || '  (None retrieved for exact day)'}
Around-Date Records:
${around || '  (None retrieved)'}
Historical Background Records:
${bg || '  (None retrieved)'}`;
    })
    .join('\n\n---\n\n');

  const response = await ai.models.generateContent({
    model: MODEL_NAME,
    contents: `Selected Historical Date: ${dateDisplay}\n\nRetrieved Multi-Source Evidence:\n\n${bundleText}`,
    config: {
      systemInstruction:
        'You are a comparative world historian. Analyze and compare what was happening in the selected country or countries on the selected date strictly based on the retrieved external API records provided. Clearly distinguish between exact-date occurrences, nearby events around that date, and macro historical background. Explain why the developments mattered, and highlight political conditions, similarities, differences, and international relationships grounded in the evidence. Never fabricate events or claim an event happened on the exact day unless it appears in the Exact-Date Records.',
      thinkingConfig: { thinkingLevel: ThinkingLevel.LOW },
      responseMimeType: 'application/json',
      responseSchema: {
        type: Type.OBJECT,
        properties: {
          headline: { type: Type.STRING },
          executiveOverview: { type: Type.STRING },
          countrySummaries: {
            type: Type.ARRAY,
            items: {
              type: Type.OBJECT,
              properties: {
                countryName: { type: Type.STRING },
                politicalSituation: { type: Type.STRING },
                keyDevelopments: { type: Type.STRING },
                whyItMattered: { type: Type.STRING },
              },
              required: ['countryName', 'politicalSituation', 'keyDevelopments', 'whyItMattered'],
            },
          },
          similarities: { type: Type.ARRAY, items: { type: Type.STRING } },
          differences: { type: Type.ARRAY, items: { type: Type.STRING } },
          internationalRelationships: { type: Type.STRING },
          evidenceScopeNote: { type: Type.STRING },
        },
        required: [
          'headline',
          'executiveOverview',
          'countrySummaries',
          'similarities',
          'differences',
          'internationalRelationships',
          'evidenceScopeNote',
        ],
      },
    },
  });

  const parsed = JSON.parse((response.text ?? '{}').trim()) as Omit<
    CountryComparisonAnalysis,
    'dateDisplay' | 'model'
  >;
  return {
    ...parsed,
    dateDisplay,
    model: MODEL_NAME,
  };
}

