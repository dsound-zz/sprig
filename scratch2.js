const fs = require('fs');
const content = fs.readFileSync('components/canvas/MindMapCanvas.tsx', 'utf8');

// find all setNodes calls and extract what they do
const lines = content.split('\n');
lines.forEach((l, i) => {
  if (l.includes('setNodes(')) {
    console.log(`Line ${i+1}: ${l.trim()}`);
  }
});
