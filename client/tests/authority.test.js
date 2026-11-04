import test from "node:test"
import assert from "node:assert/strict"
import { getRank, isSeniorOfficer, officerRankOptions, officerRanks } from "../src/authority.js"

test("registration exposes exactly the seven canonical police ranks", () => {
  assert.deepEqual(officerRankOptions.map((option) => option.value), [
    "sp",
    "dsp",
    "inspector",
    "si",
    "asi",
    "head_constable",
    "constable",
  ])
  assert.equal(officerRankOptions.some((option) => option.value === "investigating_officer"), false)
  assert.equal(officerRanks.includes("constable"), true)
  assert.equal(officerRanks.includes("head_constable"), true)
})

test("frontend rank helpers preserve legacy records without granting senior privileges", () => {
  assert.equal(getRank({ role: "officer", rank: "investigating_officer" }), "investigating_officer")
  assert.equal(getRank({ role: "officer", rank: "head_constable" }), "head_constable")
  assert.equal(isSeniorOfficer({ role: "officer", rank: "inspector" }), true)
  assert.equal(isSeniorOfficer({ role: "officer", rank: "si" }), false)
  assert.equal(isSeniorOfficer({ role: "officer", rank: "constable" }), false)
})
