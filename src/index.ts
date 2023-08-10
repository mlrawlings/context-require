import Module = require("module");
import * as vm from "vm";
import * as path from "path";

let moduleId = 0;
const isBuiltin =
  (Module as any).isBuiltin ||
  ((id: string) => Module.builtinModules.indexOf(id) !== -1);

/**
 * Patch nodejs module system to support context,
 * compilation and module resolution overrides.
 */
const originalLoad = (Module as any)._load;
const originalResolve = (Module as any)._resolveFilename;
const originalCompile = (Module.prototype as any)._compile;
const originalProtoLoad = (Module.prototype as any).load;
(Module as any)._load = loadFile;
(Module as any)._resolveFilename = resolveFileHook;
(Module.prototype as any)._compile = compileHook;
(Module.prototype as any).load = protoLoad;

// Expose module.
module.exports = exports = createContextRequire;
export default createContextRequire;

export namespace Types {
  export type compileFunction = (module: Module, filename: string) => any;
  export type resolveFunction = (
    from: string,
    request: string,
    parent: Module
  ) => string;
  export interface RequireFunction {
    <T = any>(id: string): T;
    main: typeof require.main;
    cache: typeof require.cache;
    extensions: Partial<typeof require.extensions>;
    resolve(id: string): string;
  }
  export interface Hooks {
    [x: string]: Types.compileFunction | undefined;
  }
  export interface Options {
    /** The directory from which to resolve requires for this module. */
    dir: string;
    /** A vm context which will be used as the context for any required modules. */
    context: any;
    /** A function to which will override the native module resolution. */
    resolve?: resolveFunction;
    /** An object containing any context specific require hooks to be used in this module. */
    extensions?: Hooks;
  }
}

export class ContextModule extends Module {
  public _context: any;
  public _cache: any;
  public _relativeResolveCache: Record<string, string>;
  public _resolve?: Types.resolveFunction;
  public _hooks?: Types.Hooks;

  /**
   * Custom nodejs Module implementation which uses a provided
   * resolver, require hooks, and context.
   */
  constructor({ dir, context, resolve, extensions }: Types.Options) {
    const filename = path.join(dir, `index.${moduleId++}.ctx`);
    super(filename);

    this.filename = filename;
    this._context = context;
    this._resolve = resolve;
    this._hooks = extensions;
    this._cache = {};
    this._relativeResolveCache = {};

    if (
      !vm.isContext(context) &&
      typeof context.runVMScript !== "function" &&
      typeof context.getInternalVMContext !== "function"
    ) {
      vm.createContext(context);
    }
  }
}

/**
 * Creates a custom Module object which runs all required scripts in a provided vm context.
 */
function createContextRequire(options: Types.Options) {
  const module = new ContextModule(options);
  return createRequire(module, module);
}

/**
 * Use custom require cache for context modules
 *
 * @param request The file to resolve.
 * @param parentModule The module requiring this file.
 * @param isMain
 */
function loadFile(
  request: string,
  parentModule: Module | ContextModule | undefined,
  isMain: boolean
): string {
  const canLoadInContext = parentModule && !isBuiltin(request);
  const contextModule =
    canLoadInContext && findNearestContextModule(parentModule);

  if (!contextModule) {
    return originalLoad(request, parentModule, isMain);
  }

  const cached = contextModule._cache[resolveFileHook(request, parentModule)];
  if (cached) {
    if (parentModule.children.indexOf(cached) === -1) {
      parentModule.children.push(cached);
    }

    return cached.exports;
  }

  const previousCache = (Module as any)._cache;
  (Module as any)._cache = contextModule._cache;

  try {
    return originalLoad(request, parentModule, isMain);
  } finally {
    (Module as any)._cache = previousCache;
  }
}

/**
 * Hijack native file resolution using closest custom resolver.
 *
 * @param request The file to resolve.
 * @param parentModule The module requiring this file.
 */
function resolveFileHook(
  request: string,
  parentModule: Module | ContextModule | undefined
): string {
  const canLoadInContext =
    parentModule && Module.builtinModules.indexOf(request) === -1;
  const contextModule =
    canLoadInContext && findNearestContextModule(parentModule);

  if (contextModule) {
    const resolver = contextModule._resolve;

    if (resolver) {
      // Normalize paths for custom resolvers.
      const dir = path.dirname(parentModule.filename);

      if (path.isAbsolute(request)) {
        request = path.relative(dir, request);

        if (request[0] !== ".") {
          request = "./" + request;
        }
      }

      const relResolveCacheKey = `${dir}\x00${request}`;
      return (
        contextModule._relativeResolveCache[relResolveCacheKey] ||
        (contextModule._relativeResolveCache[relResolveCacheKey] = resolver(
          dir,
          request,
          parentModule
        ))
      );
    } else {
      return originalResolve(request, parentModule);
    }
  }

  return originalResolve(request, parentModule);
}

/**
 * Patch module.load to use the context's custom extensions if provided.
 *
 * @param filename
 */
function protoLoad(filename) {
  const contextModule = findNearestContextModule(this) as ContextModule;
  if (contextModule) {
    const extensions = contextModule._hooks;
    const ext = path.extname(filename);
    const compiler = extensions && extensions[ext];
    if (compiler) {
      const originalCompiler = (Module as any)._extensions[ext];
      (Module as any)._extensions[ext] = compiler;
      try {
        return originalProtoLoad.apply(this, arguments);
      } finally {
        (Module as any)._extensions[ext] = originalCompiler;
      }
    }
  }
  return originalProtoLoad.apply(this, arguments);
}

/**
 * This overrides script compilation to ensure the nearest context module is used.
 *
 * @param content The file contents of the script.
 * @param filename The filename for the script.
 */
function compileHook(
  this: Module | ContextModule,
  content: string,
  filename: string
) {
  const contextModule = findNearestContextModule(this);

  if (contextModule) {
    const context = contextModule._context;
    const script = new vm.Script(Module.wrap(content), {
      filename,
      lineOffset: 0,
      displayErrors: true
    });

    return runScript(context, script).call(
      this.exports,
      this.exports,
      createRequire(this, contextModule),
      this,
      filename,
      path.dirname(filename)
    );
  }

  return originalCompile.apply(this, arguments);
}

/**
 * Walks up a module tree to find the nearest context module.
 *
 * @param cur The starting module.
 */
function findNearestContextModule(cur: Module): ContextModule | void {
  do {
    if (cur instanceof ContextModule) {
      return cur;
    }
  } while (Boolean((cur = cur.parent)));
}

/**
 * Helper which will run a vm script in a context.
 * Special case for JSDOM where `runVMScript` is used.
 *
 * @param context The vm context to run the script in (or a jsdom instance).
 * @param script The vm script to run.
 */
function runScript(context: any, script: vm.Script) {
  return context.runVMScript
    ? context.runVMScript(script)
    : script.runInContext(
        context.getInternalVMContext ? context.getInternalVMContext() : context
      );
}

/**
 * Creates a require function bound to a module
 * and adds a `resolve` function and `cache` object the same as nodejs.
 *
 * @param module The module to create a require function for.
 */
function createRequire(
  module: Module,
  context: ContextModule
): Types.RequireFunction {
  const req = module.require.bind(module);
  req.resolve = request => resolveFileHook(request, module);
  req.main = require.main;
  req.cache = context._cache;
  req.extensions = context._hooks || require.extensions;
  return req;
}
