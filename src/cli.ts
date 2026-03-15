export interface CliArgs {
    spec: string
    url: string
    defaultArgs: Record<string, unknown>
}

export function parseArgs(argv: string[]): CliArgs {
    const args: Record<string, string> = {}

    for (let i = 0; i < argv.length; i++) {
        const arg = argv[i]
        if (arg.startsWith('--')) {
            const key = arg.slice(2)
            const value = argv[i + 1]
            if (!value || value.startsWith('--')) throw new Error(`Missing value for --${key}`)
            args[key] = value
            i++
        }
    }

    if (!args['spec']) throw new Error('Missing required argument: --spec')
    if (!args['url']) throw new Error('Missing required argument: --url')

    let defaultArgs: Record<string, unknown> = {}
    if (args['default-args']) {
        try {
            defaultArgs = JSON.parse(args['default-args'])
        } catch {
            throw new Error('Invalid JSON for --default-args')
        }
    }

    return { spec: args['spec'], url: args['url'], defaultArgs }
}
