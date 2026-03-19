// src/storage/storeSurvey.js
import { reactive, computed, watch } from 'vue'

// Survey Configuration - Add new surveys here
export const SURVEY_CONFIG = {
  clinical: {
    id: 'clinical',
    name: 'Clinical Sleep',
    displayName: 'Clinical Sleep Disorders',
    description: 'Comprehensive clinical sleep disorders survey',
    airtableField: 'Include in Survey Clinical Sleep',
    isActive: false
    // no airtableConfig = uses 'default'
  },
  parasomnia: {
    id: 'parasomnia',
    name: 'Parasomnia',
    displayName: 'Parasomnia Disorders',
    description: 'Parasomnia-specific sleep disorders survey',
    airtableField: 'Include In Survey Parasomnia',
    isActive: false
  },
  abnormal: {
    id: 'abnormal',
    name: 'Abnormal',
    displayName: 'Abnormal Emotional State',
    description: 'Abnormal Emotional State survey',
    airtableField: 'Include in Abnormal Survey',
    isActive: false
  },
  Sleep_Disturbance: {
    id: 'Sleep_Disturbance',
    name: 'Sleep Disturbance',
    displayName: 'Sleep Disturbance',
    description: 'Sleep Disturbance survey',
    airtableField: 'Include In Survey Sleep disturbance',
    isActive: true
  },
  social: {
    id: 'social',
    name: 'Social',
    displayName: 'Social',
    description: 'Social survey',
    airtableField: 'Include in Survey Social',
    isActive: true,
    airtableConfig: 'social' // 👈 routes to the social Airtable base
  }
}

// =============================================================================
// AIRTABLE CONFIGURATION (multi-base support)
// =============================================================================

const AIRTABLE_CONFIGS = {
  default: {
    apiKey: import.meta.env.VITE_AIRTABLE_API_KEY,
    baseId: import.meta.env.VITE_AIRTABLE_BASE_ID,
    tables: {
      contributors: import.meta.env.VITE_AIRTABLE_TABLE_CONTRIBUTORS,
      terms:        import.meta.env.VITE_AIRTABLE_TABLE_TERMS,
      responses:    import.meta.env.VITE_AIRTABLE_TABLE_RESPONSES,
      synonyms:     import.meta.env.VITE_AIRTABLE_TABLE_SYNONYMS
    }
  },
  social: {
    apiKey: import.meta.env.VITE_AIRTABLE_API_KEY_SOCIAL,
    baseId: import.meta.env.VITE_AIRTABLE_BASE_ID_SOCIAL,
    tables: {
      contributors: import.meta.env.VITE_AIRTABLE_TABLE_CONTRIBUTORS_SOCIAL,
      terms:        import.meta.env.VITE_AIRTABLE_TABLE_TERMS_SOCIAL,
      responses:    import.meta.env.VITE_AIRTABLE_TABLE_RESPONSES_SOCIAL,
      synonyms:     import.meta.env.VITE_AIRTABLE_TABLE_SYNONYMS_SOCIAL
    }
  }
}

/**
 * Get the Airtable config object for a given survey ID
 */
function getAirtableConfig(surveyId) {
  const survey = getSurveyConfig(surveyId)
  const configKey = survey?.airtableConfig || 'default'
    // TEMP DEBUG - remove after testing
  console.log('🔑 Config key selected:', configKey)
  console.log('🔑 Social API key exists:', !!import.meta.env.VITE_AIRTABLE_API_KEY_SOCIAL)
  console.log('🔑 Social Base ID:', import.meta.env.VITE_AIRTABLE_BASE_ID_SOCIAL)
  return AIRTABLE_CONFIGS[configKey]
}

/**
 * Get the Authorization headers for a given survey ID
 */
function getAirtableHeaders(surveyId) {
  const config = getAirtableConfig(surveyId)
  return {
    'Authorization': `Bearer ${config.apiKey}`,
    'Content-Type': 'application/json'
  }
}

// =============================================================================
// GLOBAL SURVEY STORE
// =============================================================================

export const surveyStore = reactive({
  // Current Survey Session (from URL)
  contributorId: null,
  surveyType: null,
  sessionId: null,

  // Survey Data
  currentTerm: null,
  allTerms: [],
  completedTerms: [],

  // Survey Progress
  totalTerms: 0,
  progress: 0,
  isComplete: false,

  // UI State
  isLoading: false,
  error: null,

  // Cache for performance
  termsCache: new Map(),
  synonymsCache: new Map(),

  // User's Responses
  responses: new Map()
})

