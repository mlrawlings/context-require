import * as fs from "fs";
import * as vm from "vm";
import * as path from "path";
import * as assert from "assert";
import createRequire from "../src";

describe("require-in-context", () => {
  it("should require in a context", () => {
    const dir = __dirname;
    const context = { fromGlobal: "hello" };
    const browserRequire = createRequire({ dir, context });
    const moduleExports = browserRequire("./fixtures/a");

    assert.deepEqual(moduleExports, {
      fromGlobal: context.fromGlobal,
      global: "undefined",
      file: "a"
    });
  });

  it("should require in a pre contextified context", () => {
    const dir = __dirname;
    const context = { fromGlobal: "hello" };
    vm.createContext(context);
    const browserRequire = createRequire({ dir, context });
    const moduleExports = browserRequire("./fixtures/a");

    assert.deepEqual(moduleExports, {
      fromGlobal: context.fromGlobal,
      global: "undefined",
      file: "a"
    });
  });

  it("should support old jsdom style runVMScript context", () => {
    const dir = __dirname;
    const hiddenContext = { fromGlobal: "hello" };
    vm.createContext(hiddenContext);
    const context = {
      runVMScript(script: vm.Script) {
        return script.runInContext(hiddenContext);
      }
    };
    vm.createContext(context);
    const browserRequire = createRequire({ dir, context });
    const moduleExports = browserRequire("./fixtures/a");

    assert.deepEqual(moduleExports, {
      fromGlobal: hiddenContext.fromGlobal,
      global: "undefined",
      file: "a"
    });
  });

  it("should support new jsdom style runVMScript context", () => {
    const dir = __dirname;
    const hiddenContext = { fromGlobal: "hello" };
    vm.createContext(hiddenContext);
    const context = {
      getInternalVMContext() {
        return hiddenContext;
      }
    };
    vm.createContext(context);
    const browserRequire = createRequire({ dir, context });
    const moduleExports = browserRequire("./fixtures/a");

    assert.deepEqual(moduleExports, {
      fromGlobal: hiddenContext.fromGlobal,
      global: "undefined",
      file: "a"
    });
  });

  it("should cache requires in the same context", () => {
    const dir = __dirname;
    const context = { fromGlobal: "hello" };
    const browserRequire = createRequire({ dir, context });
    const moduleExports = browserRequire("./fixtures/a");

    assert.equal(moduleExports, browserRequire("./fixtures/a"));
    assert.notDeepEqual(moduleExports, browserRequire("./fixtures/b"));
  });

  it("should rerequire in a new context", () => {
    const dir = __dirname;
    const contextA = { fromGlobal: "a" };
    const contextB = { fromGlobal: "b" };
    const browserRequireA = createRequire({ dir, context: contextA });
    const moduleExportsA = browserRequireA("./fixtures/a");
    const browserRequireB = createRequire({ dir, context: contextB });
    const moduleExportsB = browserRequireB("./fixtures/a");

    assert.notDeepEqual(moduleExportsA, moduleExportsB);
    assert.deepEqual(moduleExportsA, {
      fromGlobal: contextA.fromGlobal,
      global: "undefined",
      file: "a"
    });
    assert.deepEqual(moduleExportsB, {
      fromGlobal: contextB.fromGlobal,
      global: "undefined",
      file: "a"
    });
  });

  it("should support a custom resolver", () => {
    const dir = __dirname;
    const context = { fromGlobal: "hello" };
    const browserRequire = createRequire({ dir, context, resolve });
    const moduleExports = browserRequire("./fixtures/a");

    assert.deepEqual(moduleExports, {
      fromGlobal: context.fromGlobal,
      global: "undefined",
      file: "b"
    });

    // Resolver to remap a => b
    function resolve(from: string, request: string) {
      assert.equal(from, dir);
      assert.equal(request, "./fixtures/a");
      return path.join(from, "./fixtures/b.js");
    }
  });

  it("should normalize requires from absolute files for custom resolvers", () => {
    const dir = __dirname;
    const context = { fromGlobal: "hello" };
    const browserRequire = createRequire({ dir, context, resolve });
    const moduleExports = browserRequire("./fixtures/d");

    assert.equal(moduleExports.a, browserRequire("./fixtures/a"));
    assert.equal(moduleExports.f, browserRequire("./fixtures/nested/f"));
    assert.equal(moduleExports.f.b, browserRequire("./fixtures/b"));

    // Resolver to remap a => b
    function resolve(from: string, request: string) {
      assert.ok(fs.statSync(from).isDirectory());

      if (request.indexOf(".js", request.length - 3) === -1) {
        request += ".js";
      }

      return path.join(from, request);
    }
  });

  it("should fail on unsupported ext type", () => {
    const dir = __dirname;
    const context = {};
    const browserRequire = createRequire({ dir, context });
    assert.throws(
      () => browserRequire("./fixtures/c.txt"),
      "SyntaxError: Unexpected identifier"
    );
  });

  it("should support adding custom require hooks", () => {
    const dir = __dirname;
    const context = {};
    const extensions = {
      ".txt": (module, filename) => {
        module.exports = fs.readFileSync(filename, "utf-8");
      }
    };
    const browserRequire = createRequire({ dir, context, extensions });
    assert.equal(browserRequire("./fixtures/c.txt"), "some text\n");

    // doesn't change global hooks.
    assert.throws(
      () => require("./fixtures/c.txt"),
      "SyntaxError: Unexpected identifier"
    );
  });

  it("should support nested requires", () => {
    const dir = __dirname;
    const context = { fromGlobal: "hello" };
    const browserRequire = createRequire({ dir, context });
    const moduleExports = browserRequire("./fixtures/e");

    assert.equal(moduleExports.a, browserRequire("./fixtures/a"));
    assert.equal(moduleExports.b, browserRequire("./fixtures/b"));
    assert.equal(moduleExports.bPath, browserRequire.resolve("./fixtures/b"));
  });
});
