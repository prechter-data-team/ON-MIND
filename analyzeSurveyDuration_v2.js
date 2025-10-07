#!/usr/bin/env node

/**
 * Survey Duration Analyzer v2
 *
 * Properly handles multiple surveys per contributor
 */

import dotenv from 'dotenv';
dotenv.config();

// Airtable Configuration
const AIRTABLE_CONFIG = {
  apiKey: process.env.VITE_AIRTABLE_API_KEY,
  baseId: process.env.VITE_AIRTABLE_BASE_ID,
  tables: {
    contributors: process.env.VITE_AIRTABLE_TABLE_CONTRIBUTORS,
    terms: process.env.VITE_AIRTABLE_TABLE_TERMS,
    responses: process.env.VITE_AIRTABLE_TABLE_RESPONSES,
    synonyms: process.env.VITE_AIRTABLE_TABLE_SYNONYMS
  }
}

// Survey boundary definitions
const SURVEY_BOUNDARIES = {
  clinical: {
    startTerm: 'Sleep-Wake Disturbance',
    endTerm: 'Social Jet-lag'
  },
  parasomnia: {
    startTerm: 'Parasomnias',
    endTerm: 'Apnea'
  }
};

/**
 * Fetch all responses from Airtable
 */
async function fetchAllResponses() {
  const url = `https://api.airtable.com/v0/${AIRTABLE_CONFIG.baseId}/${AIRTABLE_CONFIG.tables.responses}`;
  const responses = [];
  let offset = null;

  try {
    do {
      const queryUrl = offset ? `${url}?offset=${offset}` : url;
      const response = await fetch(queryUrl, {
        headers: {
          'Authorization': `Bearer ${AIRTABLE_CONFIG.apiKey}`,
          'Content-Type': 'application/json'
        }
      });

      if (!response.ok) {
        throw new Error(`Failed to fetch responses: ${response.statusText}`);
      }

      const data = await response.json();
      responses.push(...data.records);
      offset = data.offset;

      console.log(`Fetched ${data.records.length} records... (Total: ${responses.length})`);
    } while (offset);

    console.log(`✅ Total responses fetched: ${responses.length}\n`);
    return responses;
  } catch (error) {
    console.error('❌ Error fetching responses:', error);
    throw error;
  }
}

/**
 * Organize responses by contributor AND survey type
 */
function organizeByContributorAndSurvey(responses) {
  const bySurvey = {
    clinical: new Map(),
    parasomnia: new Map()
  };

  for (const record of responses) {
    const fields = record.fields;
    const contributorId = fields.contributorRecordId?.[0];
    const termLabel = fields.termLabel?.[0] || 'Unknown Term';
    const nextTermLabel = fields.nextTermLabel?.[0] || null;
    const timestamp = fields.formTimestamp;

    if (!contributorId || !timestamp) {
      continue;
    }

    // Determine which survey this response belongs to
    let surveyType = null;
    if (termLabel === SURVEY_BOUNDARIES.clinical.startTerm ||
        termLabel === SURVEY_BOUNDARIES.clinical.endTerm ||
        nextTermLabel === SURVEY_BOUNDARIES.clinical.endTerm) {
      surveyType = 'clinical';
    } else if (termLabel === SURVEY_BOUNDARIES.parasomnia.startTerm ||
               termLabel === SURVEY_BOUNDARIES.parasomnia.endTerm ||
               nextTermLabel === SURVEY_BOUNDARIES.parasomnia.endTerm) {
      surveyType = 'parasomnia';
    }

    // Add to the appropriate survey map
    for (const [type, config] of Object.entries(SURVEY_BOUNDARIES)) {
      // Check if this response could belong to this survey type
      if (!bySurvey[type].has(contributorId)) {
        bySurvey[type].set(contributorId, []);
      }

      // Add the response (we'll filter later)
      bySurvey[type].get(contributorId).push({
        recordId: record.id,
        contributorId,
        termLabel,
        nextTermLabel,
        timestamp: new Date(timestamp),
        fields
      });
    }
  }

  return bySurvey;
}

/**
 * Analyze a single survey completion
 */
function analyzeSurveyCompletion(contributorId, responses, surveyType) {
  const config = SURVEY_BOUNDARIES[surveyType];

  // Find responses with the start and end terms
  const startResponses = responses.filter(r => r.termLabel === config.startTerm);
  const endResponses = responses.filter(r => r.termLabel === config.endTerm);

  if (startResponses.length === 0 || endResponses.length === 0) {
    return null; // Didn't complete this survey
  }

  // Sort by timestamp
  const sortedResponses = responses.sort((a, b) => a.timestamp - b.timestamp);

  // Get first start and last end
  const firstStart = startResponses.sort((a, b) => a.timestamp - b.timestamp)[0];
  const lastEnd = endResponses.sort((a, b) => b.timestamp - a.timestamp)[0];

  // Calculate duration
  const durationMs = lastEnd.timestamp - firstStart.timestamp;
  const durationMinutes = durationMs / (1000 * 60);
  const durationHours = durationMinutes / 60;

  // Count sessions (gap > 30 minutes)
  let sessionCount = 1;
  for (let i = 1; i < sortedResponses.length; i++) {
    const gap = (sortedResponses[i].timestamp - sortedResponses[i - 1].timestamp) / (1000 * 60);
    if (gap > 30) {
      sessionCount++;
    }
  }

  return {
    contributorId,
    surveyType,
    totalResponses: responses.length,
    firstTimestamp: firstStart.timestamp,
    lastTimestamp: lastEnd.timestamp,
    startTerm: firstStart.termLabel,
    endTerm: lastEnd.termLabel,
    durationMs,
    durationMinutes: Math.round(durationMinutes * 100) / 100,
    durationHours: Math.round(durationHours * 100) / 100,
    sessionCount,
    isComplete: true
  };
}

