import AgentCard from './AgentCard';

export default function AgentPipeline({ agents }) {
  if (!agents || agents.length === 0) {
    return (
      <div className="card-surface flex flex-col items-center justify-center gap-2 p-10 text-center">
        <p className="font-semibold text-white">No agents have run yet</p>
        <p className="text-sm text-slate-400">The pipeline will spin up agents as soon as the build starts.</p>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {agents.map((agent, i) => (
        <AgentCard key={agent.id} agent={agent} index={i} />
      ))}
    </div>
  );
}
