/**
 * OpenAPI 3 → dsh tool conversion. Parses the custom tool's stored schema
 * document and projects each operation onto dsh's own JSON-Schema-flavored
 * parameter DSL (`ParameterSchemaSpec`): single `type` values, `oneOf`,
 * `properties`/`items`/`enum`/`const`/`description`, per-property
 * `required: true`. Anything richer (type arrays, allOf/anyOf, formats,
 * patterns, bounds) degrades to `{ type: 'json' }` so the model still gets a
 * usable parameter instead of a failed registration.
 */
import { parse as parseYaml } from 'yaml'

/** JSON-Schema-ish node as stored inside the custom tool's OpenAPI document. */
export interface OpenApiSchema {
  readonly type?: string | readonly string[]
  readonly description?: string
  readonly enum?: readonly unknown[]
  readonly const?: unknown
  readonly properties?: Record<string, OpenApiSchema>
  readonly required?: readonly string[]
  readonly items?: OpenApiSchema
  readonly additionalProperties?: boolean | OpenApiSchema
  readonly oneOf?: readonly OpenApiSchema[]
  readonly '$ref'?: string
  readonly format?: string
  readonly pattern?: string
  readonly [key: string]: unknown
}

/** One OpenAPI operation parameter (path/query/header). */
export interface OpenApiParameter {
  readonly name: string
  readonly in: 'path' | 'query' | 'header'
  readonly required: boolean
  readonly schema: OpenApiSchema
  readonly description?: string
}

/** One request body variant. */
export interface OpenApiRequestBody {
  readonly contentType: string
  readonly schema: OpenApiSchema
}

/** One operation of the document, flattened for tool registration. */
export interface OpenApiOperation {
  readonly method: string
  readonly path: string
  readonly operationId?: string
  readonly summary?: string
  readonly description?: string
  readonly parameters: readonly OpenApiParameter[]
  readonly requestBody?: OpenApiRequestBody
}

/** The parsed document's tool-relevant subset. */
export interface OpenApiDocument {
  readonly serverUrl: string
  readonly operations: readonly OpenApiOperation[]
  readonly parseErrors: readonly string[]
}

/** Depth cap for `$ref` chains and recursion guards. */
const MAX_DEPTH = 8

/** Parse the stored schema text (JSON or YAML) into the tool-relevant subset. */
export function parseOpenApiDocument(schemaText: string): OpenApiDocument {
  const doc = parseDocumentValue(schemaText)
  if (!isRecord(doc)) {
    return { serverUrl: '', operations: [], parseErrors: ['document is not an object'] }
  }
  const servers = Array.isArray(doc.servers) ? doc.servers : []
  const firstServer = isRecord(servers[0]) && typeof servers[0].url === 'string' ? servers[0].url : ''
  const paths = isRecord(doc.paths) ? doc.paths : {}
  const operations: OpenApiOperation[] = []
  for (const [path, rawItem] of Object.entries(paths)) {
    if (!isRecord(rawItem)) continue
    for (const method of ['get', 'post', 'put', 'patch', 'delete'] as const) {
      const rawOperation = rawItem[method]
      if (!isRecord(rawOperation)) continue
      operations.push(operationOf(method, path, rawOperation))
    }
  }
  return { serverUrl: firstServer, operations, parseErrors: [] }
}

function parseDocumentValue(text: string): unknown {
  const trimmed = text.trim()
  if (trimmed.startsWith('{')) return JSON.parse(trimmed)
  return parseYaml(trimmed)
}

function operationOf(
  method: string,
  path: string,
  raw: Record<string, unknown>,
): OpenApiOperation {
  const parameters: OpenApiParameter[] = []
  for (const rawParameter of Array.isArray(raw.parameters) ? raw.parameters : []) {
    if (!isRecord(rawParameter)) continue
    const location = rawParameter.in
    if (location !== 'path' && location !== 'query' && location !== 'header') continue
    parameters.push({
      name: String(rawParameter.name ?? ''),
      in: location,
      required: rawParameter.required === true,
      schema: isRecord(rawParameter.schema) ? rawParameter.schema : { type: 'string' },
      description: typeof rawParameter.description === 'string' ? rawParameter.description : undefined,
    })
  }
  let requestBody: OpenApiRequestBody | undefined
  const rawBody = isRecord(raw.requestBody) ? raw.requestBody : undefined
  const content = rawBody !== undefined && isRecord(rawBody.content) ? rawBody.content : undefined
  if (content !== undefined) {
    for (const [contentType, rawMedia] of Object.entries(content)) {
      if (!isRecord(rawMedia) || !isRecord(rawMedia.schema)) continue
      requestBody = { contentType, schema: rawMedia.schema }
      break
    }
  }
  return {
    method,
    path,
    operationId: typeof raw.operationId === 'string' && raw.operationId !== '' ? raw.operationId : undefined,
    summary: typeof raw.summary === 'string' ? raw.summary : undefined,
    description: typeof raw.description === 'string' ? raw.description : undefined,
    parameters,
    requestBody,
  }
}

