// src/utils/hierarchyUtils.js
import { getSurveyDisplayName } from '@/storage/storeSurvey.js'

/**
 * Build hierarchy tree from Airtable terms using children relationships
 */
export function buildHierarchyFromTerms(terms) {
  console.log('Building hierarchy from terms:', terms)

  // Build a map of termLabel -> term for quick lookup
  const termMap = new Map()
  terms.forEach(term => termMap.set(term.termLabel, term))

  // Step 1: Find root terms (terms not listed as children of any other term)
  const allChildrenNames = new Set()
  terms.forEach(term => {
    if (term.children) {
      const childNames = term.children.split(',').map(c => c.trim()).filter(c => c)
      childNames.forEach(name => allChildrenNames.add(name))
    }
  })

  const rootTerms = terms.filter(term => !allChildrenNames.has(term.termLabel))
  console.log('Root terms found:', rootTerms.map(t => t.termLabel))

  // Step 2: Build the hierarchy recursively using children field
  const hierarchy = {}

  rootTerms.forEach(rootTerm => {
    hierarchy[rootTerm.termLabel] = buildChildrenInOrder(rootTerm, termMap)
  })

  console.log('Built hierarchy:', hierarchy)
  return hierarchy
}

/**
 * Recursive function to build children for a term using children field
 */
function buildChildrenInOrder(parentTerm, termMap) {
  // Get children from the children field
  if (!parentTerm.children) {
    return [] // No children
  }

  const childNames = parentTerm.children.split(',').map(c => c.trim()).filter(c => c)

  if (childNames.length === 0) {
    return [] // No children
  }

  // Get actual term objects for children
  const children = childNames
    .map(name => termMap.get(name))
    .filter(term => term !== undefined)

  // Sort children by survey flow order using nextTermLabel
  const sortedChildren = sortChildrenBySurveyFlow(children, termMap)

  console.log(`Children of "${parentTerm.termLabel}":`, sortedChildren.map(c => c.termLabel))

  // Check if any children have their own children
  const childrenWithGrandchildren = sortedChildren.filter(child => child.children && child.children.trim())

  if (childrenWithGrandchildren.length === 0) {
    // All children are leaf nodes, return as array
    return sortedChildren.map(child => child.termLabel)
  }

  // Mixed case: some children have children, some don't
  const result = {}
  sortedChildren.forEach(child => {
    if (child.children && child.children.trim()) {
      result[child.termLabel] = buildChildrenInOrder(child, termMap)
    } else {
      // For leaf nodes in mixed case, we still use the object notation
      result[child.termLabel] = []
    }
  })

  return result
}

/**
 * Sort children based on the survey flow using nextTermLabel chain
 */
function sortChildrenBySurveyFlow(children, termMap) {
  if (children.length <= 1) {
    return children
  }

  // Build survey flow order map (term -> position in survey)
  const surveyFlowMap = new Map()
  let position = 0
  const visited = new Set()

  // Start from the first child and follow nextTermLabel chain
  let current = children[0]
  while (current && !visited.has(current.termLabel)) {
    surveyFlowMap.set(current.termLabel, position++)
    visited.add(current.termLabel)

    // Get next term
    if (current.nextTermLabel) {
      const nextLabel = Array.isArray(current.nextTermLabel)
        ? current.nextTermLabel[0]
        : current.nextTermLabel
      current = termMap.get(nextLabel)
    } else {
      break
    }
  }

  // Sort children based on their position in survey flow
  return [...children].sort((a, b) => {
    const posA = surveyFlowMap.get(a.termLabel)
    const posB = surveyFlowMap.get(b.termLabel)

    // If both have positions, sort by position
    if (posA !== undefined && posB !== undefined) {
      return posA - posB
    }

    // If only one has position, prioritize it
    if (posA !== undefined) return -1
    if (posB !== undefined) return 1

    // Neither in flow, maintain original order
    return 0
  })
}

/**
 * Generate hierarchy title based on survey type and terms
 */
export function getHierarchyTitle(surveyType, allTerms) {
  if (!allTerms || allTerms.length === 0) {
    return 'Loading Hierarchy...'
  }

  // Find the root term to use as title (not listed as anyone's child)
  const allChildrenNames = new Set()
  allTerms.forEach(term => {
    if (term.children) {
      const childNames = term.children.split(',').map(c => c.trim()).filter(c => c)
      childNames.forEach(name => allChildrenNames.add(name))
    }
  })

  const rootTerm = allTerms.find(term => !allChildrenNames.has(term.termLabel))
  
  // Use survey config for display name
  const surveyDisplayName = getSurveyDisplayName(surveyType)
  return rootTerm ? `${rootTerm.termLabel} Hierarchy` : `${surveyDisplayName} Hierarchy`
}

/**
 * Hierarchy control functions - can be used by any component with hierarchy
 */
export function createHierarchyControls(hierarchyNodesRef) {
  const expandAll = () => {
    hierarchyNodesRef.value.forEach(node => {
      if (node.expand) node.expand()
    })
  }

  const collapseAll = () => {
    hierarchyNodesRef.value.forEach(node => {
      if (node.collapse) node.collapse()
    })
  }

  const showCurrentOnly = () => {
    collapseAll()
    // Expand path to current term
    setTimeout(() => {
      hierarchyNodesRef.value.forEach(node => {
        if (node.expandToCurrentTerm) node.expandToCurrentTerm()
      })
    }, 100)
  }

  const updateHierarchy = () => {
    setTimeout(() => {
      showCurrentOnly()
    }, 100)
  }

  return {
    expandAll,
    collapseAll,
    showCurrentOnly,
    updateHierarchy
  }
}