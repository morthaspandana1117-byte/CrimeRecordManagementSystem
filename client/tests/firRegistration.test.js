import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'

const source = async (path) => readFile(new URL(path, import.meta.url), 'utf8')

test('FIR routes, list, and details expose no editing UI', async () => {
  const [app, list, details, api] = await Promise.all([
    source('../src/App.jsx'),
    source('../src/pages/FIRList.jsx'),
    source('../src/pages/FIRDetails.jsx'),
    source('../src/services/api.js'),
  ])

  assert.doesNotMatch(app, /FIREdit|\/firs\/:id\/edit/)
  assert.doesNotMatch(list, /Edit FIR|\/edit/)
  assert.doesNotMatch(details, /Edit FIR|\/edit/)
  assert.doesNotMatch(api, /updateFIR\s*=|api\.put\(['"]\/firs/)
})

test('FIR creation shows distinct field guidance and makes criminal association optional', async () => {
  const create = await source('../src/pages/FIRCreate.jsx')

  assert.match(create, /Suspected Criminals \/ Related Crime Records/)
  assert.match(create, /If the suspect is unknown or has not yet been identified, you can leave this section empty and register the FIR\./)
  assert.match(create, /Enter the complainant's statement describing what happened, including the reported incident details and any information provided by the complainant\./)
  assert.match(create, /Describe the incident as reported by the complainant\.\.\./)
  assert.match(create, /Provide a concise initial summary of the incident based on the information available to the police at the time of FIR registration\./)
  assert.match(create, /Enter the initial police summary of the incident\.\.\./)
  assert.doesNotMatch(create, /criminalIds\.length/)
})
