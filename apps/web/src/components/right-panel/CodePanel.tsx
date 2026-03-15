'use client';

import { useState, useEffect } from 'react';
import { Prism as SyntaxHighlighter } from 'react-syntax-highlighter';
import { oneDark } from 'react-syntax-highlighter/dist/esm/styles/prism';
import { useFileStore, type FileNode } from '@/stores/file-store';
import { useRSPStore, selectActiveAgentId, selectActiveSquadId } from '@/stores/rsp-store';
import { useAgentStore } from '@/stores/agent-store';

/** Recursively renders a FileNode and its children */
function FileTreeNode({
  node,
  depth,
  selectedFile,
  hoveredFile,
  onSelect,
  onHover,
}: {
  node: FileNode;
  depth: number;
  selectedFile: string | null;
  hoveredFile: string | null;
  onSelect: (path: string) => void;
  onHover: (path: string | null) => void;
}) {
  const [expanded, setExpanded] = useState(depth < 2);
  const isFile = node.type === 'file';
  const isSelected = isFile && node.path === selectedFile;
  const isHov = hoveredFile === node.path;

  return (
    <>
      <button
        onClick={() => {
          if (isFile) {
            onSelect(node.path);
          } else {
            setExpanded(e => !e);
          }
        }}
        onMouseEnter={() => onHover(node.path)}
        onMouseLeave={() => onHover(null)}
        title={node.path}
        style={{
          width: '100%',
          display: 'flex',
          alignItems: 'center',
          gap: 5,
          paddingTop: 3,
          paddingBottom: 3,
          paddingLeft: 8 + depth * 12,
          paddingRight: 8,
          fontSize: 12,
          textAlign: 'left',
          transition: 'background 0.15s, color 0.15s',
          background: isSelected
            ? 'var(--coral-subtle)'
            : isHov
            ? 'var(--surface-hover)'
            : 'none',
          color: isSelected
            ? 'var(--text)'
            : isHov
            ? 'var(--text-secondary)'
            : 'var(--text-muted)',
          border: 'none',
          cursor: 'pointer',
        }}
      >
        <span style={{ flexShrink: 0, fontSize: 11 }}>
          {isFile ? '📄' : expanded ? '📂' : '📁'}
        </span>
        <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {node.name}
        </span>
      </button>
      {!isFile && expanded && node.children && node.children.map(child => (
        <FileTreeNode
          key={child.path}
          node={child}
          depth={depth + 1}
          selectedFile={selectedFile}
          hoveredFile={hoveredFile}
          onSelect={onSelect}
          onHover={onHover}
        />
      ))}
    </>
  );
}

const FILE_LANGUAGE_LABELS: Record<string, string> = {
  typescript: 'TypeScript',
  typescriptreact: 'TypeScript React',
  javascript: 'JavaScript',
  javascriptreact: 'JavaScript React',
  json: 'JSON',
  css: 'CSS',
  scss: 'SCSS',
  html: 'HTML',
  markdown: 'Markdown',
  python: 'Python',
  rust: 'Rust',
  go: 'Go',
  yaml: 'YAML',
  bash: 'Bash',
  plaintext: 'Plain Text',
};

