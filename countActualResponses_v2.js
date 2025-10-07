#!/usr/bin/env node

/**
 * Count actual responses from Airtable (excluding blanks)
 * Properly classify by survey type using survey flow
 */

import dotenv from 'dotenv';
dotenv.config();

const AIRTABLE_CONFIG = {
  apiKey: process.env.VITE_AIRTABLE_API_KEY,
  baseId: process.env.VITE_AIRTABLE_BASE_ID,
  responsesTableId: process.env.VITE_AIRTABLE_TABLE_RESPONSES
};

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
  const url = `https://api.airtable.com/v0/${AIRTABLE_CONFIG.baseId}/${AIRTABLE_CONFIG.responsesTableId}`;
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

    } while (offset);

    return responses;
  } catch (error) {
    console.error('❌ Error fetching responses:', error);
    throw error;
  }
}

/**
 * Determine if a record is valid (non-blank)
 */
function isValidResponse(record) {
  const fields = record.fields;

  // Check if essential fields exist
  const hasContributor = fields.contributorRecordId && fields.contributorRecordId.length > 0;
  const hasTermLabel = fields.termLabel && fields.termLabel.length > 0;
  const hasTimestamp = fields.formTimestamp;

  return hasContributor && hasTermLabel && hasTimestamp;
}

/**
 * Organize responses by contributor and trace survey paths
 */
function organizeAndClassify(validResponses) {
  // Group by contributor
  const byContributor = new Map();

  for (const record of validResponses) {
    const contributorId = record.fields.contributorRecordId[0];
    if (!byContributor.has(contributorId)) {
      byContributor.set(contributorId, []);
    }
    byContributor.get(contributorId).push({
      recordId: record.id,
      termLabel: record.fields.termLabel[0],
      nextTermLabel: record.fields.nextTermLabel?.[0] || null,
      timestamp: new Date(record.fields.formTimestamp),
      fields: record.fields
    });
  }

  // Now classify each contributor's responses into surveys
  const surveyResponses = {
    clinical: [],
    parasomnia: []
  };

  for (const [contributorId, responses] of byContributor) {
    // Sort by timestamp
    const sorted = responses.sort((a, b) => a.timestamp - b.timestamp);

    // Find survey start points
    let currentSurvey = null;

    for (const response of sorted) {
      // Check if this is a start term
      if (response.termLabel === SURVEY_BOUNDARIES.clinical.startTerm) {
        currentSurvey = 'clinical';
      } else if (response.termLabel === SURVEY_BOUNDARIES.parasomnia.startTerm) {
        currentSurvey = 'parasomnia';
      }

      // Assign to current survey if we know which one we're in
      if (currentSurvey) {
        surveyResponses[currentSurvey].push(response);

        // Check if we've reached the end of this survey
        if (response.termLabel === SURVEY_BOUNDARIES[currentSurvey].endTerm) {
          currentSurvey = null; // Reset for next survey
        }
      }
    }
  }

  return surveyResponses;
}

async function main() {
  try {
    console.log('🚀 Counting actual responses from Airtable...\n');

    // Fetch all records
    const allRecords = await fetchAllResponses();
    console.log(`✅ Total records fetched: ${allRecords.length}`);

    // Filter valid responses
    const validResponses = allRecords.filter(isValidResponse);
    const blankResponses = allRecords.length - validResponses.length;

    console.log('\n' + '=' .repeat(80));
    console.log('OVERALL RESPONSE COUNTS');
    console.log('=' .repeat(80));
    console.log(`Total records in Airtable: ${allRecords.length}`);
    console.log(`Valid responses (non-blank): ${validResponses.length}`);
    console.log(`Blank/invalid responses: ${blankResponses}`);
    console.log(`Blank percentage: ${(blankResponses / allRecords.length * 100).toFixed(1)}%`);

    // Classify by survey type using path tracing
    console.log('\n📊 Classifying responses by survey path...');
    const surveyResponses = organizeAndClassify(validResponses);

    console.log('\n' + '=' .repeat(80));
    console.log('RESPONSES BY SURVEY TYPE (Path-based classification)');
    console.log('=' .repeat(80));
    console.log(`Clinical Sleep Survey responses: ${surveyResponses.clinical.length}`);
    console.log(`Parasomnia Survey responses: ${surveyResponses.parasomnia.length}`);
    console.log(`Total classified: ${surveyResponses.clinical.length + surveyResponses.parasomnia.length}`);
    console.log(`Unclassified: ${validResponses.length - (surveyResponses.clinical.length + surveyResponses.parasomnia.length)}`);

    // Count unique contributors per survey
    const clinicalContributors = new Set(
      surveyResponses.clinical.map(r => r.fields.contributorRecordId[0])
    );

    const parasomniaContributors = new Set(
      surveyResponses.parasomnia.map(r => r.fields.contributorRecordId[0])
    );

    console.log('\n' + '=' .repeat(80));
    console.log('UNIQUE CONTRIBUTORS');
    console.log('=' .repeat(80));
    console.log(`Clinical Sleep Survey: ${clinicalContributors.size} unique contributors`);
    console.log(`Parasomnia Survey: ${parasomniaContributors.size} unique contributors`);

    // Average responses per contributor
    console.log('\n' + '=' .repeat(80));
    console.log('AVERAGE RESPONSES PER CONTRIBUTOR');
    console.log('=' .repeat(80));
    if (clinicalContributors.size > 0) {
      console.log(`Clinical: ${(surveyResponses.clinical.length / clinicalContributors.size).toFixed(1)} responses/contributor`);
    }
    if (parasomniaContributors.size > 0) {
      console.log(`Parasomnia: ${(surveyResponses.parasomnia.length / parasomniaContributors.size).toFixed(1)} responses/contributor`);
    }

    // Detailed breakdown by contributor
    console.log('\n' + '=' .repeat(80));
    console.log('RESPONSE COUNT PER CONTRIBUTOR');
    console.log('=' .repeat(80));

    // Clinical
    console.log('\nCLINICAL SLEEP SURVEY:');
    const clinicalCounts = new Map();
    for (const response of surveyResponses.clinical) {
      const cid = response.fields.contributorRecordId[0];
      clinicalCounts.set(cid, (clinicalCounts.get(cid) || 0) + 1);
    }
    const sortedClinical = Array.from(clinicalCounts.entries()).sort((a, b) => b[1] - a[1]);
    sortedClinical.forEach(([cid, count], idx) => {
      console.log(`  ${idx + 1}. ${cid.substring(0, 12)}... : ${count} responses`);
    });

    // Parasomnia
    console.log('\nPARASOMNIA SURVEY:');
    const parasomniaCounts = new Map();
    for (const response of surveyResponses.parasomnia) {
      const cid = response.fields.contributorRecordId[0];
      parasomniaCounts.set(cid, (parasomniaCounts.get(cid) || 0) + 1);
    }
    const sortedParasomnia = Array.from(parasomniaCounts.entries()).sort((a, b) => b[1] - a[1]);
    sortedParasomnia.forEach(([cid, count], idx) => {
      console.log(`  ${idx + 1}. ${cid.substring(0, 12)}... : ${count} responses`);
    });

    console.log('\n✅ Analysis complete!\n');

  } catch (error) {
    console.error('❌ Error:', error);
    process.exit(1);
  }
}

main();