// =============================================================================
// SURVEY CONFIGURATION UTILITIES
// =============================================================================

export function getSurveyConfig(surveyId) {
  return SURVEY_CONFIG[surveyId] || null
}

export function getSurveyDisplayName(surveyId) {
  const config = getSurveyConfig(surveyId)
  return config ? config.displayName : surveyId
}

export function getSurveyName(surveyId) {
  const config = getSurveyConfig(surveyId)
  return config ? config.name : surveyId
}

export function getActiveSurveys() {
  return Object.values(SURVEY_CONFIG).filter(survey => survey.isActive)
}

export function getAvailableSurveys(excludeSurveyId = null) {
  return getActiveSurveys().filter(survey => survey.id !== excludeSurveyId)
}

export function getSurveyAirtableField(surveyId) {
  const config = getSurveyConfig(surveyId)
  return config ? config.airtableField : `Include in Survey ${surveyId}`
}

// =============================================================================
// COMPUTED PROPERTIES
// =============================================================================

export const surveyComputed = {
  progressPercentage: computed(() => {
    if (surveyStore.totalTerms === 0) return 0
    return Math.round((surveyStore.completedTerms.length / surveyStore.totalTerms) * 100)
  }),

  currentTermIndex: computed(() => {
    if (!surveyStore.currentTerm || surveyStore.allTerms.length === 0) return -1
    return surveyStore.allTerms.findIndex(term => term.id === surveyStore.currentTerm.id)
  }),

  nextTerm: computed(() => {
    if (!surveyStore.currentTerm || surveyStore.allTerms.length === 0) return null
    const nextTermLabel = surveyStore.currentTerm.nextTermLabel
    if (!nextTermLabel || nextTermLabel.length === 0) return null
    const targetLabel = Array.isArray(nextTermLabel) ? nextTermLabel[0] : nextTermLabel
    return surveyStore.allTerms.find(term => term.termLabel === targetLabel) || null
  }),

  currentSurveyConfig: computed(() => getSurveyConfig(surveyStore.surveyType)),
  currentSurveyDisplayName: computed(() => getSurveyDisplayName(surveyStore.surveyType)),
  availableSurveys: computed(() => getAvailableSurveys(surveyStore.surveyType))
}

// =============================================================================
// AIRTABLE API FUNCTIONS
// =============================================================================

/**
 * Fetch all contributors from Airtable.
 * Contributors are fetched from whichever base the current survey uses.
 */
export async function fetchContributors(surveyId = null) {
  // Use the current survey type from the store if no surveyId passed
  const resolvedSurveyId = surveyId || surveyStore.surveyType || 'default'
  const config = getAirtableConfig(resolvedSurveyId)
  const headers = getAirtableHeaders(resolvedSurveyId)

  try {
    const url = `https://api.airtable.com/v0/${config.baseId}/${config.tables.contributors}`
    let allContributors = []
    let offset = null

    do {
      const queryUrl = offset ? `${url}?offset=${offset}` : url
      const response = await fetch(queryUrl, { headers })
      const data = await response.json()

      if (!response.ok) {
        throw new Error(`Airtable API error: ${response.status} - ${data.error?.message}`)
      }

      const contributors = data.records.map(record => ({
        id: record.id,
        name: record.fields.fullName || 'Unknown',
        email: record.fields.email || '',
        numberOfResponses: record.fields.numberOfResponses || 0,
        nextTermLabel: record.fields.nextTermForContributor || null
      }))

      allContributors.push(...contributors)
      offset = data.offset
    } while (offset)

    console.log(`✅ Fetched ${allContributors.length} contributors`)
    return allContributors.sort((a, b) => a.name.localeCompare(b.name))

  } catch (error) {
    console.error('❌ Error fetching contributors:', error)
    throw error
  }
}

/**
 * Fetch terms for a specific survey type — routes to correct Airtable base automatically
 */
