#!/usr/bin/env node

/**
 * Terms Upload Script
 * Uploads terms from Excel sheet to Airtable Terms table
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
  termsTableId: process.env.VITE_AIRTABLE_TABLE_TERMS
};

// Excel file path (in same directory)
const EXCEL_FILE = join(__dirname, 'Sleep_disturbance_HP-0002360.xlsx');

// ============================================================================
// IMPORTANT: Set the target date for filtering terms to update
// Only terms with this labelTimestamp will be updated in Pass 2
// ============================================================================
const TARGET_DATE = '2025-11-11';  // Format: YYYY-MM-DD

// Column mapping from Excel to Airtable fields
const COLUMN_MAPPING = {
  'termLabel': 'termLabel',
  'PARENTS': 'PARENTS',
  'CHILDREN': 'CHILDREN',  // Excel column CHILDREN -> Airtable field CHILDREN
  'ID': 'ID',
  'SYNONYM': 'SYNONYM',
  'def': 'def',
  'termComments': 'termComment'
};

// Fields that are linked records (need to be handled in second pass)
const LINKED_FIELDS = ['PARENTS', 'CHILDREN', 'SYNONYM'];

// Fields to upload in first pass (non-linked fields)
const FIRST_PASS_FIELDS = ['termLabel', 'ID', 'def', 'termComments'];

/**
 * Read Excel file and extract terms
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
    console.error('L Error reading Excel file:', error);
    throw error;
  }
}

/**
 * Transform Excel row to Airtable record format (first pass - no linked fields)
 */
function transformToAirtableRecord(row, includeLinkedFields = false) {
  const fields = {};

  for (const [excelCol, airtableField] of Object.entries(COLUMN_MAPPING)) {
    // Skip linked fields in first pass
    if (!includeLinkedFields && LINKED_FIELDS.includes(airtableField)) {
      continue;
    }

    // Check if the column exists in the Excel row
    if (row[excelCol] !== undefined && row[excelCol] !== null && row[excelCol] !== '') {
      fields[airtableField] = row[excelCol];
    }
  }

  return { fields };
}

/**
 * Upsert records to Airtable in batches (create or update)
 */
async function upsertToAirtable(records, excelData, existingTerms) {
  const url = `https://api.airtable.com/v0/${AIRTABLE_CONFIG.baseId}/${AIRTABLE_CONFIG.termsTableId}`;
  const BATCH_SIZE = 10;

  let created = 0;
  let updated = 0;
  let skipped = 0;
  let failed = 0;

  // Build lookup of existing terms by termLabel
  const existingLookup = new Map();
  for (const term of existingTerms) {
    if (term.fields.termLabel) {
      existingLookup.set(term.fields.termLabel, term);
    }
  }

  // Separate records into create and update batches
  const recordsToCreate = [];
  const recordsToUpdate = [];

  for (let i = 0; i < records.length; i++) {
    const record = records[i];
    const excelRow = excelData[i];
    const termLabel = excelRow.termLabel;

    const existing = existingLookup.get(termLabel);

    if (!existing) {
      // Term doesn't exist - create it
      recordsToCreate.push(record);
    } else {
      // Term exists - check if fields changed
      const needsUpdate =
        (excelRow.ID && existing.fields.ID !== excelRow.ID) ||
        (excelRow.id && existing.fields.id !== excelRow.id) ||
        (excelRow.def && existing.fields.def !== excelRow.def) ||
        (excelRow.termComments && existing.fields.termComments !== excelRow.termComments);

      if (needsUpdate) {
        recordsToUpdate.push({ id: existing.id, fields: record.fields });
      } else {
        skipped++;
      }
    }
  }

  console.log(`\nRecords to create: ${recordsToCreate.length}`);
  console.log(`Records to update: ${recordsToUpdate.length}`);
  console.log(`Records to skip: ${skipped}\n`);

  try {
    // Create new records
    if (recordsToCreate.length > 0) {
      console.log('Creating new records...');
      for (let i = 0; i < recordsToCreate.length; i += BATCH_SIZE) {
        const batch = recordsToCreate.slice(i, i + BATCH_SIZE);

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
          console.error(`Create batch ${Math.floor(i / BATCH_SIZE) + 1} failed:`, errorText);
          failed += batch.length;
        } else {
          const result = await response.json();
          created += result.records.length;
          console.log(`Created batch ${Math.floor(i / BATCH_SIZE) + 1}: ${result.records.length} records`);
        }

        if (i + BATCH_SIZE < recordsToCreate.length) {
          await new Promise(resolve => setTimeout(resolve, 200));
        }
      }
    }

    // Update existing records
    if (recordsToUpdate.length > 0) {
      console.log('\nUpdating existing records...');
      for (let i = 0; i < recordsToUpdate.length; i += BATCH_SIZE) {
        const batch = recordsToUpdate.slice(i, i + BATCH_SIZE);

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
          console.error(`Update batch ${Math.floor(i / BATCH_SIZE) + 1} failed:`, errorText);
          failed += batch.length;
        } else {
          const result = await response.json();
          updated += result.records.length;
          console.log(`Updated batch ${Math.floor(i / BATCH_SIZE) + 1}: ${result.records.length} records`);
        }

        if (i + BATCH_SIZE < recordsToUpdate.length) {
          await new Promise(resolve => setTimeout(resolve, 200));
        }
      }
    }

    console.log(`\nUpsert Summary:`);
    console.log(`   Created: ${created}`);
    console.log(`   Updated: ${updated}`);
    console.log(`   Skipped: ${skipped}`);
    console.log(`   Failed: ${failed}`);
    console.log(`   Total: ${records.length}`);

    return created + updated;

  } catch (error) {
    console.error('Error upserting to Airtable:', error);
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

    return terms;
  } catch (error) {
    console.error('L Error fetching terms:', error);
    throw error;
  }
}

