import {
  MessageSquare,
  Code2,
  FileSearch,
  Bug,
  RefreshCw,
  BookOpen,
  FlaskConical,
  Database,
  Regex,
  GitCommit,
  FileText,
  Network,
  Cpu,
} from 'lucide-react';

const ICON_MAP = {
  chat: MessageSquare,
  code: Code2,
  explain: FileSearch,
  bug: Bug,
  refactor: RefreshCw,
  docs: BookOpen,
  test: FlaskConical,
  sql: Database,
  regex: Regex,
  commit: GitCommit,
  readme: FileText,
  architecture: Network,
};

export default function ToolIcon({ name, size = 20, className }) {
  const Icon = ICON_MAP[name] || Cpu;
  return <Icon size={size} className={className} />;
}
