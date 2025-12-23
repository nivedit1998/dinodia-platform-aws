import { HaWsClient } from '@/lib/haWebSocket';
import type { HaConnectionLike } from '@/lib/homeAssistant';

export type HaConfigFlowStep = {
  type: string;
  flow_id?: string;
  handler?: string;
  step_id?: string;
  data_schema?: unknown;
  description_placeholders?: Record<string, unknown>;
  errors?: Record<string, string>;
  progress_action?: string;
};

export type HaConfigFlowProgress = {
  flow_id: string;
  handler: string;
  context: { source?: string | null } | null;
  title?: string | null;
  description?: string | null;
};

export function sanitizeFlowStep(step: unknown): HaConfigFlowStep {
  if (!step || typeof step !== 'object') {
    return { type: 'unknown' };
  }
  const obj = step as Record<string, unknown>;
  return {
    type: typeof obj.type === 'string' ? obj.type : 'unknown',
    flow_id: typeof obj.flow_id === 'string' ? obj.flow_id : undefined,
    handler: typeof obj.handler === 'string' ? obj.handler : undefined,
    step_id: typeof obj.step_id === 'string' ? obj.step_id : undefined,
    data_schema: obj.data_schema,
    description_placeholders:
      obj.description_placeholders && typeof obj.description_placeholders === 'object'
        ? (obj.description_placeholders as Record<string, unknown>)
        : undefined,
    errors:
      obj.errors && typeof obj.errors === 'object'
        ? (obj.errors as Record<string, string>)
        : undefined,
    progress_action: typeof obj.progress_action === 'string' ? obj.progress_action : undefined,
  };
}

function sanitizeFlowProgress(item: unknown): HaConfigFlowProgress | null {
  if (!item || typeof item !== 'object') return null;
  const obj = item as Record<string, unknown>;
  const flow_id = typeof obj.flow_id === 'string' ? obj.flow_id : null;
  const handler = typeof obj.handler === 'string' ? obj.handler : null;
  const context =
    obj.context && typeof obj.context === 'object'
      ? { source: typeof (obj.context as Record<string, unknown>).source === 'string'
            ? ((obj.context as Record<string, unknown>).source as string)
            : null }
      : null;
  if (!flow_id || !handler) return null;
  return {
    flow_id,
    handler,
    context,
    title: typeof obj.title === 'string' ? obj.title : null,
    description: typeof obj.description === 'string' ? obj.description : null,
  };
}

export async function startConfigFlow(
  ha: HaConnectionLike,
  handler: string,
  opts?: { showAdvanced?: boolean }
): Promise<HaConfigFlowStep> {
  const client = await HaWsClient.connect(ha);
  try {
    const step = await client.call('config_entries/flow/init', {
      handler,
      show_advanced_options: opts?.showAdvanced ?? false,
    });
    return sanitizeFlowStep(step);
  } finally {
    client.close();
  }
}

export async function continueConfigFlow(
  ha: HaConnectionLike,
  flowId: string,
  userInput: Record<string, unknown> = {}
): Promise<HaConfigFlowStep> {
  const client = await HaWsClient.connect(ha);
  try {
    const step = await client.call('config_entries/flow/configure', {
      flow_id: flowId,
      user_input: userInput,
    });
    return sanitizeFlowStep(step);
  } finally {
    client.close();
  }
}

export async function abortConfigFlow(ha: HaConnectionLike, flowId: string): Promise<void> {
  const client = await HaWsClient.connect(ha);
  try {
    await client.call('config_entries/flow/abort', {
      flow_id: flowId,
    });
  } catch (err) {
    console.warn('[haConfigFlow] Failed to abort flow', { flowId, err });
  } finally {
    client.close();
  }
}

export async function listConfigFlowProgress(
  ha: HaConnectionLike
): Promise<HaConfigFlowProgress[]> {
  const client = await HaWsClient.connect(ha);
  try {
    const items = await client.call<unknown[]>('config_entries/flow/progress');
    const flows = Array.isArray(items) ? items : [];
    return flows
      .map((item) => sanitizeFlowProgress(item))
      .filter((flow): flow is HaConfigFlowProgress => Boolean(flow));
  } finally {
    client.close();
  }
}
