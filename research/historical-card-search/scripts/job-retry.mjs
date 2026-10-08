import { isTransientHttpFailure } from './http-transport.mjs';

export function requestWorked(observations = []) {
  return observations.some((observation) => observation.requestSucceeded ?? ['ok', 'partial', 'unverified'].includes(observation.status));
}

export function shouldRetryJob(result) {
  const observations = result.observations ?? [];
  const errors = result.errors ?? [];
  if (errors.some((error) => isTransientHttpFailure({ status: error.status }))) return true;
  return observations.length === 0 && errors.length === 0;
}