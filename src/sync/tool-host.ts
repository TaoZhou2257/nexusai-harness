import { parseOpenApiDocument } from './openapi'

/**
 * Where a tool's OpenAPI `servers[0].url` can be called from this desktop.
 *
 * `bff-service` is the public API under `/service/api`. Any other single-label
 * hostname (`callback-nexusai`, and the same kind of cluster DNS name) is not
 * resolvable here. Public hosts and `localhost` stay callable.
 */

/** One OpenAPI server after it has been placed on a host this desktop can use. */
export interface PlacedServer {
  readonly serverUrl: string
  readonly pathPrefix: string
  /** Cluster-internal host. The desktop must not register or call it. */
  readonly intranet: boolean
}

/** Classify `serverUrl` and rewrite the one internal host that has a public path. */
export function placeServer(serverUrl: string, baseUrl: string): PlacedServer {
  let parsed: URL
  try {
    parsed = new URL(serverUrl)
  } catch {
    return { serverUrl, pathPrefix: '', intranet: false }
  }
  if (parsed.hostname === 'bff-service') {
    return { serverUrl: baseUrl.replace(/\/$/, ''), pathPrefix: '/service/api', intranet: false }
  }
  if (isClusterHostname(parsed.hostname)) return { serverUrl, pathPrefix: '', intranet: true }
  return { serverUrl, pathPrefix: '', intranet: false }
}

/** Whether this schema's server is a cluster host the desktop must not call. */
export function intranetSchema(schema: string, baseUrl: string): boolean {
  const doc = parseOpenApiDocument(schema)
  if (doc.serverUrl === '') return false
  return placeServer(doc.serverUrl, baseUrl).intranet
}

/** Docker-style service names. `localhost` is this machine, so it stays callable. */
function isClusterHostname(hostname: string): boolean {
  const name = hostname.toLowerCase().replace(/\.+$/, '')
  if (name === '' || name === 'localhost' || name.includes(':')) return false
  if (name.endsWith('.cluster.local')) return true
  return !name.includes('.')
}
