import { HaWsClient } from '@/lib/haWebSocket';
import type { HaConnectionLike } from '@/lib/homeAssistant';
import { callHomeAssistantAPI } from '@/lib/homeAssistant';

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

function isUnknownCommandError(err: unknown) {
  if (!err || typeof err !== 'object') return false;
  const obj = err as Record<string, unknown>;
  const error = obj.error && typeof obj.error === 'object' ? (obj.error as Record<string, unknown>) : null;
  return typeof error?.code === 'string' && error.code === 'unknown_command';
}

async function continueConfigFlowRest(
  ha: HaConnectionLike,
  flowId: string,
  userInput: Record<string, unknown>
): Promise<HaConfigFlowStep> {
  const body: Record<string, unknown> = {};
  if (userInput && Object.keys(userInput).length > 0) {
    body.user_input = userInput;
  }
  const step = await callHomeAssistantAPI<unknown>(
    ha,
    `/api/config/config_entries/flow/${encodeURIComponent(flowId)}`,
    {
      method: 'POST',
      body: JSON.stringify(body),
      timeoutMs: 12000,
    }
  );
  return sanitizeFlowStep(step);
}

async function startConfigFlowRest(
  ha: HaConnectionLike,
  handler: string,
  opts?: { showAdvanced?: boolean }
): Promise<HaConfigFlowStep> {
  const step = await callHomeAssistantAPI<unknown>(ha, '/api/config/config_entries/flow', {
    method: 'POST',
    body: JSON.stringify({
      handler,
      show_advanced_options: opts?.showAdvanced ?? false,
    }),
    timeoutMs: 12000,
  });
  return sanitizeFlowStep(step);
}

async function abortConfigFlowRest(ha: HaConnectionLike, flowId: string): Promise<void> {
  await callHomeAssistantAPI<unknown>(
    ha,
    `/api/config/config_entries/flow/${encodeURIComponent(flowId)}`,
    { method: 'DELETE', timeoutMs: 12000 }
  );
}

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
  } catch (err) {
    if (isUnknownCommandError(err)) {
      return startConfigFlowRest(ha, handler, opts);
    }
    throw err;
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
    const payload: Record<string, unknown> = { flow_id: flowId };
    if (userInput && Object.keys(userInput).length > 0) {
      payload.user_input = userInput;
    }
    const step = await client.call('config_entries/flow/configure', payload);
    return sanitizeFlowStep(step);
  } catch (err) {
    if (isUnknownCommandError(err)) {
      return continueConfigFlowRest(ha, flowId, userInput);
    }
    throw err;
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
    if (isUnknownCommandError(err)) {
      try {
        await abortConfigFlowRest(ha, flowId);
        return;
      } catch (restErr) {
        console.warn('[haConfigFlow] REST abort failed (continuing)', { flowId, restErr });
      }
    }
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
