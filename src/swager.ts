import { dereference } from '@readme/openapi-parser'
import { OpenAPIV3 } from 'openapi-types'
import { RouteDeclaration } from './tool'

export function read(file: string) {
    return dereference<OpenAPIV3.Document>(file)
} 

function getRoutesByMethods(path: string, openAPIRoute: OpenAPIV3.PathItemObject): RouteDeclaration[] {
    return Object.keys(openAPIRoute)
        .map((methodKey) => ({
            method: methodKey,
            path, 
            operation: openAPIRoute[methodKey]
        }))
}

export function getRoutes(openAPI: OpenAPIV3.Document): RouteDeclaration[] {
    return Object.keys(openAPI.paths)
        .map((path) => getRoutesByMethods(path, openAPI.paths[path]))
        .flat()
}