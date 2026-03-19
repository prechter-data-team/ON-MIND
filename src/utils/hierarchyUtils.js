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

  // Step 1: Find all terms that are listed as children of another term IN this survey
  const allChildrenNames = new Set()
  terms.forEach(term => {
    if (term.children) {
      const childNames = term.children.split(',').map(c => c.trim()).filter(c => c)
      childNames.forEach(name => allChildrenNames.add(name))
    }
  })

  // Step 2: Separate true roots from orphaned leaf terms
  // A true root: not a child of anyone AND has children of its own in this survey
  // An orphaned leaf: not a child of anyone AND has no children in this survey
  //   (its real parent exists in HPO but wasn't included in the survey term set)
  const rootTerms = []
  const orphanedLeaves = []

  terms.forEach(term => {
    if (!allChildrenNames.has(term.termLabel)) {
      const hasChildrenInSurvey = term.children &&
        term.children.split(',').map(c => c.trim()).filter(c => c)
          .some(childName => termMap.has(childName))

      if (hasChildrenInSurvey) {
        rootTerms.push(term)
      } else {
        orphanedLeaves.push(term)
      }
    }
  })

  console.log('Root terms found:', rootTerms.map(t => t.termLabel))
  console.log('Orphaned leaf terms (pushed to bottom):', orphanedLeaves.map(t => t.termLabel))

  // Step 3: Build hierarchy for true root terms first
  const hierarchy = {}

  rootTerms.forEach(rootTerm => {
    hierarchy[rootTerm.termLabel] = buildChildrenInOrder(rootTerm, termMap)
  })

  // Step 4: Append orphaned leaves at the bottom with empty children
  orphanedLeaves.forEach(term => {
    hierarchy[term.termLabel] = []
  })

  console.log('Built hierarchy:', hierarchy)
  return hierarchy
}

/**
 * Recursive function to build children for a term using children field
 */
function buildChildrenInOrder(parentTerm, termMap) {
  if (!parentTerm.children) {
    return []
  }

  const childNames = parentTerm.children.split(',').map(c => c.trim()).filter(c => c)

  if (childNames.length === 0) {
    return []
  }

  // Only include children that exist in this survey's term set
  const children = childNames
    .map(name => termMap.get(name))
    .filter(term => term !== undefined)

  if (children.length === 0) {
    return []
  }

  // Sort children by survey flow order using nextTermLabel
  const sortedChildren = sortChildrenBySurveyFlow(children, termMap)

  console.log(`Children of "${parentTerm.termLabel}":`, sortedChildren.map(c => c.termLabel))

  const childrenWithGrandchildren = sortedChildren.filter(child => {
    if (!child.children || !child.children.trim()) return false
    // Only count grandchildren that exist in the survey
    return child.children.split(',').map(c => c.trim()).filter(c => c)
      .some(name => termMap.has(name))
  })

  if (childrenWithGrandchildren.length === 0) {
    return sortedChildren.map(child => child.termLabel)
  }

  // Mixed case: some children have children, some don't
  const result = {}
  sortedChildren.forEach(child => {
    const hasChildrenInSurvey = child.children &&
      child.children.split(',').map(c => c.trim()).filter(c => c)
        .some(name => termMap.has(name))

    if (hasChildrenInSurvey) {
      result[child.termLabel] = buildChildrenInOrder(child, termMap)
    } else {
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

  const surveyFlowMap = new Map()
  let position = 0
  const visited = new Set()

  let current = children[0]
  while (current && !visited.has(current.termLabel)) {
    surveyFlowMap.set(current.termLabel, position++)
    visited.add(current.termLabel)

    if (current.nextTermLabel) {
      const nextLabel = Array.isArray(current.nextTermLabel)
        ? current.nextTermLabel[0]
        : current.nextTermLabel
      current = termMap.get(nextLabel)
    } else {
      break
    }
  }

  return [...children].sort((a, b) => {
    const posA = surveyFlowMap.get(a.termLabel)
    const posB = surveyFlowMap.get(b.termLabel)

    if (posA !== undefined && posB !== undefined) return posA - posB
    if (posA !== undefined) return -1
    if (posB !== undefined) return 1
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

  const allChildrenNames = new Set()
  allTerms.forEach(term => {
    if (term.children) {
      const childNames = term.children.split(',').map(c => c.trim()).filter(c => c)
      childNames.forEach(name => allChildrenNames.add(name))
    }
  })

  // Use first true root term (has children) as the title
  const rootTerm = allTerms.find(term => {
    if (allChildrenNames.has(term.termLabel)) return false
    return term.children && term.children.trim()
  })

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