/**
 * Main analysis
 */
async function main() {
  try {
    console.log('🚀 Starting Survey Duration Analysis v2...\n');

    // Fetch all responses
    const responses = await fetchAllResponses();

    // Organize by survey type
    console.log('📦 Organizing responses by survey type...');
    const bySurvey = organizeByContributorAndSurvey(responses);

    // Analyze each survey type
    const results = {
      clinical: [],
      parasomnia: []
    };

    for (const [surveyType, contributorMap] of Object.entries(bySurvey)) {
      const config = SURVEY_BOUNDARIES[surveyType];
      console.log(`\n📊 Analyzing ${surveyType.toUpperCase()} Survey (${config.startTerm} → ${config.endTerm})`);
      console.log('─'.repeat(80));

      let completedCount = 0;
      let startedCount = 0;

      for (const [contributorId, contributorResponses] of contributorMap) {
        // Check if they started this survey
        const hasStart = contributorResponses.some(r => r.termLabel === config.startTerm);
        if (hasStart) {
          startedCount++;
        }

        // Check if they completed
        const analysis = analyzeSurveyCompletion(contributorId, contributorResponses, surveyType);
        if (analysis) {
          results[surveyType].push(analysis);
          completedCount++;
        }
      }

      console.log(`Started: ${startedCount}`);
      console.log(`Completed: ${completedCount}`);
      console.log(`Completion Rate: ${completedCount > 0 ? (completedCount / startedCount * 100).toFixed(1) : 0}%`);
    }

    // Display results
    console.log('\n\n' + '='.repeat(80));
    console.log('DETAILED RESULTS');
    console.log('='.repeat(80));

    for (const surveyType of ['clinical', 'parasomnia']) {
      const surveyResults = results[surveyType];
      if (surveyResults.length === 0) continue;

      console.log(`\n\n📋 ${surveyType.toUpperCase()} SURVEY COMPLETIONS (n=${surveyResults.length})`);
      console.log('─'.repeat(80));

      // Sort by duration
      const sorted = surveyResults.sort((a, b) => b.durationMinutes - a.durationMinutes);

      sorted.forEach((r, idx) => {
        const duration = r.durationHours > 1
          ? `${Math.floor(r.durationHours)}h ${Math.round(r.durationMinutes % 60)}m`
          : `${Math.round(r.durationMinutes)}m`;

        console.log(`\n${idx + 1}. Contributor: ${r.contributorId.substring(0, 12)}...`);
        console.log(`   Responses: ${r.totalResponses}`);
        console.log(`   Duration: ${duration} (${r.durationHours.toFixed(2)}h)`);
        console.log(`   Sessions: ${r.sessionCount}`);
        console.log(`   Started: ${r.firstTimestamp.toLocaleString()}`);
        console.log(`   Completed: ${r.lastTimestamp.toLocaleString()}`);
      });

      // Statistics
      const durations = surveyResults.map(r => r.durationMinutes);
      const mean = durations.reduce((a, b) => a + b, 0) / durations.length;
      const sortedDurations = [...durations].sort((a, b) => a - b);
      const median = sortedDurations[Math.floor(sortedDurations.length / 2)];
      const min = Math.min(...durations);
      const max = Math.max(...durations);

      const singleSession = surveyResults.filter(r => r.sessionCount === 1).length;
      const multiSession = surveyResults.filter(r => r.sessionCount > 1).length;

      console.log(`\n\n📊 ${surveyType.toUpperCase()} STATISTICS`);
      console.log('─'.repeat(80));
      console.log(`Completions: ${surveyResults.length}`);
      console.log(`Duration (minutes):`);
      console.log(`  Mean: ${mean.toFixed(2)}`);
      console.log(`  Median: ${median.toFixed(2)}`);
      console.log(`  Range: ${min.toFixed(2)} - ${max.toFixed(2)}`);
      console.log(`Sessions:`);
      console.log(`  Single: ${singleSession} (${(singleSession/surveyResults.length*100).toFixed(1)}%)`);
      console.log(`  Multiple: ${multiSession} (${(multiSession/surveyResults.length*100).toFixed(1)}%)`);
    }

    console.log('\n\n✅ Analysis complete!\n');

  } catch (error) {
    console.error('❌ Analysis failed:', error);
    process.exit(1);
  }
}

// Run
main();
