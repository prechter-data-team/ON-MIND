<template>
  <div class="synonym-selector">
    <!-- Search Input -->
    <div class="search-container">
      <input
        v-model="searchQuery"
        type="text"
        placeholder="Search for synonyms..."
        class="search-input"
        @focus="showDropdown = true"
        @input="handleSearch"
      />
      
      <!-- Dropdown -->
      <div v-if="showDropdown && filteredSynonyms.length > 0" class="dropdown">
        <div
          v-for="synonym in filteredSynonyms.slice(0, 10)"
          :key="synonym.id"
          class="dropdown-item"
          @click="selectSynonym(synonym)"
        >
          {{ synonym.text }}
        </div>
      </div>
      
      <!-- No results -->
      <div v-if="showDropdown && searchQuery && filteredSynonyms.length === 0" class="dropdown">
        <div class="no-results">No matching synonyms found</div>
      </div>
    </div>

    <!-- Selected Synonyms -->
    <div class="selected-synonyms">
      <h4>Selected Synonyms:</h4>
      <div v-if="selectedSynonyms.length === 0" class="empty-message">
        No synonyms selected yet
      </div>
      <div v-else class="synonym-tags">
        <div
          v-for="synonym in selectedSynonyms"
          :key="synonym.id"
          class="synonym-tag"
        >
          <span>{{ synonym.text }}</span>
          <button @click="removeSynonym(synonym.id)" class="remove-btn">×</button>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup>
import { ref, computed, onMounted } from 'vue'
import { searchSynonyms } from '@/storage/storeSurvey.js'

const props = defineProps({
  selectedSynonyms: {
    type: Array,
    default: () => []
  }
})

const emit = defineEmits(['update'])

const searchQuery = ref('')
const showDropdown = ref(false)
const allSynonyms = ref([])
const isLoading = ref(false)

const filteredSynonyms = computed(() => {
  if (!searchQuery.value.trim()) return []
  
  const query = searchQuery.value.toLowerCase()
  return allSynonyms.value.filter(synonym => 
    synonym.text && 
    synonym.text.toLowerCase().includes(query) &&
    !props.selectedSynonyms.some(selected => selected.id === synonym.id)
  )
})

// And update handleSearch to not reload if synonyms are already loaded:
const handleSearch = async () => {
  if (searchQuery.value.length < 2) {
    showDropdown.value = false
    return
  }
  
  // Only load synonyms if we haven't loaded them yet
  if (allSynonyms.value.length === 0) {
    await loadSynonyms()
  }
  
  showDropdown.value = true
}
const loadSynonyms = async () => {
  if (isLoading.value) return
  
  isLoading.value = true
  try {
    console.log('🔄 Loading ALL synonyms in SynonymSelector...')
    // Pass empty string to get ALL synonyms (your searchSynonyms function should handle this)
    const synonyms = await searchSynonyms('')
    allSynonyms.value = synonyms.map(syn => ({
      id: syn.id,
      text: syn.text || syn.synonymText || 'Unknown'
    }))
    console.log(`✅ Loaded ${allSynonyms.value.length} synonyms in SynonymSelector`)
  } catch (error) {
    console.error('Error loading synonyms:', error)
  } finally {
    isLoading.value = false
  }
}

const selectSynonym = (synonym) => {
  const updatedSynonyms = [...props.selectedSynonyms, synonym]
  emit('update', updatedSynonyms)
  
  searchQuery.value = ''
  showDropdown.value = false
}

const removeSynonym = (synonymId) => {
  const updatedSynonyms = props.selectedSynonyms.filter(syn => syn.id !== synonymId)
  emit('update', updatedSynonyms)
}

// Hide dropdown when clicking outside
const handleClickOutside = (event) => {
  if (!event.target.closest('.synonym-selector')) {
    showDropdown.value = false
  }
}

onMounted(async () => {
  document.addEventListener('click', handleClickOutside)
  // Pre-load ALL synonyms when component mounts
  await loadSynonyms()
})
</script>

<style scoped>
.synonym-selector {
  margin: 15px 0;
}

.search-container {
  position: relative;
  margin-bottom: 15px;
}

.search-input {
  width: 100%;
  padding: 10px;
  border: 1px solid #ced4da;
  border-radius: 5px;
  font-size: 14px;
}

.search-input:focus {
  outline: none;
  border-color: #80bdff;
  box-shadow: 0 0 0 0.2rem rgba(0, 123, 255, 0.25);
}

.dropdown {
  position: absolute;
  top: 100%;
  left: 0;
  right: 0;
  background: white;
  border: 1px solid #ced4da;
  border-top: none;
  border-radius: 0 0 5px 5px;
  max-height: 200px;
  overflow-y: auto;
  z-index: 1000;
}

.dropdown-item {
  padding: 10px;
  cursor: pointer;
  border-bottom: 1px solid #eee;
  transition: background-color 0.2s;
}

.dropdown-item:hover {
  background-color: #f5f5f5;
}

.dropdown-item:last-child {
  border-bottom: none;
}

.no-results {
  padding: 10px;
  color: #666;
  font-style: italic;
  text-align: center;
}

.selected-synonyms h4 {
  margin: 0 0 10px 0;
  font-size: 14px;
  color: #666;
}

.empty-message {
  color: #666;
  font-style: italic;
  padding: 10px;
  background: #f8f9fa;
  border-radius: 5px;
}

.synonym-tags {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  padding: 8px;
  background: white;
  border: 1px solid #e0e0e0;
  border-radius: 5px;
  min-height: 40px;
}

.synonym-tag {
  background: #007bff;
  color: white;
  padding: 5px 10px;
  border-radius: 15px;
  font-size: 12px;
  display: flex;
  align-items: center;
  gap: 5px;
}

.remove-btn {
  background: none;
  border: none;
  color: white;
  font-size: 16px;
  cursor: pointer;
  padding: 0;
  width: 16px;
  height: 16px;
  display: flex;
  align-items: center;
  justify-content: center;
  border-radius: 50%;
}

.remove-btn:hover {
  background: rgba(255, 255, 255, 0.2);
}
</style>