export async function fetchSurveyTerms(surveyType) {
  try {
    if (surveyStore.termsCache.has(surveyType)) {
      console.log(`📋 Using cached terms for ${getSurveyDisplayName(surveyType)}`)
      return surveyStore.termsCache.get(surveyType)
    }

    surveyStore.isLoading = true

    const config = getAirtableConfig(surveyType)
    const headers = getAirtableHeaders(surveyType)
    const url = `https://api.airtable.com/v0/${config.baseId}/${config.tables.terms}`
    const surveyField = getSurveyAirtableField(surveyType)
    const filterFormula = `AND({Melvin Reviewed}=TRUE(), {${surveyField}}=TRUE())`

    let allTerms = []
    let offset = null

    do {
      const queryUrl = `${url}?filterByFormula=${encodeURIComponent(filterFormula)}${offset ? `&offset=${offset}` : ''}`
      const response = await fetch(queryUrl, { headers })
      const data = await response.json()

      if (!response.ok) {
        throw new Error(`Airtable API error: ${response.status} - ${data.error?.message}`)
      }

      const terms = data.records.map(record => ({
        id: record.id,
        airtableRecordId: record.id,
        termLabel: record.fields.termLabel || 'Unknown Term',
        definition: record.fields.def || 'No definition available',
        hpoId: record.fields.id || '',
        parents: record.fields.parentsDoNotDelete || 'No parents',
        children: record.fields.childrenDoNotDelete || '',
        parentLink: record.fields.parentHpoLink || '#',
        synonyms: record.fields.synAndTypeDoNotDelete || 'No synonyms',
        nextTermLabel: record.fields.nextTermLabel || '',
        surveyType: surveyType
      }))

      allTerms.push(...terms)
      offset = data.offset
    } while (offset)

    surveyStore.termsCache.set(surveyType, allTerms)
    console.log(`✅ Fetched ${allTerms.length} terms for ${getSurveyDisplayName(surveyType)} survey`)
    return allTerms

  } catch (error) {
    console.error(`❌ Error fetching ${getSurveyDisplayName(surveyType)} terms:`, error)
    throw error
  } finally {
    surveyStore.isLoading = false
  }
}

/**
 * Generate consistent session ID for user/survey combination
 */
export function generateSessionId(contributorId, surveyType) {
  const sessionData = `${contributorId}_${surveyType}`
  return btoa(sessionData).replace(/[^a-zA-Z0-9]/g, '').slice(0, 16)
}

/**
 * Initialize survey session with URL params
 */
export async function initializeSurvey(contributorId, surveyType) {
  try {
    console.log(`🚀 Initializing ${getSurveyDisplayName(surveyType)} survey for contributor ${contributorId}`)

    surveyStore.contributorId = contributorId
    surveyStore.surveyType = surveyType
    surveyStore.sessionId = generateSessionId(contributorId, surveyType)
    surveyStore.error = null

    const terms = await fetchSurveyTerms(surveyType)
    surveyStore.allTerms = terms
    surveyStore.totalTerms = terms.length

    const progress = await getSurveyProgress(contributorId, surveyType, surveyStore.sessionId)

    surveyStore.completedTerms = progress.completedTerms
    surveyStore.isComplete = progress.isComplete
    surveyStore.currentTerm = progress.currentTerm

    console.log(`✅ Survey initialized:`, {
      totalTerms: surveyStore.totalTerms,
      completed: surveyStore.completedTerms.length,
      currentTerm: surveyStore.currentTerm?.termLabel,
      isComplete: surveyStore.isComplete
    })

    return {
      isComplete: surveyStore.isComplete,
      currentTerm: surveyStore.currentTerm,
      progress: progress.progress
    }

  } catch (error) {
    console.error('❌ Error initializing survey:', error)
    surveyStore.error = error.message
    throw error
  }
}

/**
 * Get survey progress from Airtable — routes to correct base via surveyType
 */