/**
 * Update records with linked fields (PARENTS and CHILDERN)
 */
async function updateLinkedFields(excelData) {
  console.log('\nFetching all terms to build lookup map...');
  const allTerms = await fetchAllTerms();

  // Build lookup map for ALL terms (so we can find parents/children by name)
  const allTermsLookup = new Map();
  for (const record of allTerms) {
    const termLabel = record.fields.termLabel;
    if (termLabel) {
      allTermsLookup.set(termLabel, record.id);
    }
  }

  // Build lookup ONLY for terms with the target date (these we will UPDATE)
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

    // Process PARENTS (use allTermsLookup to find parents from entire table)
    if (row.PARENTS) {
      const parentNames = row.PARENTS.split(',').map(p => p.trim());
      const parentIds = parentNames
        .map(name => allTermsLookup.get(name))
        .filter(id => id !== undefined);

      if (parentIds.length > 0) {
        fields.PARENTS = parentIds;
      }
    }

    // Process CHILDREN (use allTermsLookup to find children from entire table)
    if (row.CHILDREN) {
      const childrenNames = row.CHILDREN.split(',').map(c => c.trim());
      const childrenIds = childrenNames
        .map(name => allTermsLookup.get(name))
        .filter(id => id !== undefined);

      if (childrenIds.length > 0) {
        fields.CHILDREN = childrenIds;
      }
    }

    // Note: SYNONYM is also a linked field but we skip it for now
    // It will need special handling later

    // Only add if there are fields to update
    if (Object.keys(fields).length > 0) {
      updateRecords.push({ id: recordId, fields });
    } else {
      skipped++;
    }
  }

  console.log(`= Updating ${updateRecords.length} records with linked fields...\n`);

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
      console.error(`L Update batch ${Math.floor(i / BATCH_SIZE) + 1} failed:`, errorText);
    } else {
      const result = await response.json();
      updated += result.records.length;
      console.log(`Updated batch ${Math.floor(i / BATCH_SIZE) + 1}: ${result.records.length} records`);
    }

    // Rate limiting
    if (i + BATCH_SIZE < updateRecords.length) {
      await new Promise(resolve => setTimeout(resolve, 200));
    }
  }

  console.log(`\n= Update Summary:`);
  console.log(`  Updated: ${updated}`);
  console.log(`  Skipped: ${skipped}`);
  console.log(`  Total: ${excelData.length}`);
}

/**
 * Main function
 */
async function main() {
  try {
    console.log('Starting Terms Upload (Two-Pass Approach)...\n');

    // Read Excel file
    console.log('Reading Excel file...');
    const excelData = await readExcelFile(EXCEL_FILE);

    if (excelData.length === 0) {
      console.log(' No data found in Excel file');
      return;
    }

    // PASS 1: Upsert basic fields (create or update, no linked records)
    console.log('\n' + '='.repeat(80));
    console.log('PASS 1: Upserting records with basic fields');
    console.log('='.repeat(80));

    // Fetch existing terms
    console.log('\nFetching existing terms...');
    const existingTerms = await fetchAllTerms();

    const airtableRecords = excelData
      .map(row => transformToAirtableRecord(row, false))
      .filter(record => Object.keys(record.fields).length > 0);

    console.log(`Prepared ${airtableRecords.length} records for upsert`);

    // Upsert to Airtable (create new, update changed, skip unchanged)
    const upserted = await upsertToAirtable(airtableRecords, excelData, existingTerms);

    if (upserted === 0) {
      console.log('\nNo records were created or updated. Skipping second pass.');
    }

    // PASS 2: Update with linked fields
    console.log('\n' + '='.repeat(80));
    console.log('PASS 2: Updating records with linked fields (PARENTS & CHILDERN)');
    console.log('='.repeat(80));

    await updateLinkedFields(excelData);

    console.log('\n Upload complete!\n');

  } catch (error) {
    console.error('L Upload failed:', error);
    process.exit(1);
  }
}

// Run
main();
