const nds = [
  { id: '1', type: 'mindmap', data: { parentId: null } },
  { id: 'ghost-1', type: 'ghost', data: { parentId: '1', label: '...' } }
];

const childrenSet = new Set(
  nds.filter(n => {
    const parentId = n.data.parentId;
    return parentId !== null && parentId !== undefined;
  }).map(n => n.data.parentId)
);

console.log('hasChildren for 1:', childrenSet.has('1'));
