
import { OpenAPIV3 } from 'openapi-types'
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import z from 'zod'

interface ToolDeclaration {
    name: string
    title?: string
    description?: string
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    inputSchema: z.ZodObject<any>
}

export interface RouteDeclaration {
    method: string
    path: string
    operation: OpenAPIV3.OperationObject
}

function buildToolName(method: string, path: string): string {
    return `${method}_${path}`
        .replace(/[^a-zA-Z0-9_]/g, '_')
        .replace(/_+/g, '_')
        .replace(/^_|_$/g, '')
}

function openApiSchemaToZod(schema: OpenAPIV3.SchemaObject): z.ZodTypeAny {
    switch (schema.type) {
        case 'string':
            return z.string()
        case 'number':
        case 'integer':
            return z.number()
        case 'boolean':
            return z.boolean()
        case 'array':
            return z.array(
                schema.items
                    ? openApiSchemaToZod(schema.items as OpenAPIV3.SchemaObject)
                    : z.unknown()
            )
        case 'object': {
            if (schema.properties) {
                const requiredFields = schema.required ?? []
                const shape: z.ZodRawShape = {}
                for (const [key, prop] of Object.entries(schema.properties)) {
                    let field = openApiSchemaToZod(prop as OpenAPIV3.SchemaObject)
                    if (!requiredFields.includes(key)) field = field.optional()
                    shape[key] = field
                }
                return z.object(shape)
            }
            return z.record(z.unknown())
        }
        default:
            return z.unknown()
    }
}

/**
 * Construit une déclaration de MCP Tool depuis une route OpenAPI.
 */
export function buildMcpTool(route: RouteDeclaration): ToolDeclaration {
    const { method, path, operation } = route

    const shape: z.ZodRawShape = {}

    // Paramètres path / query / header
    for (const param of (operation.parameters ?? []) as OpenAPIV3.ParameterObject[]) {
        let field = param.schema
            ? openApiSchemaToZod(param.schema as OpenAPIV3.SchemaObject)
            : z.unknown()
        if (param.description) field = field.describe(param.description)
        if (!param.required) field = field.optional()
        shape[param.name] = field
    }

    // Corps de la requête (application/json)
    if (operation.requestBody) {
        const body = operation.requestBody as OpenAPIV3.RequestBodyObject
        const jsonContent = body.content?.['application/json']
        if (jsonContent?.schema) {
            let field = openApiSchemaToZod(jsonContent.schema as OpenAPIV3.SchemaObject)
            if (body.description) field = field.describe(body.description)
            if (!body.required) field = field.optional()
            shape['body'] = field
        }
    }

    // En-têtes HTTP optionnels
    shape['headers'] = z.record(z.string()).optional().describe('Optional HTTP headers to include in the request')

    return {
        name: buildToolName(method, path),
        title: operation.summary || operation.description,
        description: operation.description,
        inputSchema: z.object(shape),
    }
}

const MUTATING_METHODS = ['post', 'put', 'delete']

/**
 * Demande confirmation via MCP elicitation si la méthode est mutante.
 * Retourne false si l'utilisateur annule.
 */
async function confirmIfMutating(server: McpServer, route: RouteDeclaration, args: Record<string, unknown>): Promise<boolean> {
    if (!MUTATING_METHODS.includes(route.method.toLowerCase())) return true

    const paramsText = Object.keys(args).length
        ? `\n\nParameters:\n${JSON.stringify(args, null, 2)}`
        : ''

    const confirmation = await server.server.elicitInput({
        mode: 'form',
        message: `Confirm ${route.method.toUpperCase()} ${route.path}${paramsText}`,
        requestedSchema: {
            type: 'object',
            properties: {
                confirm: {
                    type: 'boolean',
                    title: 'Confirm',
                    description: `Execute this ${route.method.toUpperCase()} request?`,
                    default: false,
                },
            },
            required: ['confirm'],
        },
    })

    return confirmation.action === 'accept' && !!confirmation.content?.['confirm']
}

/**
 * Construit le callback MCP d'un tool : gère la confirmation et l'appel HTTP.
 */
export function buildToolCallback(server: McpServer, baseUrl: string, route: RouteDeclaration, defaultArgs: Record<string, unknown> = {}) {
    return async (args: Record<string, unknown>) => {
        try {
            const merged = { ...defaultArgs, ...args }
            const { headers, ...rest } = merged

            const mergedHeaders = {
                ...(defaultArgs['headers'] as Record<string, string> | undefined),
                ...(headers as Record<string, string> | undefined),
            }

            if (!await confirmIfMutating(server, route, rest)) {
                return { content: [{ type: 'text' as const, text: 'The user choosed to cancel the tool call.' }] }
            }

            const result = await callRoute(baseUrl, route, rest, Object.keys(mergedHeaders).length ? mergedHeaders : undefined)
            return { content: [{ type: 'text' as const, text: JSON.stringify(result.body) }] }
        } catch (e) {
            return {
                isError: true,
                content: [{ type: 'text' as const, text: JSON.stringify((e as Error).message) }]
            }
        }
    }
}

/**
 * Appelle une route API depuis sa déclaration OpenAPI et les arguments fournis.
 */
export async function callRoute(
    baseUrl: string,
    route: RouteDeclaration,
    args: Record<string, unknown>,
    headers?: Record<string, string>,
): Promise<{ status: number; body: unknown }> {
    const { method, path, operation } = route
    const params = (operation.parameters ?? []) as OpenAPIV3.ParameterObject[]

    // Substitution des paramètres de chemin + collecte des query params
    let resolvedPath = path
    const queryParams: Record<string, string> = {}

    for (const param of params) {
        const value = args[param.name]
        if (value === undefined) continue

        if (param.in === 'path') {
            resolvedPath = resolvedPath.replace(`{${param.name}}`, encodeURIComponent(String(value)))
        } else if (param.in === 'query') {
            queryParams[param.name] = String(value)
        }
    }

    // Construction de l'URL
    const url = new URL(resolvedPath, baseUrl)
    for (const [key, val] of Object.entries(queryParams)) {
        url.searchParams.set(key, val)
    }

    // Construction de la requête
    const reqHeaders: Record<string, string> = { ...headers }
    let body: string | undefined

    if (args['body'] !== undefined) {
        reqHeaders['Content-Type'] = 'application/json'
        body = JSON.stringify(args['body'])
    }

    const response = await fetch(url.toString(), {
        method: method.toUpperCase(),
        headers: reqHeaders,
        body,
    })

    const contentType = response.headers.get('content-type') ?? ''
    const responseBody: unknown = contentType.includes('application/json')
        ? await response.json()
        : await response.text()

    return { status: response.status, body: responseBody }
}
