import type { FigmaVersion, VersionsResponse, FigmaFileResponse } from './types';

const FIGMA_API_BASE = 'https://api.figma.com/v1';

export class FigmaAPIError extends Error {
  constructor(
    message: string,
    public status?: number
  ) {
    super(message);
    this.name = 'FigmaAPIError';
  }
}

async function fetchWithAuth(url: string, token: string): Promise<Response> {
  const response = await fetch(url, {
    headers: {
      'X-Figma-Token': token,
    },
  });

  if (!response.ok) {
    if (response.status === 401) {
      throw new FigmaAPIError('Invalid or expired token. Please check your Personal Access Token.', 401);
    }
    if (response.status === 403) {
      throw new FigmaAPIError('Access denied. Make sure you have access to this file.', 403);
    }
    if (response.status === 404) {
      throw new FigmaAPIError('File not found. The file may have been deleted or moved.', 404);
    }
    throw new FigmaAPIError(`API request failed: ${response.statusText}`, response.status);
  }

  return response;
}

/**
 * Fetch the version history for a Figma file
 */
export async function fetchVersionHistory(
  fileKey: string,
  token: string,
  pageSize: number = 50
): Promise<FigmaVersion[]> {
  const allVersions: FigmaVersion[] = [];
  let nextPageUrl: string | null = `${FIGMA_API_BASE}/files/${fileKey}/versions?page_size=${pageSize}`;

  while (nextPageUrl) {
    const response = await fetchWithAuth(nextPageUrl, token);
    const data: VersionsResponse = await response.json();
    allVersions.push(...data.versions);
    nextPageUrl = data.pagination.next_page || null;

    // Safety limit to prevent infinite loops
    if (allVersions.length > 500) {
      break;
    }
  }

  return allVersions;
}

/**
 * Fetch a Figma file at a specific version
 */
export async function fetchFileAtVersion(
  fileKey: string,
  token: string,
  versionId?: string
): Promise<FigmaFileResponse> {
  let url = `${FIGMA_API_BASE}/files/${fileKey}?geometry=paths&plugin_data=shared`;
  if (versionId) {
    url += `&version=${versionId}`;
  }

  const response = await fetchWithAuth(url, token);
  return response.json();
}

/**
 * Filter versions to find those within a date range
 */
export function filterVersionsByDateRange(
  versions: FigmaVersion[],
  startDate: Date,
  endDate: Date
): FigmaVersion[] {
  return versions.filter((version) => {
    const versionDate = new Date(version.created_at);
    return versionDate >= startDate && versionDate <= endDate;
  });
}

/**
 * Find the closest version to a given date
 */
export function findClosestVersion(
  versions: FigmaVersion[],
  targetDate: Date,
  direction: 'before' | 'after' | 'nearest' = 'nearest'
): FigmaVersion | null {
  if (versions.length === 0) return null;

  const targetTime = targetDate.getTime();

  // Sort versions by date
  const sortedVersions = [...versions].sort(
    (a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime()
  );

  if (direction === 'before') {
    // Find the latest version before or at the target date
    const beforeVersions = sortedVersions.filter(
      (v) => new Date(v.created_at).getTime() <= targetTime
    );
    return beforeVersions.length > 0 ? beforeVersions[beforeVersions.length - 1] : sortedVersions[0];
  }

  if (direction === 'after') {
    // Find the earliest version after or at the target date
    const afterVersions = sortedVersions.filter(
      (v) => new Date(v.created_at).getTime() >= targetTime
    );
    return afterVersions.length > 0 ? afterVersions[0] : sortedVersions[sortedVersions.length - 1];
  }

  // Find the nearest version to the target date
  let closestVersion = sortedVersions[0];
  let closestDiff = Math.abs(new Date(closestVersion.created_at).getTime() - targetTime);

  for (const version of sortedVersions) {
    const diff = Math.abs(new Date(version.created_at).getTime() - targetTime);
    if (diff < closestDiff) {
      closestDiff = diff;
      closestVersion = version;
    }
  }

  return closestVersion;
}

/**
 * Get versions for comparison based on date range
 * Returns [olderVersion, newerVersion]
 */
export function getVersionsForComparison(
  versions: FigmaVersion[],
  startDate: Date,
  endDate: Date
): [FigmaVersion | null, FigmaVersion | null] {
  const olderVersion = findClosestVersion(versions, startDate, 'before');
  const newerVersion = findClosestVersion(versions, endDate, 'after');
  return [olderVersion, newerVersion];
}

/**
 * Validate a Figma Personal Access Token by making a test request
 */
export async function validateToken(token: string): Promise<boolean> {
  try {
    const response = await fetch(`${FIGMA_API_BASE}/me`, {
      headers: {
        'X-Figma-Token': token,
      },
    });
    return response.ok;
  } catch {
    return false;
  }
}
