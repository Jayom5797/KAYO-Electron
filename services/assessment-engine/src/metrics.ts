import type {
  NetworkRequest,
  ResourceType,
  AggregateMetrics,
  TypeMetrics,
  ProcessedData,
} from './types.js';

export function groupByType(requests: NetworkRequest[]): Map<ResourceType, NetworkRequest[]> {
  const map = new Map<ResourceType, NetworkRequest[]>();
  for (const req of requests) {
    const group = map.get(req.resourceType) ?? [];
    group.push(req);
    map.set(req.resourceType, group);
  }
  return map;
}

export function computeAggregate(requests: NetworkRequest[]): AggregateMetrics {
  let totalBytes = 0;
  let totalDurationMs = 0;
  for (const req of requests) {
    totalBytes += req.sizeBytes;
    totalDurationMs += req.durationMs;
  }
  return { totalRequests: requests.length, totalBytes, totalDurationMs };
}

export function computeTypeMetrics(requests: NetworkRequest[]): TypeMetrics[] {
  const groups = groupByType(requests);
  const result: TypeMetrics[] = [];
  for (const [resourceType, group] of groups) {
    const totalBytes = group.reduce((sum, r) => sum + r.sizeBytes, 0);
    const totalDuration = group.reduce((sum, r) => sum + r.durationMs, 0);
    result.push({
      resourceType,
      count: group.length,
      totalBytes,
      avgDurationMs: group.length > 0 ? totalDuration / group.length : 0,
    });
  }
  return result;
}

export function getSlowest(requests: NetworkRequest[], n: number): NetworkRequest[] {
  return [...requests].sort((a, b) => b.durationMs - a.durationMs).slice(0, n);
}

export function getErrors(requests: NetworkRequest[]): NetworkRequest[] {
  return requests.filter(
    (r) => r.failed === true || (r.statusCode !== null && r.statusCode >= 400)
  );
}

export function processRequests(requests: NetworkRequest[]): ProcessedData {
  return {
    requests,
    aggregate: computeAggregate(requests),
    byType: computeTypeMetrics(requests),
    slowest: getSlowest(requests, 5),
    errors: getErrors(requests),
  };
}