function CodePanel() {
  const {
    tree,
    treeLoading,
    selectedFile,
    fileContent,
    fileLanguage,
    isLoading,
    fetchTree,
    selectFile,
  } = useFileStore();

  // P-4: RSP context
  const activeAgentId = useRSPStore(selectActiveAgentId);
  const activeSquadId = useRSPStore(selectActiveSquadId);
  const agents = useAgentStore(s => s.agents);
  const activeAgent = agents.find(a => a.id === activeAgentId);
  const agentLabel = activeAgent
    ? `${activeAgent.emoji ?? '🤖'} ${activeAgent.name}`
    : activeSquadId ? '👥 Squad workspace' : null;

  const [hoveredFile, setHoveredFile] = useState<string | null>(null);
  // rootPath from localStorage or empty
  const [rootPath, setRootPath] = useState<string>(() => {
    if (typeof window !== 'undefined') {
      return localStorage.getItem('hiveclaw-code-rootPath') ?? '';
    }
    return '';
  });
  const [showPathInput, setShowPathInput] = useState(false);
  const [pathInput, setPathInput] = useState(rootPath);

  // Only load file tree when a rootPath is configured
  useEffect(() => {
    if (rootPath) {
      fetchTree(rootPath, 4);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rootPath]);

  const displayName = selectedFile
    ? (selectedFile.split('/').pop() ?? selectedFile)
    : 'No file selected';
  const langLabel = FILE_LANGUAGE_LABELS[fileLanguage] ?? fileLanguage;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', flex: 1, minHeight: 0 }}>
      {/* P-4: Agent context header */}
      {agentLabel && (
        <div style={{
          padding: '4px 10px',
          fontSize: 11,
          color: 'var(--text-muted)',
          background: 'var(--surface)',
          borderBottom: '1px solid var(--border)',
          display: 'flex', alignItems: 'center', gap: 6,
        }}>
          <span style={{ opacity: 0.6 }}>Workspace:</span>
          <span style={{ color: 'var(--coral)', fontWeight: 600 }}>{agentLabel}</span>
        </div>
      )}
      <div style={{ display: 'flex', flex: 1, minHeight: 0 }}>
      {/* File tree */}
      <div style={{
        width: 176,
        flexShrink: 0,
        borderRight: '1px solid var(--border)',
        overflowY: 'auto',
        paddingTop: 8,
        paddingBottom: 8,
      }}>
        {/* No project configured — empty state with path input */}
        {!rootPath && (
          <div style={{ padding: '16px 10px' }}>
            <div style={{ fontSize: 20, textAlign: 'center', marginBottom: 8 }}>📁</div>
            <div style={{ fontSize: 11, color: 'var(--text-muted)', textAlign: 'center', lineHeight: 1.5, marginBottom: 10 }}>
              Set a project directory
            </div>
            <input
              value={pathInput}
              onChange={(e) => setPathInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && pathInput.trim()) {
                  setRootPath(pathInput.trim());
                  localStorage.setItem('hiveclaw-code-rootPath', pathInput.trim());
                }
              }}
              placeholder="/path/to/project"
              style={{
                width: '100%', padding: '6px 8px', borderRadius: 6,
                background: 'var(--bg)', border: '1px solid var(--border)',
                color: 'var(--text)', fontSize: 11, fontFamily: 'var(--font-mono)',
                outline: 'none', boxSizing: 'border-box',
              }}
            />
            <button
              onClick={() => {
                if (pathInput.trim()) {
                  setRootPath(pathInput.trim());
                  localStorage.setItem('hiveclaw-code-rootPath', pathInput.trim());
                }
              }}
              style={{
                width: '100%', marginTop: 6, padding: '5px 0', borderRadius: 6,
                background: pathInput.trim() ? 'var(--coral)' : 'var(--surface-hover)',
                color: pathInput.trim() ? '#fff' : 'var(--text-muted)',
                border: 'none', fontSize: 11, cursor: pathInput.trim() ? 'pointer' : 'default',
              }}
            >
              Open
            </button>
          </div>
        )}
        {rootPath && !showPathInput && (
          <div style={{
            padding: '4px 8px', borderBottom: '1px solid var(--border)',
            display: 'flex', alignItems: 'center', gap: 4,
          }}>
            <span style={{ fontSize: 10, color: 'var(--text-muted)', fontFamily: 'var(--font-mono)', flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {rootPath.split('/').pop()}
            </span>
            <button
              onClick={() => { setShowPathInput(true); setPathInput(rootPath); }}
              style={{ background: 'none', border: 'none', color: 'var(--text-muted)', fontSize: 10, cursor: 'pointer', padding: '2px 4px' }}
            >✏️</button>
            <button
              onClick={() => { setRootPath(''); localStorage.removeItem('hiveclaw-code-rootPath'); }}
              style={{ background: 'none', border: 'none', color: 'var(--text-muted)', fontSize: 10, cursor: 'pointer', padding: '2px 4px' }}
            >✕</button>
          </div>
        )}
        {showPathInput && (
          <div style={{ padding: '4px 8px', borderBottom: '1px solid var(--border)', display: 'flex', gap: 4 }}>
            <input
              autoFocus
              value={pathInput}
              onChange={(e) => setPathInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && pathInput.trim()) {
                  setRootPath(pathInput.trim());
                  localStorage.setItem('hiveclaw-code-rootPath', pathInput.trim());
                  setShowPathInput(false);
                }
                if (e.key === 'Escape') setShowPathInput(false);
              }}
              style={{
                flex: 1, padding: '4px 6px', borderRadius: 4,
                background: 'var(--bg)', border: '1px solid var(--border)',
                color: 'var(--text)', fontSize: 10, fontFamily: 'var(--font-mono)',
                outline: 'none',
              }}
            />
            <button
              onClick={() => {
                if (pathInput.trim()) {
                  setRootPath(pathInput.trim());
                  localStorage.setItem('hiveclaw-code-rootPath', pathInput.trim());
                  setShowPathInput(false);
                }
              }}
              style={{ padding: '2px 8px', borderRadius: 4, background: 'var(--coral)', color: '#fff', border: 'none', fontSize: 10, cursor: 'pointer' }}
            >Go</button>
          </div>
        )}
        {rootPath && treeLoading && (
          <div style={{ padding: '8px 12px', fontSize: 11, color: 'var(--text-muted)', fontFamily: 'var(--font-mono)' }}>
            Loading…
          </div>
        )}
        {rootPath && !treeLoading && tree.length === 0 && (
          <div style={{ padding: '8px 12px', fontSize: 11, color: 'var(--text-muted)' }}>
            No files found
          </div>
        )}
        {rootPath && tree.map(node => (
          <FileTreeNode
            key={node.path}
            node={node}
            depth={0}
            selectedFile={selectedFile}
            hoveredFile={hoveredFile}
            onSelect={selectFile}
            onHover={setHoveredFile}
          />
        ))}
      </div>

      {/* Code viewer */}
      <div style={{ flex: 1, overflow: 'auto', background: 'var(--code-bg)', position: 'relative' }}>
        {isLoading && (
          <div style={{
            position: 'absolute',
            top: 0, left: 0, right: 0, bottom: 0,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            background: 'var(--code-bg)',
            zIndex: 1,
          }}>
            <span style={{ fontSize: 12, color: 'var(--text-muted)', fontFamily: 'var(--font-mono)' }}>
              Loading…
            </span>
          </div>
        )}
        <div style={{ padding: 12 }}>
          <div style={{
            fontSize: 11,
            color: 'var(--text-muted)',
            marginBottom: 8,
            fontFamily: 'var(--font-mono)',
            borderBottom: '1px solid var(--border)',
            paddingBottom: 8,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
          }}>
            <span>{displayName}</span>
            {selectedFile && (
              <span style={{ opacity: 0.6, fontSize: 10 }}>{langLabel}</span>
            )}
          </div>
          {!selectedFile && !isLoading ? (
            <div style={{
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              justifyContent: 'center',
              gap: 8,
              padding: '40px 24px',
              textAlign: 'center',
            }}>
              <span style={{ fontSize: 28 }}>📄</span>
              <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>
                {rootPath ? 'Select a file to view its contents' : 'No project directory configured'}
              </span>
            </div>
          ) : (
            <SyntaxHighlighter
              language={fileLanguage}
              style={oneDark}
              showLineNumbers
              customStyle={{
                margin: 0,
                padding: 12,
                background: 'var(--code-bg)',
                fontSize: 12,
                fontFamily: 'var(--font-mono)',
                lineHeight: 1.6,
                opacity: isLoading ? 0.4 : 1,
                transition: 'opacity 0.2s',
              }}
              lineNumberStyle={{ color: 'var(--text-muted)', opacity: 0.5, minWidth: '2em' }}
            >
              {fileContent || ''}
            </SyntaxHighlighter>
          )}
        </div>
      </div>
      </div>
    </div>
  );
}

// ─── Preview Panel ────────────────────────────────────────────────────────────

export default CodePanel;
