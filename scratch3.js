const nds = [
  { id: 'parent-1', type: 'mindmap', data: { label: 'Parent' } },
  { id: 'ghost-1', type: 'ghost', data: { label: '...', parentId: 'parent-1' } }
];

const childrenSet = new Set(
  nds.filter(n => {
    const parentId = n.data.parentId;
    return parentId !== null && parentId !== undefined;
  }).map(n => n.data.parentId)
);

const updatedNds = nds.map((n) => {
  if (n.type === "ghost") {
    return {
      ...n,
      data: {
        ...n.data,
      },
    };
  }
  if (n.type !== "mindmap") return n;
  const hasChildren = childrenSet.has(n.id);
  
  return {
    ...n,
    data: {
      ...n.data,
      hasChildren,
    },
  };
});

console.log(updatedNds.find(n => n.id === 'parent-1').data.hasChildren);
