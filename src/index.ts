import Module = require("module");
import * as vm from "vm";
import * as path from "path";
import * as builtinModules from "builtins";

const BUILTIN: string[] = builtinModules();
const EXT_NAME = ".in-context";
let moduleId = 0;

/**
 * Patch nodejs module system to support context,
 * compilation and module resolution overrides.
 */
const originalResolve = (Module as any)._resolveFilename;
const originalCompile = (Module.prototype as any)._compile;
require.extensions[EXT_NAME] = requireHook;
(Module as any)._resolveFilename = resolveFileHook;
(Module.prototype as any)._compile = compileHook;

// Expose module.
module.exports = exports = createContextRequire;
export default createContextRequire;

export namespace Types {
  export type compileFunction = (module: Module, filename: string) => any;
  export type resolveFunction = (from: string, request: string) => string;
  export interface RequireFunction {
    <T=any>(id: string) : T;
    resolve(id: string) : string;
}
  export interface Hooks { [x:string]: Types.compileFunction };
  export interface Options {
    /** The directory from which to resolve requires for this module. */
    dir: string,
    /** A vm context which will be used as the context for any required modules. */
    context: any,
    /** A function to which will override the native module resolution. */
    resolve?: resolveFunction,
    /** An object containing any context specific require hooks to be used in this module. */
    extensions?: Hooks
  }
}

export class ContextModule extends Module {
  public _postfix: string;
  public _context: any;
  public _resolve?: Types.resolveFunction;
  public _hooks?: Types.Hooks;

  /**
   * Custom nodejs Module implementation which uses a provided
   * resolver, require hooks, and context. 
   */
  constructor({ dir, context, resolve, extensions }: Types.Options) {
    const postfix =  `.${moduleId++}${EXT_NAME}`;
    const filename = path.join(dir, `index${postfix}`);
    super(filename);

    this.filename = filename;
    this._postfix = postfix;
    this._context = context;
    this._resolve = resolve;
    this._hooks = extensions;

    if (!vm.isContext(context) && typeof context.runVMScript !== "function") {
      vm.createContext(context);
    }
  }
}

/**
 * Creates a custom Module object which runs all required scripts in a provided vm context.
 */
function createContextRequire (options: Types.Options) {
  return createRequire(new ContextModule(options));
}

/**
 * Hijack native file resolution using closest custom resolver.
 *
 * @param request The file to resolve.
 * @param parentModule The module requiring this file.
 */
function resolveFileHook (request: string, parentModule: Module|ContextModule): string {
  const isNotBuiltin = BUILTIN.indexOf(request) === -1;
  const contextModule = isNotBuiltin && findNearestContextModule(parentModule);

  if (contextModule) {
    const postfix = contextModule._postfix;

    if (request.indexOf(postfix, request.length - postfix.length) !== -1) {
      // Skip resolving if we already match the in-context extension.
      return request;
    }

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

      return resolver(dir, request) + postfix;
    } else {
      return originalResolve(request, parentModule) + postfix;
    }
  }

  return originalResolve(request, parentModule);
}

/**
 * Require hook which removes module postfix and uses custom extensions if provided.
 *
 * @param module
 * @param filename 
 */
function requireHook (module, filename) {
  const contextModule = findNearestContextModule(module) as ContextModule;
  const postfix = contextModule._postfix;
  const extensions = contextModule._hooks;
  filename = filename.slice(0, -postfix.length);
  const ext = path.extname(filename);
  const compiler = (extensions && extensions[ext]) || require.extensions[ext] || require.extensions[".js"];
  return compiler(module, filename);
}

/**
 * This overrides script compilation to ensure the nearest context module is used.
 *
 * @param content The file contents of the script.
 * @param filename The filename for the script.
 */
function compileHook (this: Module|ContextModule, content: string, filename: string) {
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
      createRequire(this),
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
function findNearestContextModule (cur: Module): ContextModule|void {
  do {
    if (cur instanceof ContextModule) {
      return cur;
    }
  } while (Boolean(cur = cur.parent));
}

/**
 * Helper which will run a vm script in a context.
 * Special case for JSDOM where `runVMScript` is used.
 *
 * @param context The vm context to run the script in (or a jsdom instance).
 * @param script The vm script to run.
 */
function runScript (context: any, script: vm.Script) {
  return context.runVMScript
    ? context.runVMScript(script)
    : script.runInContext(context);
}

/**
 * Creates a require function bound to a module
 * and adds a `resolve` function the same as nodejs.
 *
 * @param module The module to create a require function for.
 */
function createRequire (module: Module): Types.RequireFunction {
  const require = module.require.bind(module);
  require.resolve = request => resolveFileHook(request, module);
  return require;
}