export async function getSurveyProgress(contributorId, surveyType, sessionId) {
  try {
    console.log(`🔍 Getting survey progress for contributor: ${contributorId}, survey: ${getSurveyDisplayName(surveyType)}`)

    const config = getAirtableConfig(surveyType)
    const headers = getAirtableHeaders(surveyType)

    const contributorUrl = `https://api.airtable.com/v0/${config.baseId}/Contributors/${contributorId}`
    const response = await fetch(contributorUrl, { headers })
    const data = await response.json()

    if (!response.ok) {
      throw new Error(`Failed to fetch contributor: ${response.status}`)
    }

    console.log('📋 Contributor data:', data.fields)

    const allCompletedTermIds = data.fields.termRecordIdDoNotDelete || []
    const nextTermLabel = data.fields.nextTermForContributor || null

    console.log(`📊 Total completed terms: ${allCompletedTermIds.length}`)
    console.log(`🎯 Next term label: ${nextTermLabel}`)

    const surveyTerms = await fetchSurveyTerms(surveyType)
    const surveyTermIds = surveyTerms.map(term => term.id)

    const completedSurveyTermIds = allCompletedTermIds.filter(termId =>
      surveyTermIds.includes(termId)
    )

    console.log(`📈 Completed terms for ${getSurveyDisplayName(surveyType)} survey: ${completedSurveyTermIds.length}/${surveyTerms.length}`)

    const totalTerms = surveyTerms.length
    const isComplete = completedSurveyTermIds.length >= totalTerms

    let currentTerm = null

    if (isComplete) {
      console.log('✅ Survey complete!')
    } else if (completedSurveyTermIds.length === 0) {
      console.log('🌱 First time user - finding root term')
      currentTerm = await findRootTerm(surveyType)
    } else {
      console.log('📝 Continuing survey - using nextTermLabel logic')
      if (nextTermLabel) {
        currentTerm = await extractSurveySpecificNextTerm(nextTermLabel, surveyType, surveyTerms)
      }
      if (!currentTerm) {
        console.log('🔄 Fallback: finding next uncompleted term')
        currentTerm = surveyTerms.find(term => !completedSurveyTermIds.includes(term.id))
      }
    }

    console.log('🎯 Current term:', currentTerm?.termLabel || 'None')

    return {
      completedTerms: completedSurveyTermIds,
      isComplete,
      responses: [],
      progress: Math.round((completedSurveyTermIds.length / totalTerms) * 100),
      currentTerm,
      nextTermLabel
    }

  } catch (error) {
    console.error('❌ Error getting survey progress:', error)
    return {
      completedTerms: [],
      isComplete: false,
      responses: [],
      progress: 0,
      currentTerm: null,
      nextTermLabel: null
    }
  }
}

/**
 * Find root term for survey — routes to correct Airtable base via surveyType
 */
async function findRootTerm(surveyType) {
  try {
    console.log(`🌱 Finding root term for ${getSurveyDisplayName(surveyType)} survey`)

    const config = getAirtableConfig(surveyType)
    const headers = getAirtableHeaders(surveyType)
    const url = `https://api.airtable.com/v0/${config.baseId}/${config.tables.terms}`
    const surveyField = getSurveyAirtableField(surveyType)

    const filterFormula = `AND({Melvin Reviewed}=TRUE(), {${surveyField}}=TRUE(), {rootTerm}=TRUE())`
    const queryUrl = `${url}?filterByFormula=${encodeURIComponent(filterFormula)}`

    console.log('🔍 Root term filter formula:', filterFormula)
    console.log('🔍 Root term query URL:', queryUrl)
    console.log('🔍 Survey field being used:', surveyField)

    const response = await fetch(queryUrl, { headers })
    const data = await response.json()

    console.log('📋 Airtable response status:', response.status)
    console.log('📋 Airtable response data:', data)

    if (!response.ok) {
      console.error('❌ Airtable API error details:', {
        status: response.status,
        statusText: response.statusText,
        errorData: data
      })
      throw new Error(`Airtable API error: ${response.status} - ${data.error?.message || 'Unknown error'}`)
    }

    if (data.records && data.records.length > 0) {
      const rootRecord = data.records[0]
      const rootTerm = {
        id: rootRecord.id,
        airtableRecordId: rootRecord.id,
        termLabel: rootRecord.fields.termLabel || 'Unknown Term',
        definition: rootRecord.fields.def || 'No definition available',
        hpoId: rootRecord.fields.id || '',
        parents: rootRecord.fields.parentsDoNotDelete || 'No parents',
        parentLink: rootRecord.fields.parentHpoLink || '#',
        synonyms: rootRecord.fields.synAndTypeDoNotDelete || 'No synonyms',
        nextTermLabel: rootRecord.fields.nextTermLabel || '',
        surveyType: surveyType
      }

      console.log(`✅ Found root term: ${rootTerm.termLabel}`)
      return rootTerm
    }

    console.warn(`⚠️ No root term found for ${getSurveyDisplayName(surveyType)} survey`)
    return null

  } catch (error) {
    console.error('❌ Error finding root term:', error)
    return null
  }
}

/**
 * Extract survey-specific next term from nextTermLabel
 */
