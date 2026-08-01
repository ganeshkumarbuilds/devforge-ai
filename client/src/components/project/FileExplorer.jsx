import { useState } from 'react';
import { motion } from 'framer-motion';
import { Folder, FolderOpen, FileCode2, ChevronRight, Files } from 'lucide-react';
import { cn } from '../../lib/utils';

function FileTree({ nodes, selectedPath, onSelect, depth = 0 }) {
  const [collapsed, setCollapsed] = useState({});
  const toggle = (name) => setCollapsed((c) => ({ ...c, [name]: !c[name] }));

  if (!nodes || nodes.length === 0) return null;

  return (
    <ul className="space-y-0.5">
      {nodes.map((node) => {
        if (node.type === 'folder') {
          const isCollapsed = collapsed[node.name] === true;
          const icon = isCollapsed ? <Folder className="h-4 w-4 text-sky-400/80" /> : <FolderOpen className="h-4 w-4 text-sky-400" />;
          return (
            <li key={node.name}>
              <button
                onClick={() => toggle(node.name)}
                style={{ paddingLeft: `${depth * 16 + 8}px` }}
                className="flex w-full items-center gap-2 rounded-lg py-1.5 pr-2 text-left text-sm text-slate-300 transition-colors hover:bg-white/5"
              >
                <ChevronRight className={cn('h-3.5 w-3.5 shrink-0 text-slate-500 transition-transform duration-200', !isCollapsed && 'rotate-90')} />
                {icon}
                <span className="truncate">{node.name}</span>
              </button>
              {!isCollapsed && (
                <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ duration: 0.15 }}>
                  <FileTree nodes={node.children} selectedPath={selectedPath} onSelect={onSelect} depth={depth + 1} />
                </motion.div>
              )}
            </li>
          );
        }

        const active = node.path === selectedPath;
        return (
          <li key={node.path}>
            <button
              onClick={() => onSelect(node)}
              style={{ paddingLeft: `${(depth + 1) * 16 + 8}px` }}
              className={cn(
                'flex w-full items-center gap-2 rounded-lg py-1.5 pr-2 text-left text-sm transition-colors',
                active ? 'bg-accent/15 text-accent-soft' : 'text-slate-400 hover:bg-white/5 hover:text-slate-200'
              )}
            >
              <FileCode2 className={cn('h-4 w-4 shrink-0', active ? 'text-accent-soft' : 'text-slate-500')} />
              <span className="truncate">{node.name}</span>
            </button>
          </li>
        );
      })}
    </ul>
  );
}

export default function FileExplorer({ fileTree, selectedPath, onSelect, fileCount }) {
  return (
    <div className="flex h-full flex-col">
      <div className="mb-3 flex items-center justify-between px-1">
        <h3 className="flex items-center gap-2 text-sm font-bold text-white">
          <Files className="h-4 w-4 text-accent-soft" />
          Explorer
        </h3>
        <span className="text-xs text-slate-500">{fileCount ?? 0} files</span>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto pr-1">
        {fileTree && fileTree.length > 0 ? (
          <FileTree nodes={fileTree} selectedPath={selectedPath} onSelect={onSelect} />
        ) : (
          <div className="flex h-full flex-col items-center justify-center gap-2 p-8 text-center text-sm text-slate-500">
            <Files className="h-6 w-6 text-slate-600" />
            Files will appear here once the build produces them.
          </div>
        )}
      </div>
    </div>
  );
}
