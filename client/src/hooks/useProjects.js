import { useCallback, useEffect, useRef, useState } from 'react';
import { projectsApi } from '../api/projects';

export function useProjects({ autoRefresh = false, intervalMs = 5000 } = {}) {
  const [projects, setProjects] = useState([]);
  const [counts, setCounts] = useState({
    running: 0,
    validating: 0,
    completed: 0,
    failed: 0,
    validation_failed: 0,
  });
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [filters, setFilters] = useState({ search: '', status: '', stack: '' });
  const timerRef = useRef(null);

  const load = useCallback(async (filter) => {
    try {
      setLoading(true);
      setError(null);
      const data = await projectsApi.list(filter || filters);
      setProjects(data.projects);
      setCounts(data.counts);
      setTotal(data.total);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, [filters]);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    if (!autoRefresh) return undefined;
    timerRef.current = setInterval(() => load(), intervalMs);
    return () => clearInterval(timerRef.current);
  }, [autoRefresh, intervalMs, load]);

  const refresh = useCallback(() => load(), [load]);

  return { projects, counts, total, loading, error, filters, setFilters, refresh };
}
