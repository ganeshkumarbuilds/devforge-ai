import { useEffect, useState } from 'react';
import {
  Download,
  FileText,
  Check,
  Copy,
  Loader2,
} from 'lucide-react';
import { projectsApi } from '../../api/projects';
import { useToast } from '../../context/ToastContext';
import { cn, downloadTextFile } from '../../lib/utils';
import Badge from '../ui/Badge';
import Button from '../ui/Button';
import Modal from '../ui/Modal';

const GROUPS = [
  { label: 'Docker & orchestration', pattern: /^(Dockerfile|\.dockerignore|docker-compose\.yml)$/ },
  { label: 'CI / CD', pattern: /^\.github\// },
  { label: 'Reverse proxy', pattern: /^nginx\// },
  { label: 'Platforms', pattern: /(render\.yaml|nixpacks\.toml|vercel\.json|netlify\.toml)$/ },
  { label: 'Env & scripts', pattern: /(\.env|scripts\/|DEPLOYMENT\.md)/ },
];

export default function DeploymentModal({ projectId, open, onClose }) {
  const toast = useToast();
  const [loading, setLoading] = useState(false);
  const [data, setData] = useState(null);
  const [selected, setSelected] = useState('DEPLOYMENT.md');
  const [copied, setCopied] = useState(null);
  const [downloading, setDownloading] = useState(false);

  useEffect(() => {
    if (!open) return;
    setLoading(true);
    projectsApi
      .deployment(projectId)
      .then((result) => {
        setData(result);
        setSelected(result.files?.some((f) => f.path === 'DEPLOYMENT.md') ? 'DEPLOYMENT.md' : result.files?.[0]?.path || '');
      })
      .catch((err) => toast.error('Failed to load deployment config', err.message))
      .finally(() => setLoading(false));
  }, [open, projectId, toast]);

  const files = data?.files || [];
  const selectedFile = files.find((f) => f.path === selected);

  const copyFile = async () => {
    if (!selectedFile) return;
    try {
      await navigator.clipboard.writeText(selectedFile.content);
      setCopied(selectedFile.path);
      setTimeout(() => setCopied(null), 1600);
    } catch {
      toast.error('Copy failed', 'Clipboard unavailable in this browser.');
    }
  };

  const downloadSingle = () => {
    if (!selectedFile) return;
    downloadTextFile(selectedFile.content, selectedFile.path.split('/').pop(), 'text/plain;charset=utf-8');
  };

  const downloadZip = async () => {
    setDownloading(true);
    try {
      const { blob, filename } = await projectsApi.downloadDeployment(projectId);
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = filename || 'deployment.zip';
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 2000);
      toast.success('Deployment pack downloaded');
    } catch (err) {
      toast.error('Download failed', err.message);
    } finally {
      setDownloading(false);
    }
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Deployment"
      description="Production-ready deployment configuration generated for this project."
      size="xl"
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>Close</Button>
          <Button variant="secondary" onClick={copyFile} disabled={!selectedFile}>
            {copied === selectedFile?.path ? <Check className="h-4 w-4 text-emerald-400" /> : <Copy className="h-4 w-4" />}
            Copy
          </Button>
          <Button variant="secondary" onClick={downloadSingle} disabled={!selectedFile}>
            <FileText className="h-4 w-4" /> Download file
          </Button>
          <Button onClick={downloadZip} loading={downloading}>
            <Download className="h-4 w-4" /> Download pack (ZIP)
          </Button>
        </>
      }
    >
      {loading ? (
        <p className="flex items-center gap-2 text-sm text-slate-400">
          <Loader2 className="h-4 w-4 animate-spin" /> Generating deployment configuration…
        </p>
      ) : !data ? (
        <p className="text-sm text-slate-400">No deployment configuration available.</p>
      ) : (
        <div className="grid gap-4 lg:grid-cols-[240px_1fr]">
          {/* File list */}
          <div className="max-h-[60vh] space-y-3 overflow-y-auto pr-1">
            <div>
              <p className="mb-1.5 text-[11px] font-semibold uppercase tracking-wider text-slate-500">Supported platforms</p>
              <div className="flex flex-wrap gap-1.5">
                {['Render', 'Railway', 'Vercel', 'Netlify'].map((p) => (
                  <Badge key={p} tone="accent">{p}</Badge>
                ))}
              </div>
            </div>
            {GROUPS.map((g) => {
              const items = files.filter((f) => g.pattern.test(f.path));
              if (!items.length) return null;
              return (
                <div key={g.label}>
                  <p className="mb-1 text-[11px] font-semibold uppercase tracking-wider text-slate-600">{g.label}</p>
                  <div className="space-y-0.5">
                    {items.map((f) => (
                      <button
                        key={f.path}
                        onClick={() => setSelected(f.path)}
                        className={cn(
                          'block w-full truncate rounded-md px-2 py-1 text-left font-mono text-xs transition-colors',
                          selected === f.path ? 'bg-accent/15 text-white' : 'text-slate-400 hover:bg-white/5 hover:text-slate-200'
                        )}
                      >
                        {f.path}
                      </button>
                    ))}
                  </div>
                </div>
              );
            })}
          </div>

          {/* Preview */}
          <div className="min-w-0 overflow-hidden rounded-lg border border-white/[0.06] bg-base-950/80">
            <div className="flex h-9 items-center justify-between gap-2 border-b border-white/[0.06] bg-base-900/60 px-3">
              <span className="truncate font-mono text-xs text-slate-300">{selectedFile?.path}</span>
              <button onClick={copyFile} className="rounded p-1 text-slate-400 hover:text-slate-200" title="Copy file">
                {copied === selectedFile?.path ? <Check className="h-3.5 w-3.5 text-emerald-400" /> : <Copy className="h-3.5 w-3.5" />}
              </button>
            </div>
            <pre className="h-[44vh] overflow-auto p-3 font-mono text-[11.5px] leading-relaxed text-slate-300">
              <code>{selectedFile?.content}</code>
            </pre>
          </div>
        </div>
      )}
    </Modal>
  );
}