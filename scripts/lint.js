'use strict';

const { execFileSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');

const roots = ['src', 'test', 'scripts'];
const files = [];

function visit(directory) {
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const target = path.join(directory, entry.name);
    if (entry.isDirectory()) visit(target);
    if (entry.isFile() && entry.name.endsWith('.js')) files.push(target);
  }
}

for (const root of roots) {
  if (fs.existsSync(root)) visit(root);
}

let failed = false;
for (const file of files) {
  const content = fs.readFileSync(file, 'utf8');
  content.split('\n').forEach((line, index) => {
    if (/\s+$/.test(line)) {
      console.error(`${file}:${index + 1}: trailing whitespace`);
      failed = true;
    }
    if (line.includes('\t')) {
      console.error(`${file}:${index + 1}: tab character`);
      failed = true;
    }
  });
  try {
    execFileSync(process.execPath, ['--check', file], { stdio: 'pipe' });
  } catch (error) {
    process.stderr.write(error.stderr);
    failed = true;
  }
}

if (failed) process.exitCode = 1;
else console.log(`Checked ${files.length} JavaScript files`);
