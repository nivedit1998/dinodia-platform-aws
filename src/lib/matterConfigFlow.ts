import {
  abortConfigFlow,
  continueConfigFlow,
  HaConfigFlowStep,
  startConfigFlow,
} from '@/lib/haConfigFlow';
import type { HaConnectionLike } from '@/lib/homeAssistant';

export type { HaConfigFlowStep } from '@/lib/haConfigFlow';

export async function startMatterConfigFlow(ha: HaConnectionLike): Promise<HaConfigFlowStep> {
  return startConfigFlow(ha, 'matter', { showAdvanced: true });
}

export async function continueMatterConfigFlow(
  ha: HaConnectionLike,
  flowId: string,
  userInput: Record<string, unknown>
): Promise<HaConfigFlowStep> {
  return continueConfigFlow(ha, flowId, userInput);
}

export async function abortMatterConfigFlow(ha: HaConnectionLike, flowId: string): Promise<void> {
  await abortConfigFlow(ha, flowId);
}
