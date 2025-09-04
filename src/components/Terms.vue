<template>
            <!-- Michigan Logo Header -->
  <div class="michigan-logo-header">
    <img src="/image/Michigan-logo.png" alt="University of Michigan" class="michigan-logo">
  </div>
  
  <div>
    <div class="container">
      <div class="header">
        <h1 style="color: #FFCB05 !important;">HPO Term</h1>
        <p style="color: #FFCB05 !important;">Review the selected term and provide your feedback.</p>
      </div>

      <!-- Loading State -->
      <div v-if="store.isLoading" class="loading">
        <p>Loading survey...</p>
      </div>

      <!-- Error State -->
      <div v-if="store.error" class="error">
        <p>Error: {{ store.error }}</p>
        <button @click="retryInit" class="btn">Retry</button>
      </div>

      <!-- Survey Content -->
      <div v-if="!store.isLoading && !store.error && store.currentTerm" class="survey-content">
        <!-- Interactive Hierarchy - Always visible -->
        <div class="hierarchy-container">
          <h4 style="margin: 0 0 10px 0; text-align: center;">{{ hierarchyTitle }}</h4>
          <div class="hierarchy-controls">
            <button @click="expandAll">Expand All</button>
            <button @click="collapseAll">Collapse All</button>
            <button @click="showCurrentOnly">Show Current Path</button>
          </div>
          <ul class="hierarchy-tree" ref="hierarchyTree">
            <HierarchyNode 
              v-for="(node, key) in hierarchyData" 
              :key="key"
              :name="key"
              :children="node"
              :level="1"
              :current-term="store.currentTerm?.termLabel"
              ref="hierarchyNodes"
            />
          </ul>
        </div>

        <!-- Term Information -->
        <div class="term-info">
          <p><strong>Below is the information on the selected term:</strong></p>
          <ul>
            <li><strong>Name:</strong> {{ store.currentTerm.termLabel }} ({{ store.currentTerm.hpoId || store.currentTerm.id }})</li>
            <li><strong>Parents:</strong> {{ store.currentTerm.parents }} </li>
            <li><strong>Definition:</strong> "{{ store.currentTerm.definition }}"</li>
            <li><strong>Synonyms:</strong> {{ formatSynonyms(store.currentTerm.synonyms) }}</li>
          </ul>
        </div>

        <!-- Agreement Question -->
        <div class="agreement-section">
          <div class="agreement-question">
            Do you completely agree with this term <strong>{{ store.currentTerm.termLabel }}</strong> ({{ store.currentTerm.hpoId || store.currentTerm.id }}) as shown above?
          </div>
          <div class="radio-group">
            <label class="radio-option" :class="{ selected: agreement === 'yes' }">
              <input type="radio" v-model="agreement" value="yes">
              <span>Yes</span>
            </label>
            <label class="radio-option" :class="{ selected: agreement === 'no' }">
              <input type="radio" v-model="agreement" value="no">
              <span>No</span>
            </label>
          </div>
        </div>

        <!-- Navigation Buttons -->
        <div class="button-group">
          <button class="btn btn-secondary" @click="previousTerm" :disabled="!canGoBack">Back</button>
          <button class="btn" @click="nextTerm" :disabled="!agreement">Next</button>
        </div>
      </div>

      <!-- Survey Complete -->
      <div v-if="store.isComplete" class="survey-content">
        <div class="completion-message">
          <h2>Survey Complete!</h2>
          <p>Thank you for completing the survey.</p>
          <button @click="goToReview" class="btn">View Summary</button>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup>
import { ref, computed, onMounted, watch, nextTick } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { 
  surveyStore, 
  surveyComputed, 
  initializeSurvey, 
  saveResponse, 
  moveToNextTerm,
  moveToPreviousTerm,
  resetSurveyStore,
  getSurveyDisplayName
} from '@/storage/storeSurvey.js'
import HierarchyNode from './HierarchyNode.vue'
// Add this right after your imports in Terms.vue:
const router = useRouter()

const agreement = ref('')
const hierarchyNodes = ref([])