async function extractSurveySpecificNextTerm(nextTermLabel, surveyType, surveyTerms) {
  if (!nextTermLabel) return null

  console.log(`🔍 Extracting next term from: "${nextTermLabel}" for ${getSurveyDisplayName(surveyType)} survey`)

  const nextTerms = nextTermLabel.includes(',')
    ? nextTermLabel.split(',').map(t => t.trim())
    : [nextTermLabel.trim()]

  const validTermLabels = surveyTerms.map(term => term.termLabel)

  const surveySpecificTermLabel = nextTerms.find(termLabel =>
    validTermLabels.includes(termLabel)
  )

  if (surveySpecificTermLabel) {
    const nextTerm = surveyTerms.find(term => term.termLabel === surveySpecificTermLabel)
    console.log(`✅ Found survey-specific next term: ${surveySpecificTermLabel}`)
    return nextTerm
  }

  console.log(`⚠️ No valid next term found for ${getSurveyDisplayName(surveyType)} survey`)
  return null
}

/**
 * Get total term count for survey type
 */
export async function getSurveyTermCount(surveyType) {
  try {
    const terms = await fetchSurveyTerms(surveyType)
    return terms.length
  } catch (error) {
    console.error('Error getting survey term count:', error)
    return 0
  }
}

/**
 * Save user response to Airtable — routes to correct base via surveyStore.surveyType
 */
export async function saveResponse(termId, responseData) {
  try {
    console.log(`💾 Saving response for term ${termId}:`, responseData)

    const config = getAirtableConfig(surveyStore.surveyType)
    const headers = getAirtableHeaders(surveyStore.surveyType)
    const url = `https://api.airtable.com/v0/${config.baseId}/${config.tables.responses}`

    const existingResponse = await findExistingResponse(surveyStore.contributorId, termId, surveyStore.sessionId)

    const airtableFields = {
      CONTRIBUTOR: [surveyStore.contributorId],
      TERM: [termId],
      formTimestamp: new Date().toISOString(),
      definitionRating: responseData.definitionRating || null,
      labelRating: responseData.labelRating || null,
      hierarchyRating: responseData.hierarchyRating || null,
      synonymRating: responseData.synonymRating || null,
      suggestedDefinition: responseData.suggestedDefinition || null,
      suggestedLabel: responseData.suggestedLabel || null,
      suggestedSynonyms: responseData.suggestedSynonyms || null,
      otherSuggestions: responseData.otherSuggestions || null
    }

    let result

    if (existingResponse) {
      const updateUrl = `${url}/${existingResponse.id}`
      const updateResponse = await fetch(updateUrl, {
        method: 'PATCH',
        headers,
        body: JSON.stringify({ fields: airtableFields })
      })

      result = await updateResponse.json()
      if (!updateResponse.ok) {
        throw new Error(`Update failed: ${result.error?.message}`)
      }

      console.log('✅ Updated existing response')
    } else {
      const createResponse = await fetch(url, {
        method: 'POST',
        headers,
        body: JSON.stringify({ records: [{ fields: airtableFields }] })
      })

      const createData = await createResponse.json()
      if (!createResponse.ok) {
        throw new Error(`Create failed: ${createData.error?.message}`)
      }

      result = createData.records[0]
      console.log('✅ Created new response')
    }

    surveyStore.responses.set(termId, {
      id: result.id,
      termId,
      ...responseData
    })

    if (!surveyStore.completedTerms.includes(termId)) {
      surveyStore.completedTerms.push(termId)
    }

    surveyStore.isComplete = surveyStore.completedTerms.length >= surveyStore.totalTerms

    return result

  } catch (error) {
    console.error('❌ Error saving response:', error)
    throw error
  }
}

/**
 * Find existing response record — routes to correct base via surveyStore.surveyType
 */
async function findExistingResponse(contributorId, termId, sessionId) {
  try {
    const config = getAirtableConfig(surveyStore.surveyType)
    const headers = getAirtableHeaders(surveyStore.surveyType)
    const url = `https://api.airtable.com/v0/${config.baseId}/${config.tables.responses}`
    const filterFormula = `AND(contributorRecordId="${contributorId}", termRecordId="${termId}")`
    const queryUrl = `${url}?filterByFormula=${encodeURIComponent(filterFormula)}`

    const response = await fetch(queryUrl, { headers })
    const data = await response.json()

    if (!response.ok) return null
    return data.records.length > 0 ? data.records[0] : null

  } catch (error) {
    console.log('⚠️ Could not check for existing response:', error)
    return null
  }
}

/**
 * Search synonyms from Airtable — routes to correct base via surveyStore.surveyType
 */
