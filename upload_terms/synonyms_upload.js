#!/usr/bin/env node

/**
 * Synonyms Upload Script
 * 1. Uploads synonyms to Synonyms table
 * 2. Links synonyms to Terms table
 * 3. Updates Terms with ID field
 */

import dotenv from 'dotenv';
import * as XLSX from 'xlsx';
import { readFile } from 'fs/promises';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Load .env from parent directory
dotenv.config({ path: join(__dirname, '..', '.env') });

// Airtable Configuration
const AIRTABLE_CONFIG = {
  apiKey: process.env.VITE_AIRTABLE_API_KEY,
  baseId: process.env.VITE_AIRTABLE_BASE_ID,
  termsTableId: process.env.VITE_AIRTABLE_TABLE_TERMS,
  synonymsTableId: process.env.VITE_AIRTABLE_TABLE_SYNONYMS
};

// Excel file path (in same directory)
const EXCEL_FILE = join(__dirname, 'Sleep_disturbance_HP-0002360.xlsx');

// ============================================================================
// IMPORTANT: Set the target date for filtering terms to update
// Only terms with this labelTimestamp will have IDs and synonyms updated
// ============================================================================
const TARGET_DATE = '2025-11-11';  // Format: YYYY-MM-DD

/**
 * Read Excel file and extract data
 */
async function readExcelFile(filePath) {
  try {
    const fileBuffer = await readFile(filePath);
    const workbook = XLSX.read(fileBuffer, { type: 'buffer' });

    // Get the first sheet
    const sheetName = workbook.SheetNames[0];
    const worksheet = workbook.Sheets[sheetName];

    // Convert to JSON
    const data = XLSX.utils.sheet_to_json(worksheet);

    console.log(`Read ${data.length} rows from Excel file`);
    return data;
  } catch (error) {
    console.error('Error reading Excel file:', error);
    throw error;
  }
}

/**
 * Fetch all existing terms from Airtable
 */
async function fetchAllTerms() {
  const url = `https://api.airtable.com/v0/${AIRTABLE_CONFIG.baseId}/${AIRTABLE_CONFIG.termsTableId}`;
  const terms = [];
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
        throw new Error(`Failed to fetch terms: ${response.statusText}`);
      }

      const data = await response.json();
      terms.push(...data.records);
      offset = data.offset;

    } while (offset);

    console.log(`Fetched ${terms.length} terms from Airtable`);
    return terms;
  } catch (error) {
    console.error('Error fetching terms:', error);
    throw error;
  }
}

/**
 * Fetch all existing synonyms from Airtable
 */
async function fetchAllSynonyms() {
  const url = `https://api.airtable.com/v0/${AIRTABLE_CONFIG.baseId}/${AIRTABLE_CONFIG.synonymsTableId}`;
  const synonyms = [];
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
        throw new Error(`Failed to fetch synonyms: ${response.statusText}`);
      }

      const data = await response.json();
      synonyms.push(...data.records);
      offset = data.offset;

    } while (offset);

    console.log(`Fetched ${synonyms.length} existing synonyms from Airtable`);
    return synonyms;
  } catch (error) {
    console.error('Error fetching synonyms:', error);
    throw error;
  }
}

/**
 * Upload synonyms to Synonyms table
 */
async function uploadSynonyms(synonymsData) {
  const url = `https://api.airtable.com/v0/${AIRTABLE_CONFIG.baseId}/${AIRTABLE_CONFIG.synonymsTableId}`;
  const BATCH_SIZE = 10;

  let uploaded = 0;
  let failed = 0;
  const createdSynonyms = [];

  // Prepare synonym records using synonymLabel (the writable field)
  const synonymRecords = synonymsData.map(syn => ({
    fields: {
      synonymLabel: syn
    }
  }));

  console.log(`Uploading ${synonymRecords.length} unique synonyms...\n`);

  try {
    // Upload in batches
    for (let i = 0; i < synonymRecords.length; i += BATCH_SIZE) {
      const batch = synonymRecords.slice(i, i + BATCH_SIZE);

      const response = await fetch(url, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${AIRTABLE_CONFIG.apiKey}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ records: batch })
      });

      if (!response.ok) {
        const errorText = await response.text();
        console.error(`Batch ${Math.floor(i / BATCH_SIZE) + 1} failed:`, errorText);
        failed += batch.length;
      } else {
        const result = await response.json();
        uploaded += result.records.length;
        createdSynonyms.push(...result.records);
        console.log(`Uploaded batch ${Math.floor(i / BATCH_SIZE) + 1}: ${result.records.length} synonyms`);
      }

      // Rate limiting
      if (i + BATCH_SIZE < synonymRecords.length) {
        await new Promise(resolve => setTimeout(resolve, 200));
      }
    }

    console.log(`\nSynonym Upload Summary:`);
    console.log(`   Uploaded: ${uploaded}`);
    console.log(`   Failed: ${failed}`);
    console.log(`   Total: ${synonymRecords.length}`);

    return createdSynonyms;

  } catch (error) {
    console.error('Error uploading synonyms:', error);
    throw error;
  }
}

/**
 * Link synonyms to terms and update ID field
 */