/** Resolve one `$ref` pointer (`#/components/schemas/Name`) when possible. */
function resolveRef(ref: string, components: Record<string, unknown> | undefined): OpenApiSchema | undefined {
  if (!ref.startsWith('#/components/schemas/')) return undefined
  const name = ref.slice('#/components/schemas/'.length)
  const resolved = components?.[name]
  return isRecord(resolved) ? resolved : undefined
}

/** dsh parameter DSL value spec shape (loose local mirror for construction). */
export interface ValueSpec {
  type: string
  description?: string
  enum?: readonly unknown[]
  const?: unknown
  properties?: Record<string, ValueSpec>
  /** Object schema: required property names. */
  required?: readonly string[]
  items?: ValueSpec
  additionalProperties?: boolean
  oneOf?: readonly ValueSpec[]
}

/** One parameter in a dsh tool definition: ValueSpec with a per-parameter required marker. */
export interface ParamSpec extends Omit<ValueSpec, 'required'> {
  /** `true` when the parameter is required at the tool level. */
  required?: true
}

/** Project one OpenAPI schema node onto the dsh parameter DSL. */
export function toValueSpec(
  node: OpenApiSchema,
  components: Record<string, unknown> | undefined,
  depth = 0,
): ValueSpec {
  if (depth > MAX_DEPTH) return { type: 'json', description: node.description }
  if (typeof node.$ref === 'string') {
    const resolved = resolveRef(node.$ref, components)
    if (resolved === undefined) return { type: 'json', description: node.description ?? node.$ref }
    return toValueSpec(resolved, components, depth + 1)
  }
  const description = typeof node.description === 'string' ? node.description : undefined
  if (Array.isArray(node.type) || node.allOf !== undefined || node.anyOf !== undefined
    || node.format !== undefined || node.pattern !== undefined || node.not !== undefined) {
    return { type: 'json', description }
  }
  switch (node.type) {
    case 'string':
    case 'number':
    case 'integer':
    case 'boolean':
    case 'null': {
      const spec: ValueSpec = { type: node.type, description }
      if (Array.isArray(node.enum)) spec.enum = node.enum
      if (node.const !== undefined) spec.const = node.const
      return spec
    }
    case 'array': {
      const spec: ValueSpec = { type: 'array', description }
      if (node.items !== undefined) spec.items = toValueSpec(node.items, components, depth + 1)
      return spec
    }
    case 'object': {
      const spec: ValueSpec = { type: 'object', description, additionalProperties: true }
      if (isRecord(node.properties)) {
        spec.properties = {}
        for (const [name, child] of Object.entries(node.properties)) {
          if (!isRecord(child)) continue
          spec.properties[name] = toValueSpec(child, components, depth + 1)
        }
      }
      if (Array.isArray(node.required)) spec.required = node.required
      return spec
    }
    default:
      // oneOf survives when every branch projects cleanly; mixed or absent
      // typing degrades to json.
      if (Array.isArray(node.oneOf) && node.oneOf.length >= 2) {
        const branches = node.oneOf.filter(isRecord).map(
          branch => toValueSpec(branch, components, depth + 1),
        )
        if (branches.length === node.oneOf.length && branches.every(branch => branch.type !== 'json')) {
          return { type: 'oneOf', oneOf: branches, description }
        }
      }
      return { type: 'json', description }
  }
}

/** Merge an operation's parameters and body properties into one dsh parameter spec. */
export function toParameterSpec(
  operation: OpenApiOperation,
  components: Record<string, unknown> | undefined,
): Record<string, ParamSpec> {
  const spec: Record<string, ParamSpec> = {}
  for (const parameter of operation.parameters) {
    const value = toValueSpec(parameter.schema, components)
    spec[parameter.name] = {
      ...value,
      description: value.description ?? parameter.description ?? `${parameter.in} parameter ${parameter.name}`,
      ...(parameter.required ? { required: true as const } : {}),
    } as ParamSpec
  }
  if (operation.requestBody !== undefined && operation.requestBody.contentType !== 'multipart/form-data') {
    const bodySpec = toValueSpec(operation.requestBody.schema, components)
    if (bodySpec.type === 'object' && bodySpec.properties !== undefined) {
      for (const [name, child] of Object.entries(bodySpec.properties)) {
        if (spec[name] !== undefined) {
          spec[name] = { ...spec[name], description: `${spec[name].description ?? name} (body field)` }
          continue
        }
        if (bodySpec.required?.includes(name)) {
          spec[name] = { ...child, required: true } as ParamSpec
        } else {
          spec[name] = child as ParamSpec
        }
      }
    } else if (Object.keys(spec).length === 0 && operation.requestBody.contentType === 'application/json') {
      spec.body = { ...bodySpec, description: bodySpec.description ?? 'JSON request body' } as ParamSpec
    }
  }
  return spec
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/** Extract the components/schemas map from a parsed document. */
export function componentsOf(doc: unknown): Record<string, unknown> | undefined {
  if (!isRecord(doc) || !isRecord(doc.components) || !isRecord(doc.components.schemas)) return undefined
  return doc.components.schemas
}
