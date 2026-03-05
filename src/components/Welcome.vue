<template>
  <!-- Michigan Logo Header -->
  <div class="michigan-logo-header">
    <img src="/image/Michigan-logo.png" alt="University of Michigan" class="michigan-logo">
  </div>
  
  <div class="welcome-container">
    <div class="container">
      <!-- Header -->
      <div class="header">
        <h1>HPO Term Survey</h1>
        <p>Help improve the Human Phenotype Ontology (HPO)!</p>
      </div>

      <!-- Survey Content -->
      <div class="survey-content">
        <!-- Welcome Message (if contributor auto-selected) -->
        <div v-if="welcomeMessage" class="welcome-message" v-html="welcomeMessage"></div>

        <!-- Error Message -->
        <div v-if="error" class="error">
          {{ error }}
        </div>

        <!-- Loading State -->
        <div v-if="isLoading" class="loading">
          <p>Loading contributors...</p>
        </div>

        <!-- Welcome Screen -->
        <div v-else class="welcome-screen">
          <!-- Contributor Selection -->
          <div class="contributor-select">
            <label for="contributorSelect">Please select your contributor record:</label>
            <select 
              id="contributorSelect" 
              v-model="selectedContributorId"
              class="contributor-dropdown"
              @change="onContributorChange"
            >
              <option value="">Please select a contributor...</option>
              <option 
                v-for="contributor in contributors" 
                :key="contributor.id" 
                :value="contributor.id"
              >
                {{ contributor.name }}
              </option>
            </select>
          </div>

          <!-- Survey Status Display -->
          <div v-if="surveyStatus" class="survey-status">
            <div class="survey-info">
              <h3>{{ surveyDisplayName }} Survey</h3>
              <div v-if="surveyStatus.progress > 0" class="progress-info">
                <p>Progress: {{ surveyStatus.progress }}% complete</p>
                <div class="progress-bar">
                  <div 
                    class="progress-fill" 
                    :style="{ width: surveyStatus.progress + '%' }"
                  ></div>
                </div>
                <p v-if="surveyStatus.currentTerm">
                  Resume from: <strong>{{ surveyStatus.currentTerm.termLabel }}</strong>
                </p>
              </div>
            </div>
          </div>

          <!-- Action Button -->
          <div class="button-group">
            <div></div>
            <button 
              class="btn" 
              @click="startSurvey" 
              :disabled="!canStartSurvey"
            >
              {{ buttonText }}
            </button>
          </div>
        </div>
      </div>
    </div>
  </div>

  <!-- ============================================================ -->
  <!-- ZOIDBERG TEST USER MODAL                                      -->
  <!-- ============================================================ -->
  <Teleport to="body">
    <div v-if="showZoidbergModal" class="zoidberg-overlay" @click.self="null">
      <div class="zoidberg-modal">

        <!-- Warning Banner -->
        <div class="zoidberg-warning-banner">
          <span class="zoidberg-warning-icon">⚠️</span>
          <span>WARNING: TEST ACCOUNT DETECTED</span>
        </div>

        <div class="zoidberg-body">
          <p class="zoidberg-description">
            You are currently using a <strong>TEST account</strong>. Please provide your real information below to update your contributor record.
          </p>

          <!-- Form Fields -->
          <div class="zoidberg-form">

            <div class="zoidberg-field">
              <label>First Name <span class="required">*</span></label>
              <input
                v-model="zoidbergForm.firstName"
                type="text"
                placeholder="Enter your first name"
                :class="{ 'input-error': zoidbergErrors.firstName }"
                @input="zoidbergErrors.firstName = ''"
              />
              <span v-if="zoidbergErrors.firstName" class="field-error">{{ zoidbergErrors.firstName }}</span>
            </div>

            <div class="zoidberg-field">
              <label>Last Name <span class="required">*</span></label>
              <input
                v-model="zoidbergForm.lastName"
                type="text"
                placeholder="Enter your last name"
                :class="{ 'input-error': zoidbergErrors.lastName }"
                @input="zoidbergErrors.lastName = ''"
              />
              <span v-if="zoidbergErrors.lastName" class="field-error">{{ zoidbergErrors.lastName }}</span>
            </div>

            <div class="zoidberg-field">
              <label>Preferred First Name <span class="required">*</span></label>
              <input
                v-model="zoidbergForm.preferredFirstName"
                type="text"
                placeholder="Enter your preferred first name"
                :class="{ 'input-error': zoidbergErrors.preferredFirstName }"
                @input="zoidbergErrors.preferredFirstName = ''"
              />
              <span v-if="zoidbergErrors.preferredFirstName" class="field-error">{{ zoidbergErrors.preferredFirstName }}</span>
            </div>

            <div class="zoidberg-field">
              <label>Email <span class="required">*</span></label>
              <input
                v-model="zoidbergForm.email"
                type="email"
                placeholder="Enter your email address"
                :class="{ 'input-error': zoidbergErrors.email }"
                @input="zoidbergErrors.email = ''"
              />
              <span v-if="zoidbergErrors.email" class="field-error">{{ zoidbergErrors.email }}</span>
            </div>

          </div>

          <!-- Submit Error -->
          <div v-if="zoidbergSubmitError" class="zoidberg-submit-error">
            {{ zoidbergSubmitError }}
          </div>

          <!-- Success Message -->
          <div v-if="zoidbergSuccess" class="zoidberg-success">
            ✅ Your information has been updated successfully!
          </div>

          <!-- Buttons -->
          <div class="zoidberg-actions">
            <button
              class="zoidberg-submit-btn"
              @click="submitZoidbergForm"
              :disabled="zoidbergSubmitting || zoidbergSuccess"
            >
              <span v-if="zoidbergSubmitting" class="zoidberg-spinner"></span>
              <span v-else-if="zoidbergSuccess">Saved!</span>
              <span v-else>Submit &amp; Continue</span>
            </button>
          </div>

        </div>
      </div>
    </div>
  </Teleport>

