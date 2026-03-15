
import { OpenAPIV3 } from 'openapi-types'
import { Tool } from '@modelcontextprotocol/sdk/types.js'
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'

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

/**
 * Construit une déclaration de MCP Tool depuis une route OpenAPI.
 */
export function buildMcpTool(route: RouteDeclaration): Tool {
    const { method, path, operation } = route

    const properties: Record<string, object> = {}
    const required: string[] = []

    // Paramètres path / query / header
    for (const param of (operation.parameters ?? []) as OpenAPIV3.ParameterObject[]) {
        properties[param.name] = {
            ...(param.schema as object ?? {}),
            ...(param.description ? { description: param.description } : {}),
        }
        if (param.required) required.push(param.name)
    }

    // Corps de la requête (application/json)
    if (operation.requestBody) {
        const body = operation.requestBody as OpenAPIV3.RequestBodyObject
        const jsonContent = body.content?.['application/json']
        if (jsonContent?.schema) {
            properties['body'] = {
                ...(jsonContent.schema as object),
                ...(body.description ? { description: body.description } : {}),
            }
            if (body.required) required.push('body')
        }
    }

    return {
        name: buildToolName(method, path),
        title: operation.summary || operation.description,
        description: operation.description,
        inputSchema: {
            type: 'object',
            properties: {
                ...properties,
                headers: {
                    type: 'object',
                    description: 'Optional HTTP headers to include in the request',
                    additionalProperties: { type: 'string' },
                },
            },
            ...(required.length > 0 ? { required } : {}),
        },
    }
}

const MUTATING_METHODS = ['post', 'put', 'delete']

/**
 * Demande confirmation via MCP elicitation si la méthode est mutante.
 * Retourne false si l'utilisateur annule.
 */
async function confirmIfMutating(server: McpServer, route: RouteDeclaration): Promise<boolean> {
    if (!MUTATING_METHODS.includes(route.method.toLowerCase())) return true

    const confirmation = await server.server.elicitInput({
        mode: 'form',
        message: `Confirm ${route.method.toUpperCase()} ${route.path}`,
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
        const merged = { ...defaultArgs, ...args }
        const { headers, ...rest } = merged

        const mergedHeaders = {
            ...(defaultArgs['headers'] as Record<string, string> | undefined),
            ...(headers as Record<string, string> | undefined),
        }

        if (!await confirmIfMutating(server, route)) {
            return { content: [{ type: 'text' as const, text: 'Action cancelled.' }] }
        }

        const result = await callRoute(baseUrl, route, rest, Object.keys(mergedHeaders).length ? mergedHeaders : undefined)
        return { content: [{ type: 'text' as const, text: JSON.stringify(result.body) }] }
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
