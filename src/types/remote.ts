export type RemoteBindingSummary = {
  bindingId: string;
  remoteDeviceId: string;
  targetDeviceId: string | null;
  targetEntityId: string | null;
  targetKind: string;
  bindingName: string | null;
  enabled: boolean;
};

export type RemoteCapabilitySummary = {
  targetKind: string;
  domain: string;
  supported: boolean;
  actions: string[];
  description: string;
  reason: string | null;
  targetDeviceId: string | null;
  targetEntityId: string | null;
  source: string;
};

export type RemoteTargetSummary = {
  targetId: string;
  entityId: string | null;
  deviceId: string | null;
  name: string;
  domain: string;
  areaName: string | null;
  label: string | null;
  labelCategory: string | null;
  state: string;
};

export type RemoteDeviceSummary = {
  remoteDeviceId: string;
  entityId: string;
  deviceId: string | null;
  name: string;
  state: string;
  area: string | null;
  areaName: string | null;
  label: string | null;
  labelCategory: string | null;
  labels: string[];
  domain: string;
  attributes: Record<string, unknown>;
  binding: RemoteBindingSummary | null;
  capability: RemoteCapabilitySummary | null;
  target: RemoteTargetSummary | null;
};