// Utility function to format synonyms
const formatSynonyms = (synonyms) => {
  if (!synonyms) return 'No synonyms available'
  
  // If it's already a string, return as is
  if (typeof synonyms === 'string') {
    // Remove brackets and quotes if present
    return synonyms.replace(/[\[\]"]/g, '').trim()
  }
  
  // If it's an array, join with commas
  if (Array.isArray(synonyms)) {
    return synonyms.map(s => s.trim()).join(', ')
  }
  
  return synonyms
}

//get survey
const route = useRoute()
const contributorId = route.query.contributor
const surveyType = route.query.survey || route.query.surveyID || 'clinical'

// Computed properties
// Dynamic hierarchy title based on survey type
const hierarchyTitle = computed(() => {
  if (!surveyStore.allTerms || surveyStore.allTerms.length === 0) {
    return 'Loading Hierarchy...'
  }
  
  // Find the root term to use as title
  const termLabels = surveyStore.allTerms.map(t => t.termLabel)
  const rootTerm = surveyStore.allTerms.find(term => {
    return !term.parents || !termLabels.includes(term.parents)
  })
  
  // Use survey config for display name
  const surveyDisplayName = getSurveyDisplayName(surveyType)
  return rootTerm ? `${rootTerm.termLabel} Hierarchy` : `${surveyDisplayName} Hierarchy`
})

// Function to build hierarchy tree from Airtable terms using nextTermLabel order
const buildHierarchyFromTerms = (terms) => {
  console.log('🏗️ Building hierarchy from terms:', terms)
  
  // Step 1: Find root terms (terms that don't have parents in the current survey)
  const termLabels = terms.map(t => t.termLabel)
  const rootTerms = terms.filter(term => {
    // A term is root if its parent is not in the current survey terms
    return !term.parents || !termLabels.includes(term.parents)
  })
  
  console.log('🌱 Root terms found:', rootTerms.map(t => t.termLabel))
  
  // Step 2: Build the hierarchy recursively using nextTermLabel order
  const hierarchy = {}
  
  rootTerms.forEach(rootTerm => {
    hierarchy[rootTerm.termLabel] = buildChildrenInOrder(rootTerm, terms)
  })
  
  console.log('🏗️ Built hierarchy:', hierarchy)
  return hierarchy
}

// Recursive function to build children for a term following nextTermLabel order
const buildChildrenInOrder = (parentTerm, allTerms) => {
  // Find all terms that have this term as their parent
  const children = allTerms.filter(term => term.parents === parentTerm.termLabel)
  
  if (children.length === 0) {
    return [] // No children, return empty array
  }
  
  // Sort children based on the order they appear in the parent's nextTermLabel
  const orderedChildren = sortChildrenByNextTermOrder(children, parentTerm, allTerms)
  
  console.log(`📋 Children of "${parentTerm.termLabel}":`, orderedChildren.map(c => c.termLabel))
  
  // Check if any children have their own children
  const childrenWithGrandchildren = orderedChildren.filter(child => {
    return allTerms.some(term => term.parents === child.termLabel)
  })
  
  if (childrenWithGrandchildren.length === 0) {
    // All children are leaf nodes, return as array in order
    return orderedChildren.map(child => child.termLabel)
  }
  
  // Mixed case: some children have children, some don't
  const result = {}
  orderedChildren.forEach(child => {
    const childHasChildren = allTerms.some(term => term.parents === child.termLabel)
    if (childHasChildren) {
      result[child.termLabel] = buildChildrenInOrder(child, allTerms)
    } else {
      // For leaf nodes in mixed case, we still use the object notation
      result[child.termLabel] = []
    }
  })
  
  return result
}

// Function to sort children based on nextTermLabel order
const sortChildrenByNextTermOrder = (children, parentTerm, allTerms) => {
  if (!parentTerm.nextTermLabel || children.length <= 1) {
    return children // No ordering info or only one child
  }
  
  // Build the survey flow chain starting from parent
  const surveyFlowOrder = buildSurveyFlowChain(allTerms)
  console.log('🔗 Survey flow order:', surveyFlowOrder)
  
  // Sort children based on their position in the survey flow
  const orderedChildren = [...children].sort((a, b) => {
    const indexA = surveyFlowOrder.indexOf(a.termLabel)
    const indexB = surveyFlowOrder.indexOf(b.termLabel)
    
    // If both terms are in the flow, sort by their position
    if (indexA !== -1 && indexB !== -1) {
      return indexA - indexB
    }
    
    // If only one is in the flow, prioritize it
    if (indexA !== -1) return -1
    if (indexB !== -1) return 1
    
    // If neither is in the flow, maintain original order
    return 0
  })
  
  return orderedChildren
}

// Function to build the complete survey flow chain using nextTermLabel
const buildSurveyFlowChain = (terms) => {
  // Find the root term (starting point)
  const termLabels = terms.map(t => t.termLabel)
  const rootTerm = terms.find(term => {
    return !term.parents || !termLabels.includes(term.parents)
  })
  
  if (!rootTerm) return []
  
  const flowChain = []
  const visited = new Set()
  let currentTerm = rootTerm
  
  while (currentTerm && !visited.has(currentTerm.termLabel)) {
    flowChain.push(currentTerm.termLabel)
    visited.add(currentTerm.termLabel)
    
    // Find next term based on nextTermLabel
    if (currentTerm.nextTermLabel) {
      let nextTermLabel = currentTerm.nextTermLabel
      
      // Handle nextTermLabel as array
      if (Array.isArray(nextTermLabel)) {
        nextTermLabel = nextTermLabel[0] // Take first one
      }
      
      // Extract term label if it contains multiple terms separated by commas
      if (typeof nextTermLabel === 'string' && nextTermLabel.includes(',')) {
        nextTermLabel = nextTermLabel.split(',')[0].trim()
      }
      
      // Find the next term in our current survey
      currentTerm = terms.find(term => term.termLabel === nextTermLabel)
    } else {
      break
    }
  }
  
  return flowChain
}
const hierarchyData = computed(() => {
  // Build hierarchy dynamically from Airtable data instead of hardcoded structure
  if (!surveyStore.allTerms || surveyStore.allTerms.length === 0) {
    return {}
  }
  
  return buildHierarchyFromTerms(surveyStore.allTerms)
})
const canGoBack = computed(() => {
  return surveyStore.completedTerms.length > 0
})

// Expose store and computed for template
const store = surveyStore
const surveyComputedValues = surveyComputed

// Initialize survey
const initSurvey = async () => {
  if (!contributorId || !surveyType) {
    surveyStore.error = 'Missing contributor ID or survey type'
    return
  }

  try {
    await initializeSurvey(contributorId, surveyType)
    
    if (surveyStore.isComplete) {
    router.push(`/review?contributor=${surveyStore.contributorId}&survey=${surveyType}`)
    }
  } catch (error) {
    console.error('Failed to initialize survey:', error)
    surveyStore.error = error.message
  }
}

const retryInit = () => {
  surveyStore.error = null
  initSurvey()
}

const nextTerm = async () => {
  if (!agreement.value || !surveyStore.currentTerm) return

  try {
    if (agreement.value === 'yes') {
      // Only save response for "Yes" answers
      const responseData = {
        agreement: agreement.value,
        timestamp: new Date().toISOString()
      }

      console.log("💾 Saving YES response...")
      await saveResponse(surveyStore.currentTerm.id, responseData)

      console.log("👍 Yes response - moving to next term...")
      
      // Move to next term using storeSurvey.js function
      const nextTermData = moveToNextTerm()
      
      if (!nextTermData || surveyStore.isComplete) {
        // Survey complete, redirect to review
        console.log("🏁 Survey complete - redirecting to review")
        router.push({ 
          path: '/review', 
          query: { 
            survey: surveyType,
            contributor: contributorId 
          }
        })
      } else {
        // Reset agreement for next term
        console.log("➡️ Moving to next term:", nextTermData.termLabel)
        agreement.value = ''
        await nextTick()
        updateHierarchy()
      }
    } else {
      // For "no" responses, DON'T save anything yet - just navigate to disagree page
      console.log("👎 No response - navigating to disagree page (no save yet)")
      
      router.push({ 
        path: '/disagree', 
        query: { 
          survey: surveyType,
          contributor: contributorId 
        }
      })
      // Note: The current term stays the same, no saveResponse called
    }
  } catch (error) {
    console.error('Error processing response:', error)
    surveyStore.error = error.message
  }
}

const previousTerm = async () => {
  if (!canGoBack.value) {
    console.log('Cannot go back - no completed terms')
    return
  }

  try {
    console.log('⬅️ Going back to previous term...')
    console.log('Current completed terms:', surveyStore.completedTerms)
    
    // Use the new moveToPreviousTerm function from store
    const previousTermData = moveToPreviousTerm()
    
    if (previousTermData) {
      console.log(`✅ Moved back to: ${previousTermData.termLabel}`)
      
      // Reset agreement for the previous term
      agreement.value = ''
      
      // Update hierarchy display
      await nextTick()
      updateHierarchy()
    } else {
      console.warn('⚠️ Could not move to previous term')
    }
    
  } catch (error) {
    console.error('❌ Error going to previous term:', error)
    surveyStore.error = error.message
  }
}

const goToReview = () => {
  router.push({ 
    path: '/review', 
    query: { 
      survey: surveyType,
      contributor: contributorId 
    }
  })
}

// Hierarchy functions
const expandAll = () => {
  hierarchyNodes.value.forEach(node => {
    if (node.expand) node.expand()
  })
}

const collapseAll = () => {
  hierarchyNodes.value.forEach(node => {
    if (node.collapse) node.collapse()
  })
}

const showCurrentOnly = () => {
  collapseAll()
  // Expand path to current term
  setTimeout(() => {
    hierarchyNodes.value.forEach(node => {
      if (node.expandToCurrentTerm) node.expandToCurrentTerm()
    })
  }, 100)
}

const updateHierarchy = () => {
  setTimeout(() => {
    showCurrentOnly()
  }, 100)
}

// Watch for current term changes
watch(() => surveyStore.currentTerm, (newTerm) => {
  if (newTerm) {
    updateHierarchy()
  }
})

onMounted(() => {
  initSurvey()
})
</script>

<style>
/* Import all the hierarchy styles from your original HTML */
.hierarchy-container {
    background: #f8f9fa;
    border: 1px solid #dee2e6;
    border-radius: 8px;
    padding: 15px;
    margin: 20px auto;
    max-width: 700px;
}

.hierarchy-controls {
    margin-bottom: 10px;
    display: flex;
    gap: 10px;
    justify-content: center;
}

.hierarchy-controls button {
    padding: 5px 12px;
    border: 1px solid #ced4da;
    background: white;
    border-radius: 4px;
    font-size: 13px;
    cursor: pointer;
    transition: background-color 0.2s;
}

.hierarchy-controls button:hover {
    background: #f8f9fa;
}

.hierarchy-tree {
    list-style: none;
    padding-left: 0;
    margin: 0;
    font-size: 14px;
    line-height: 1.6;
}

.hierarchy-tree ul {
    list-style: none;
    padding-left: 25px;
    margin: 5px 0;
}

.hierarchy-item {
    margin: 4px 0;
    position: relative;
}

.item-content {
    display: flex;
    align-items: center;
    padding: 5px 8px;
    border-radius: 4px;
    cursor: pointer;
    transition: background-color 0.2s;
}

.item-content:hover {
    background-color: #e9ecef;
}

/* Expand/Collapse Icons */
.expand-icon {
    display: inline-block;
    width: 16px;
    margin-right: 8px;
    text-align: center;
    cursor: pointer;
    user-select: none;
}

.expand-icon:before {
    content: '▶';
    font-size: 10px;
    color: #666;
}

.expand-icon.expanded:before {
    content: '▼';
}

.no-children {
    display: inline-block;
    width: 24px;
}

/* Bullet points for leaf nodes */
.bullet {
    display: inline-block;
    width: 6px;
    height: 6px;
    border-radius: 50%;
    background: #666;
    margin-right: 10px;
    margin-left: 6px;
}

/* Current Term Highlighting */
.current-term > .item-content {
    background: #fff3cd;
    border: 1px solid #ffc107;
    font-weight: 600;
    color: #856404;
}

.current-term > .item-content:hover {
    background: #ffe69c;
}

/* Path to current term */
.in-path > .item-content {
    background: #e7f3ff;
    font-weight: 500;
}

/* You are here indicator */
.you-are-here {
    display: inline-block;
    background: #ffc107;
    color: #000;
    padding: 2px 6px;
    border-radius: 10px;
    font-size: 10px;
    font-weight: 600;
    margin-left: 8px;
    animation: pulse 2s infinite;
}

@keyframes pulse {
    0%, 100% { opacity: 1; }
    50% { opacity: 0.7; }
}

/* Hierarchy lines */
.hierarchy-item ul {
    position: relative;
    border-left: 1px dashed #dee2e6;
    margin-left: 8px;
}

/* Different indentation levels */
.level-1 { font-weight: 600; }
.level-2 { font-weight: 500; }
.level-3 { font-weight: 400; }
.level-4 { font-weight: 400; font-size: 13px; }
</style>