async function linkSynonymsAndUpdateIds(excelData, allTerms, existingSynonyms) {
  console.log('\nBuilding lookup maps...');

  // Build term lookup: termLabel -> recordId
  // Only include terms with the target date specified at top of file
  const termLookup = new Map();

  for (const record of allTerms) {
    const termLabel = record.fields.termLabel;
    const labelTimestamp = record.fields.labelTimestamp;

    if (termLabel && labelTimestamp && (
      labelTimestamp === TARGET_DATE ||
      labelTimestamp === '11/11/2025' ||
      labelTimestamp === '2025-11-11T00:00:00.000Z' ||
      labelTimestamp.startsWith('2025-11-11')
    )) {
      termLookup.set(termLabel, record.id);
    }
  }

  // Build synonym lookup: synonym text -> recordId
  const synonymLookup = new Map();
  for (const record of existingSynonyms) {
    const synText = record.fields.synAndTypeDoNotDelete;
    if (synText) {
      synonymLookup.set(synText, record.id);
    }
  }

  console.log(`Found ${termLookup.size} terms with labelTimestamp = 11/11/2025\n`);

  const url = `https://api.airtable.com/v0/${AIRTABLE_CONFIG.baseId}/${AIRTABLE_CONFIG.termsTableId}`;
  const BATCH_SIZE = 10;

  let updated = 0;
  let skipped = 0;

  // Prepare update records
  const updateRecords = [];

  for (const row of excelData) {
    const termLabel = row.termLabel;

    if (!termLabel || !termLookup.has(termLabel)) {
      skipped++;
      continue;
    }

    const recordId = termLookup.get(termLabel);
    const fields = {};

    // Update id field if present
    if (row.ID) {
      fields.id = row.ID;
    } else if (row.id) {
      fields.id = row.id;
    }

    // Link synonyms if present
    if (row.SYNONYM) {
      const synonymTexts = row.SYNONYM.split(',').map(s => s.trim());
      const synonymIds = synonymTexts
        .map(text => synonymLookup.get(text))
        .filter(id => id !== undefined);

      if (synonymIds.length > 0) {
        fields.SYNONYM = synonymIds;
      }
    }

    // Only add if there are fields to update
    if (Object.keys(fields).length > 0) {
      updateRecords.push({ id: recordId, fields });
    } else {
      skipped++;
    }
  }

  console.log(`Updating ${updateRecords.length} terms...\n`);

  // Update in batches
  for (let i = 0; i < updateRecords.length; i += BATCH_SIZE) {
    const batch = updateRecords.slice(i, i + BATCH_SIZE);

    const response = await fetch(url, {
      method: 'PATCH',
      headers: {
        'Authorization': `Bearer ${AIRTABLE_CONFIG.apiKey}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ records: batch })
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error(` Update batch ${Math.floor(i / BATCH_SIZE) + 1} failed:`, errorText);
    } else {
      const result = await response.json();
      updated += result.records.length;
      console.log(` Updated batch ${Math.floor(i / BATCH_SIZE) + 1}: ${result.records.length} terms`);
    }

    // Rate limiting
    if (i + BATCH_SIZE < updateRecords.length) {
      await new Promise(resolve => setTimeout(resolve, 200));
    }
  }

  console.log(`\nUpdate Summary:`);
  console.log(`   Updated: ${updated}`);
  console.log(`   Skipped: ${skipped}`);
  console.log(`   Total: ${excelData.length}`);
}

/**
 * Main function
 */
async function main() {
  try {
    console.log('Starting Synonyms Upload and Linking...\n');

    // Read Excel file
    console.log('Reading Excel file...');
    const excelData = await readExcelFile(EXCEL_FILE);

    if (excelData.length === 0) {
      console.log('No data found in Excel file');
      return;
    }

    // Extract all unique synonyms from Excel
    console.log('\nExtracting unique synonyms from Excel...');
    const allSynonymsSet = new Set();

    for (const row of excelData) {
      if (row.SYNONYM) {
        const synonyms = row.SYNONYM.split(',').map(s => s.trim());
        synonyms.forEach(syn => {
          if (syn && syn.length > 0) {
            allSynonymsSet.add(syn);
          }
        });
      }
    }

    const uniqueSynonyms = Array.from(allSynonymsSet);
    console.log(`Found ${uniqueSynonyms.length} unique synonyms\n`);

    // Fetch existing synonyms to avoid duplicates
    console.log('Checking for existing synonyms...');
    const existingSynonyms = await fetchAllSynonyms();
    const existingSynonymTexts = new Set(
      existingSynonyms.map(s => s.fields.synAndTypeDoNotDelete)
    );

    // Filter out synonyms that already exist
    const newSynonyms = uniqueSynonyms.filter(syn => !existingSynonymTexts.has(syn));
    console.log(`Found ${newSynonyms.length} new synonyms to upload\n`);

    if (newSynonyms.length > 0) {
      // STEP 1: Upload new synonyms
      console.log('=' .repeat(80));
      console.log('STEP 1: Uploading new synonyms to Synonyms table');
      console.log('=' .repeat(80));

      console.log(`\nAbout to upload ${newSynonyms.length} new synonyms`);
      console.log('Press Ctrl+C to cancel, or wait 3 seconds to continue...\n');
      await new Promise(resolve => setTimeout(resolve, 3000));

      const createdSynonyms = await uploadSynonyms(newSynonyms);

      // Add newly created synonyms to existing list
      existingSynonyms.push(...createdSynonyms);
    } else {
      console.log('All synonyms already exist, skipping upload\n');
    }

    // STEP 2: Fetch all terms
    console.log('\n' + '=' .repeat(80));
    console.log('STEP 2: Fetching terms and linking synonyms');
    console.log('=' .repeat(80));

    const allTerms = await fetchAllTerms();

    // STEP 3: Link synonyms to terms and update IDs
    await linkSynonymsAndUpdateIds(excelData, allTerms, existingSynonyms);

    console.log('\nSynonyms upload and linking complete!\n');

  } catch (error) {
    console.error('Upload failed:', error);
    process.exit(1);
  }
}

// Run
main();
