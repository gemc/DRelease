const fs = require("node:fs");
const { randomUUID } = require("node:crypto");

function getInput(name, fallback = "") {
  const key = `INPUT_${name.replace(/ /g, "_").toUpperCase()}`;
  const value = process.env[key];
  return value === undefined || value.trim() === "" ? fallback : value.trim();
}

function setOutput(name, value) {
  const text = String(value);
  const delimiter = `DRELEASE_${randomUUID()}`;
  if (process.env.GITHUB_OUTPUT) {
    fs.appendFileSync(process.env.GITHUB_OUTPUT, `${name}<<${delimiter}\n${text}\n${delimiter}\n`, "utf8");
  }
  console.log(`output ${name}: ${text}`);
}

function appendSummary(markdown) {
  if (process.env.GITHUB_STEP_SUMMARY) {
    fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY, `${markdown.trimEnd()}\n`, "utf8");
  }
}

module.exports = { appendSummary, getInput, setOutput };
