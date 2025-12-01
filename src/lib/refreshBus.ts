type RefreshListener = () => void;

const listeners = new Set<RefreshListener>();

export function subscribeToRefresh(listener: RefreshListener) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function triggerGlobalRefresh() {
  listeners.forEach((listener) => {
    try {
      listener();
    } catch (err) {
      console.error('Refresh listener failed', err);
    }
  });
}