</template>

<script setup>
import { ref, computed, onMounted, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { 
  fetchContributors, 
  initializeSurvey, 
  surveyStore,
  resetSurveyStore,
  getSurveyDisplayName,
  getSurveyName
} from '@/storage/storeSurvey.js'

const route = useRoute()
const router = useRouter()

// Reactive data
const contributors = ref([])
const selectedContributorId = ref('')
const isLoading = ref(true)
const error = ref(null)
const welcomeMessage = ref('')
const surveyStatus = ref(null)

// ── Zoidberg modal state ──────────────────────────────────────────
const showZoidbergModal = ref(false)
const zoidbergContributorId = ref(null)   // record ID to PATCH
const zoidbergForm = ref({
  firstName: '',
  lastName: '',
  preferredFirstName: '',
  email: ''
})
const zoidbergErrors = ref({
  firstName: '',
  lastName: '',
  preferredFirstName: '',
  email: ''
})
const zoidbergSubmitting = ref(false)
const zoidbergSubmitError = ref('')
const zoidbergSuccess = ref(false)
// ─────────────────────────────────────────────────────────────────

// Get survey type from URL parameters
const surveyType = computed(() => {
  return route.query.survey || route.query.surveyID || route.query.surveyid || 'clinical'
})

const surveyDisplayName = computed(() => getSurveyDisplayName(surveyType.value))
const surveyName = computed(() => getSurveyName(surveyType.value))

const canStartSurvey = computed(() => {
  return selectedContributorId.value && !isLoading.value
})

const buttonText = computed(() => {
  if (!selectedContributorId.value) return 'Select Contributor'
  if (isLoading.value) return 'Loading...'
  if (surveyStatus.value?.isComplete) return 'Review Responses'
  if (surveyStatus.value?.progress > 0) return 'Resume Survey'
  return 'Start Survey'
})

watch(() => route.query.contributorId, (newContributorId) => {
  if (newContributorId && contributors.value.length > 0) {
    autoSelectContributor(newContributorId)
  }
})

// ── Zoidberg check ────────────────────────────────────────────────
/**
 * Returns true if the contributor's first name is "Zoidberg" (case-insensitive).
 * Works whether the name field is "Zoidberg", "Zoidberg Smith", etc.
 */
function isTestUser(contributorName) {
  if (!contributorName) return false
  const firstName = contributorName.trim().split(/\s+/)[0]
  return firstName.toLowerCase() === 'zoidberg'
}

function maybeShowZoidbergModal(contributor) {
  if (isTestUser(contributor.name)) {
    zoidbergContributorId.value = contributor.id
    zoidbergForm.value = { firstName: '', lastName: '', preferredFirstName: '', email: '' }
    zoidbergErrors.value = { firstName: '', lastName: '', preferredFirstName: '', email: '' }
    zoidbergSubmitError.value = ''
    zoidbergSuccess.value = false
    showZoidbergModal.value = true
  }
}
// ─────────────────────────────────────────────────────────────────

// ── Airtable PATCH for Zoidberg form ─────────────────────────────
async function submitZoidbergForm() {
  // Validate
  let valid = true
  zoidbergErrors.value = { firstName: '', lastName: '', preferredFirstName: '', email: '' }

  if (!zoidbergForm.value.firstName.trim()) {
    zoidbergErrors.value.firstName = 'First name is required.'
    valid = false
  }
  if (!zoidbergForm.value.lastName.trim()) {
    zoidbergErrors.value.lastName = 'Last name is required.'
    valid = false
  }
  if (!zoidbergForm.value.preferredFirstName.trim()) {
    zoidbergErrors.value.preferredFirstName = 'Preferred first name is required.'
    valid = false
  }
  if (!zoidbergForm.value.email.trim()) {
    zoidbergErrors.value.email = 'Email is required.'
    valid = false
  } else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(zoidbergForm.value.email.trim())) {
    zoidbergErrors.value.email = 'Please enter a valid email address.'
    valid = false
  }
  if (!valid) return

  zoidbergSubmitting.value = true
  zoidbergSubmitError.value = ''

  try {
    const baseId   = import.meta.env.VITE_AIRTABLE_BASE_ID
    const tableId  = import.meta.env.VITE_AIRTABLE_TABLE_CONTRIBUTORS
    const apiKey   = import.meta.env.VITE_AIRTABLE_API_KEY
    const recordId = zoidbergContributorId.value

    const fields = {
      firstName: zoidbergForm.value.firstName.trim(),
      lastName: zoidbergForm.value.lastName.trim(),
      preferredFirst: zoidbergForm.value.preferredFirstName.trim(),
      email: zoidbergForm.value.email.trim()
    }

    const response = await fetch(
      `https://api.airtable.com/v0/${baseId}/${tableId}/${recordId}`,
      {
        method: 'PATCH',
        headers: {
          'Authorization': `Bearer ${apiKey}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ fields })
      }
    )

    const data = await response.json()

    if (!response.ok) {
      throw new Error(data.error?.message || `Airtable error ${response.status}`)
    }

    console.log('✅ Zoidberg record updated:', data)
    zoidbergSuccess.value = true

    // Refresh contributor list so dropdown shows updated name
    await loadContributors()

    // Close modal after short delay so user sees success message
    setTimeout(() => {
      showZoidbergModal.value = false
    }, 1800)

  } catch (err) {
    console.error('❌ Failed to update Zoidberg record:', err)
    zoidbergSubmitError.value = `Failed to save: ${err.message}. Please try again.`
  } finally {
    zoidbergSubmitting.value = false
  }
}
// ─────────────────────────────────────────────────────────────────

// Methods
async function loadContributors() {
  try {
    isLoading.value = true
    error.value = null
    
    console.log('🔄 Loading contributors...')
    const contributorList = await fetchContributors()
    contributors.value = contributorList
    
    console.log(`✅ Loaded ${contributorList.length} contributors`)
    
    const urlContributorId = route.query.contributorId
    if (urlContributorId) {
      autoSelectContributor(urlContributorId)
    }
    
  } catch (err) {
    console.error('❌ Error loading contributors:', err)
    error.value = 'Failed to load contributors. Please refresh the page.'
  } finally {
    isLoading.value = false
  }
}

function autoSelectContributor(contributorId) {
  const contributor = contributors.value.find(c => c.id === contributorId)
  
  if (contributor) {
    selectedContributorId.value = contributorId
    updateWelcomeMessage(contributor.name, surveyType.value)
    checkContributorSurveyStatus(contributorId)
    console.log(`✅ Auto-selected contributor: ${contributor.name} (${contributorId})`)

    // Check if this is the Zoidberg test account
    maybeShowZoidbergModal(contributor)
  } else {
    console.warn(`⚠️ Contributor ID ${contributorId} not found`)
    error.value = 'The contributor link you used is not valid. Please select your name from the dropdown.'
  }
}

function updateWelcomeMessage(fullName, surveyType) {
  const displayName = getSurveyDisplayName(surveyType)
  
  welcomeMessage.value = `
    <p style="color: #00274C; font-size: 1.1em; margin-bottom: 15px; text-align: center;">
      Hello <strong style="color: #00274C">${fullName}</strong>!
    </p>
    <p style="color: #00274C; font-size: 0.9em; margin-bottom: 10px; text-align: center;">
      Survey Type: <strong>${displayName}</strong>
    </p>
    <p style="color: #00274C; font-size: 0.9em; margin-bottom: 20px; text-align: center;">
      If this is NOT you, please change the selection below.
    </p>
  `
}

async function onContributorChange() {
  if (!selectedContributorId.value) {
    surveyStatus.value = null
    welcomeMessage.value = ''
    return
  }
  
  welcomeMessage.value = ''
  
  const contributor = contributors.value.find(c => c.id === selectedContributorId.value)

  // Check if this is the Zoidberg test account
  if (contributor) {
    maybeShowZoidbergModal(contributor)
  }

  await checkContributorSurveyStatus(selectedContributorId.value)
}

async function checkContributorSurveyStatus(contributorId) {
  try {
    console.log(`🔍 Checking ${surveyDisplayName.value} survey status for contributor: ${contributorId}`)
    
    const result = await initializeSurvey(contributorId, surveyType.value)
    
    surveyStatus.value = {
      isComplete: result.isComplete,
      progress: result.progress || 0,
      currentTerm: result.currentTerm
    }
    
    console.log('📊 Survey status:', surveyStatus.value)
    
  } catch (err) {
    console.error('❌ Error checking survey status:', err)
    surveyStatus.value = { isComplete: false, progress: 0, currentTerm: null }
  }
}

function startSurvey() {
  if (!selectedContributorId.value) {
    console.error('❌ No contributor selected')
    return
  }
  
  console.log(`🚀 Starting ${surveyDisplayName.value} survey...`)
  
  const queryParams = {
    contributor: selectedContributorId.value,
    survey: surveyType.value
  }
  
  if (surveyStatus.value?.isComplete) {
    console.log('📊 Redirecting to review page - survey completed')
    router.push({ path: '/review', query: queryParams })
  } else {
    console.log('📝 Redirecting to terms page - survey in progress or starting')
    router.push({ path: '/terms', query: queryParams })
  }
}

// Lifecycle
onMounted(() => {
  console.log('🚀 Welcome component mounted')
  console.log('Survey type from URL:', surveyType.value)
  console.log('Survey display name:', surveyDisplayName.value)
  
  resetSurveyStore()
  loadContributors()
})
</script>

<style scoped>
/* Override global CSS that hides welcome-screen */
.welcome-screen {
  display: block !important;
}

.survey-content,
.welcome-screen,
.button-group,
.survey-status,
.btn {
  display: block !important;
  visibility: visible !important;
  opacity: 1 !important;
}
.welcome-container {
  min-height: 100vh !important;
  background: #00274C !important;
  padding: 10px 20px 20px 20px !important;
  font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif !important;
}

/* Michigan Logo Header */
.michigan-logo-header {
  width: 100% !important;
  background: #00274C !important;
  padding: 15px 20px !important;
  text-align: center !important;
  margin: 0 0 20px 0 !important;
}

.michigan-logo-placeholder {
  max-width: 800px !important;
  width: calc(100% - 40px) !important;
  margin: 0 auto !important;
  padding: 30px !important;
  background: white !important;
  border: 3px solid white !important;
  border-radius: 12px !important;
  font-weight: bold !important;
  color: #00274C !important;
  box-shadow: 0 2px 8px rgba(0,0,0,0.15) !important;
}

/* Container */
.container {
  max-width: 800px !important;
  margin: 0 auto !important;
  background: white !important;
  border-radius: 20px !important;
  box-shadow: 0 20px 40px rgba(0,0,0,0.1) !important;
  overflow: hidden !important;
}

/* Header */
.header {
  background: #00274C !important;
  color: white !important;
  padding: 30px !important;
  text-align: center !important;
}

.header h1 {
  font-size: 2.5rem !important;
  margin-bottom: 10px !important;
  color: #FFCB05 !important;
}

.header p {
  font-size: 1.1rem !important;
  opacity: 0.9 !important;
  color: #FFCB05 !important;
}

/* Survey Content */
.survey-content {
  padding: 40px !important;
}

/* Welcome Message */
.welcome-message {
  margin-bottom: 30px !important;
  padding: 20px !important;
  background: #f8f9fa !important;
  border-radius: 10px !important;
  border-left: 4px solid #00274C !important;
}

/* Error Message */
.error {
  background: #fed7d7 !important;
  color: #c53030 !important;
  padding: 15px !important;
  border-radius: 10px !important;
  margin-bottom: 20px !important;
  text-align: center !important;
}

/* Loading */
.loading {
  text-align: center !important;
  padding: 40px !important;
  color: #00274C !important;
}

/* Contributor Select */
.contributor-select {
  margin-bottom: 30px !important;
}

.contributor-select label {
  display: block !important;
  font-weight: 600 !important;
  margin-bottom: 15px !important;
  color: #2d3748 !important;
}

.contributor-dropdown {
  width: 100% !important;
  padding: 15px !important;
  border: 2px solid #e2e8f0 !important;
  border-radius: 10px !important;
  font-size: 1rem !important;
  background: white !important;
  transition: border-color 0.3s ease !important;
}

.contributor-dropdown:focus {
  outline: none !important;
  border-color: #00274C !important;
}

/* Survey Status */
.survey-status {
  margin-bottom: 30px !important;
  padding: 20px !important;
  background: #f8fafc !important;
  border-radius: 10px !important;
  border-left: 4px solid #00274C !important;
}

.survey-info h3 {
  margin: 0 0 15px 0 !important;
  color: #2d3748 !important;
  font-size: 1.2rem !important;
}

.progress-info {
  margin-top: 15px !important;
}

.progress-info p {
  margin: 5px 0 !important;
  color: #4a5568 !important;
}

/* Progress Bar */
.progress-bar {
  background: #e2e8f0 !important;
  height: 8px !important;
  border-radius: 4px !important;
  margin: 10px 0 !important;
  overflow: hidden !important;
}

.progress-fill {
  background: #00274C !important;
  height: 100% !important;
  border-radius: 4px !important;
  transition: width 0.5s ease !important;
}

/* Button Group */
.button-group {
  display: flex !important;
  justify-content: space-between !important;
  align-items: center !important;
  margin-top: 30px !important;
}

/* Button */
.btn {
  background: #00274C !important;
  color: white !important;
  border: none !important;
  padding: 15px 30px !important;
  border-radius: 10px !important;
  font-size: 1.1rem !important;
  font-weight: 600 !important;
  cursor: pointer !important;
  transition: transform 0.3s ease !important;
  min-width: 150px !important;
}

.btn:hover:not(:disabled) {
  transform: translateY(-2px) !important;
}

.btn:disabled {
  opacity: 0.6 !important;
  cursor: not-allowed !important;
  transform: none !important;
}

/* Mobile Responsive */
@media (max-width: 768px) {
  .welcome-container {
    padding: 10px !important;
  }
  
  .michigan-logo-placeholder {
    width: calc(100% - 20px) !important;
    padding: 20px !important;
    border: 2px solid white !important;
    border-radius: 8px !important;
  }
  
  .michigan-logo-header {
    padding: 10px !important;
  }
  
  .header h1 {
    font-size: 2rem !important;
  }
  
  .survey-content {
    padding: 20px !important;
  }
}

/* ================================================================ */
/* ZOIDBERG MODAL STYLES                                             */
/* ================================================================ */

.zoidberg-overlay {
  position: fixed;
  inset: 0;
  background: rgba(0, 0, 0, 0.65);
  backdrop-filter: blur(4px);
  z-index: 9999;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 20px;
  animation: overlayFadeIn 0.2s ease;
}

@keyframes overlayFadeIn {
  from { opacity: 0; }
  to   { opacity: 1; }
}

.zoidberg-modal {
  background: white;
  border-radius: 16px;
  width: 100%;
  max-width: 480px;
  box-shadow: 0 25px 60px rgba(0, 0, 0, 0.3);
  overflow: hidden;
  animation: modalSlideIn 0.25s ease;
}

@keyframes modalSlideIn {
  from { opacity: 0; transform: translateY(-20px) scale(0.97); }
  to   { opacity: 1; transform: translateY(0) scale(1); }
}

.zoidberg-warning-banner {
  background: #b7410e;
  color: white;
  padding: 16px 24px;
  font-weight: 700;
  font-size: 0.95rem;
  letter-spacing: 0.05em;
  display: flex;
  align-items: center;
  gap: 10px;
  text-transform: uppercase;
}

.zoidberg-warning-icon {
  font-size: 1.3rem;
}

.zoidberg-body {
  padding: 28px 28px 24px;
}

.zoidberg-description {
  color: #2d3748;
  font-size: 0.95rem;
  line-height: 1.6;
  margin: 0 0 24px 0;
}

.zoidberg-form {
  display: flex;
  flex-direction: column;
  gap: 16px;
  margin-bottom: 20px;
}

.zoidberg-field {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.zoidberg-field label {
  font-size: 0.875rem;
  font-weight: 600;
  color: #2d3748;
}

.required {
  color: #c53030;
}

.zoidberg-field input {
  padding: 11px 14px;
  border: 2px solid #e2e8f0;
  border-radius: 8px;
  font-size: 0.95rem;
  color: #2d3748;
  transition: border-color 0.2s ease;
  outline: none;
  font-family: inherit;
}

.zoidberg-field input:focus {
  border-color: #00274C;
}

.zoidberg-field input.input-error {
  border-color: #c53030;
  background: #fff5f5;
}

.field-error {
  font-size: 0.8rem;
  color: #c53030;
  margin-top: 2px;
}

.zoidberg-submit-error {
  background: #fff5f5;
  border: 1px solid #feb2b2;
  color: #c53030;
  padding: 12px 16px;
  border-radius: 8px;
  font-size: 0.875rem;
  margin-bottom: 16px;
}

.zoidberg-success {
  background: #f0fff4;
  border: 1px solid #9ae6b4;
  color: #276749;
  padding: 12px 16px;
  border-radius: 8px;
  font-size: 0.875rem;
  margin-bottom: 16px;
  font-weight: 600;
}

.zoidberg-actions {
  display: flex;
  justify-content: flex-end;
}

.zoidberg-submit-btn {
  background: #00274C;
  color: white;
  border: none;
  padding: 13px 28px;
  border-radius: 10px;
  font-size: 1rem;
  font-weight: 600;
  cursor: pointer;
  display: flex;
  align-items: center;
  gap: 8px;
  transition: opacity 0.2s ease, transform 0.2s ease;
  font-family: inherit;
  min-width: 160px;
  justify-content: center;
}

.zoidberg-submit-btn:hover:not(:disabled) {
  opacity: 0.88;
  transform: translateY(-1px);
}

.zoidberg-submit-btn:disabled {
  opacity: 0.6;
  cursor: not-allowed;
  transform: none;
}

.zoidberg-spinner {
  width: 16px;
  height: 16px;
  border: 2px solid rgba(255,255,255,0.3);
  border-top-color: white;
  border-radius: 50%;
  animation: spin 0.7s linear infinite;
  display: inline-block;
}

@keyframes spin {
  to { transform: rotate(360deg); }
}

@media (max-width: 520px) {
  .zoidberg-modal {
    max-width: 100%;
    border-radius: 12px;
  }
  .zoidberg-body {
    padding: 20px;
  }
  .zoidberg-submit-btn {
    width: 100%;
  }
}
</style>