export async function searchSynonyms(searchTerm) {
  try {
    const cacheKey = searchTerm || '__ALL__'
    if (surveyStore.synonymsCache.has(cacheKey)) {
      console.log(`📋 Using cached synonyms for: "${searchTerm || 'ALL'}"`)
      return surveyStore.synonymsCache.get(cacheKey)
    }

    const config = getAirtableConfig(surveyStore.surveyType)
    const headers = getAirtableHeaders(surveyStore.surveyType)
    const url = `https://api.airtable.com/v0/${config.baseId}/${config.tables.synonyms}`

    let allSynonyms = []
    let offset = null

    do {
      let queryUrl = url
      const params = new URLSearchParams()

      if (searchTerm && searchTerm.trim() !== '') {
        const filterFormula = `SEARCH("${searchTerm.toLowerCase()}", LOWER({synAndTypeDoNotDelete}))`
        params.append('filterByFormula', filterFormula)
        params.append('maxRecords', '10')
      }

      if (offset) {
        params.append('offset', offset)
      }

      if (params.toString()) {
        queryUrl += `?${params.toString()}`
      }

      console.log(`🔍 Fetching synonyms... (search: "${searchTerm || 'ALL'}", offset: ${offset || 'none'})`)

      const response = await fetch(queryUrl, { headers })
      const data = await response.json()

      if (!response.ok) {
        throw new Error(`Airtable API error: ${response.status} - ${data.error?.message}`)
      }

      if (!data.records || data.records.length === 0) break

      const synonymsPage = data.records.map(record => ({
        id: record.id,
        text: record.fields.synAndTypeDoNotDelete || 'Unknown'
      }))

      allSynonyms = allSynonyms.concat(synonymsPage)
      offset = data.offset

      console.log(`📄 Loaded ${synonymsPage.length} synonyms from this page (total: ${allSynonyms.length})`)

      if (searchTerm && searchTerm.trim() !== '' && allSynonyms.length >= 10) break

    } while (offset)

    console.log(`✅ Total synonyms loaded: ${allSynonyms.length} for search: "${searchTerm || 'ALL'}"`)

    surveyStore.synonymsCache.set(cacheKey, allSynonyms)
    return allSynonyms

  } catch (error) {
    console.error('❌ Error searching synonyms:', error)
    return []
  }
}

/**
 * Move to next term
 */
export function moveToNextTerm() {
  const nextTerm = surveyComputed.nextTerm.value
  if (nextTerm) {
    surveyStore.currentTerm = nextTerm
    return nextTerm
  } else {
    surveyStore.isComplete = true
    return null
  }
}

/**
 * Move to previous term in survey flow
 */
export function moveToPreviousTerm() {
  if (surveyStore.completedTerms.length === 0) {
    console.log('No previous terms available')
    return null
  }

  const previousTermId = surveyStore.completedTerms[surveyStore.completedTerms.length - 1]
  const previousTerm = surveyStore.allTerms.find(term => term.id === previousTermId)

  if (previousTerm) {
    surveyStore.completedTerms.pop()
    surveyStore.currentTerm = previousTerm
    surveyStore.isComplete = false
    console.log(`⬅️ Moved back to: ${previousTerm.termLabel}`)
    return previousTerm
  }

  return null
}

/**
 * Reset survey store (useful for switching surveys)
 */
export function resetSurveyStore() {
  surveyStore.contributorId = null
  surveyStore.surveyType = null
  surveyStore.sessionId = null
  surveyStore.currentTerm = null
  surveyStore.allTerms = []
  surveyStore.completedTerms = []
  surveyStore.totalTerms = 0
  surveyStore.isComplete = false
  surveyStore.isLoading = false
  surveyStore.error = null
  surveyStore.responses.clear()
}

/**
 * Watch for URL changes and sync store (if using Vue Router)
 */
export function syncStoreWithURL(route) {
  if (route.query.contributor !== surveyStore.contributorId ||
      route.query.survey !== surveyStore.surveyType) {
    if (route.query.contributor && route.query.survey) {
      initializeSurvey(route.query.contributor, route.query.survey)
    }
  }
}

export default {
  SURVEY_CONFIG,
  surveyStore,
  surveyComputed,
  getSurveyConfig,
  getSurveyDisplayName,
  getSurveyName,
  getActiveSurveys,
  getAvailableSurveys,
  getSurveyAirtableField,
  fetchContributors,
  fetchSurveyTerms,
  initializeSurvey,
  getSurveyProgress,
  saveResponse,
  searchSynonyms,
  moveToNextTerm,
  moveToPreviousTerm,
  resetSurveyStore,
  syncStoreWithURL
}